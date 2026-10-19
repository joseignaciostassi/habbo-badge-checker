import { getPool } from "./db";

/** Arbitrary key for the PG advisory lock shared by the web update and the index/scan scripts. */
const LOCK_KEY = 4_042_042;

export class UpdateBusyError extends Error {
  constructor() {
    super("Ya hay una actualización de la base en curso (desde la web o la terminal).");
  }
}

/**
 * Runs fn holding a session-level advisory lock, so the web "Actualizar BD" and
 * `npm run index` / `npm run scan` never write at the same time.
 */
export async function withUpdateLock<T>(fn: () => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    const { rows } = await client.query("SELECT pg_try_advisory_lock($1) AS ok", [LOCK_KEY]);
    if (!rows[0].ok) throw new UpdateBusyError();
    try {
      return await fn();
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}
