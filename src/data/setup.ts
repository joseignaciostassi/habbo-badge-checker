import { lookup } from "node:dns/promises";
import { readdir, readFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import pg from "pg";
import { config } from "../config";
import { getPool } from "./db";
import { withUpdateLock } from "./updateLock";

/** Resolved from the project root: import.meta.dirname points inside the Next bundle. */
const MIGRATIONS_DIR = path.join(process.cwd(), "src", "data", "migrations");

export type DbState =
  | { state: "ready" }
  | { state: "missing" }
  | { state: "unreachable"; error: string };

/** Where the app's database lives, without the credentials (for messages). */
export function databaseTarget(): { database: string; host: string } {
  const url = new URL(config.databaseUrl);
  return { database: url.pathname.slice(1), host: `${url.hostname}:${url.port || 5432}` };
}

/** Turns a connection error into "database does not exist" or a readable reason. */
export function classifyDbError(e: unknown): Exclude<DbState, { state: "ready" }> {
  const err = e as { code?: string; message?: string };
  if (err?.code === "3D000") return { state: "missing" };
  const reasons: Record<string, string> = {
    ECONNREFUSED: "PostgreSQL no responde en esa dirección.",
    ENOTFOUND: "No se encontró el servidor de PostgreSQL.",
    ETIMEDOUT: "PostgreSQL no respondió a tiempo.",
    "28P01": "Usuario o contraseña incorrectos.",
    "28000": "El usuario no tiene permiso para conectarse.",
  };
  return { state: "unreachable", error: (err?.code && reasons[err.code]) || err?.message || String(e) };
}

/**
 * True if something listens on host:port, trying each resolved address in turn. Checked before
 * pg connects because, when every address of "localhost" refuses, pg rejects with an
 * AggregateError that Next's dev-mode render tracking chokes on, hanging the page.
 */
async function portOpen(host: string, port: number, timeoutMs = 2000): Promise<boolean> {
  const addresses = await lookup(host, { all: true }).catch(() => []);
  for (const { address } of addresses) {
    const ok = await new Promise<boolean>((resolve) => {
      const socket = net.connect({ host: address, port, timeout: timeoutMs });
      const done = (result: boolean) => {
        socket.destroy();
        resolve(result);
      };
      socket.once("connect", () => done(true));
      socket.once("timeout", () => done(false));
      socket.once("error", () => done(false));
    });
    if (ok) return true;
  }
  return false;
}

export async function checkDatabase(): Promise<DbState> {
  const url = new URL(config.databaseUrl);
  if (!(await portOpen(url.hostname, Number(url.port) || 5432))) {
    return { state: "unreachable", error: "PostgreSQL no responde en esa dirección." };
  }
  try {
    await getPool().query("SELECT 1");
    return { state: "ready" };
  } catch (e) {
    return classifyDbError(e);
  }
}

/** Creates the database named in DATABASE_URL (connecting via the `postgres` db). Returns false if it existed. */
export async function createDatabase(): Promise<boolean> {
  const { database } = databaseTarget();
  if (!/^[a-z_][a-z0-9_]*$/.test(database)) throw new Error(`Nombre de base inesperado: ${database}`);
  const url = new URL(config.databaseUrl);
  url.pathname = "/postgres";
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  try {
    const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [database]);
    if (rowCount) return false;
    await client.query(`CREATE DATABASE ${database}`);
    return true;
  } finally {
    await client.end();
  }
}

async function migrationFiles(): Promise<string[]> {
  return (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
}

async function pendingMigrations(): Promise<string[]> {
  const pool = getPool();
  await pool.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now())");
  const applied = new Set((await pool.query("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
  return (await migrationFiles()).filter((f) => !applied.has(f));
}

/**
 * Applies the pending files of src/data/migrations in order, each in a transaction, under the
 * update lock so two processes never migrate at once. Returns the applied file names.
 */
export async function applyMigrations(): Promise<string[]> {
  if (!(await pendingMigrations()).length) return [];
  return withUpdateLock(async () => {
    const done: string[] = [];
    for (const file of await pendingMigrations()) {
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
      const client = await getPool().connect();
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
        done.push(file);
      } catch (e) {
        await client.query("ROLLBACK");
        throw new Error(`Falló la migración ${file}: ${e instanceof Error ? e.message : e}`);
      } finally {
        client.release();
      }
    }
    return done;
  });
}

// Remembers, per process, the migration list already verified, so pages and polls skip the check.
const g = globalThis as { __schemaChecked?: string };

/**
 * Makes the database usable: creates it when missing (only if `create`) and applies pending
 * migrations. Cheap after the first call while no migration file is added.
 */
export async function ensureDatabase(opts: { create: boolean }): Promise<DbState> {
  const db = await checkDatabase();
  if (db.state === "unreachable" || (db.state === "missing" && !opts.create)) return db;
  if (db.state === "missing") {
    g.__schemaChecked = undefined; // a new (or dropped and recreated) database starts unmigrated
    await createDatabase();
  }

  const key = (await migrationFiles()).join(",");
  if (g.__schemaChecked !== key) {
    await applyMigrations();
    g.__schemaChecked = key;
  }
  return { state: "ready" };
}
