import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { closePool, getPool } from "../data/db";

const dir = path.join(import.meta.dirname, "..", "data", "migrations");

async function main() {
  const pool = getPool();
  await pool.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now())");
  const applied = new Set((await pool.query("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(dir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.log(`applied ${file}`);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  console.log("migrations up to date");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
}).finally(closePool);
