import pg from "pg";
import { config } from "../config";

let pool: pg.Pool | undefined;

export function getPool(): pg.Pool {
  pool ??= new pg.Pool({ connectionString: config.databaseUrl, max: 5 });
  return pool;
}

export async function closePool() {
  await pool?.end();
  pool = undefined;
}
