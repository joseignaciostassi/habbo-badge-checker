import pg from "pg";
import { config } from "../config";

// Kept on globalThis so Next.js dev hot reloads reuse one pool.
const g = globalThis as { __badgePool?: pg.Pool };

export function getPool(): pg.Pool {
  g.__badgePool ??= new pg.Pool({ connectionString: config.databaseUrl, max: 5 });
  return g.__badgePool;
}

export async function closePool() {
  await g.__badgePool?.end();
  g.__badgePool = undefined;
}
