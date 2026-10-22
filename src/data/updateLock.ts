import { getPool } from "./db";

/** Arbitrary key for the PG advisory lock shared by "Actualizar BD", migrations and "Generar más pares". */
const LOCK_KEY = 4_042_042;

export class UpdateBusyError extends Error {
  constructor() {
    super("Ya hay una actualización de la base en curso.");
  }
}

/**
 * Runs fn holding a session-level advisory lock, so database updates never overlap, even across
 * processes (e.g. two dev servers on the same database).
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
