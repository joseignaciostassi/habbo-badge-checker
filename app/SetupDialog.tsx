"use client";

import type { SetupInfo, SyncJob } from "@/services/sync";

/** Rough first-run time: indexing plus scanning took ~110 s for 27k badges. */
function estimate(badges: number): string {
  const secs = (badges / 27_000) * 110;
  return secs < 60 ? "menos de un minuto" : `unos ${Math.max(2, Math.round(secs / 60))} minutos`;
}

/**
 * First-run dialog: the database does not exist yet (offers to create it, index the folder and
 * scan), PostgreSQL cannot be reached (offers to retry), or the first-run job is in progress.
 */
export function SetupDialog({
  setup,
  job,
  progress,
  error,
  onCreate,
  onRetry,
}: {
  setup: SetupInfo | null;
  job: SyncJob | null;
  progress: string;
  error: string | null;
  onCreate: () => void;
  onRetry: () => void;
}) {
  const running = job?.running ?? false;
  return (
    <div className="modal-backdrop">
      <div className="panel modal" role="dialog" aria-modal="true" aria-labelledby="setup-title">
        {running ? (
          <>
            <h2 id="setup-title">Preparando la base de datos</h2>
            <p className="modal-progress">
              <span className="spinner" aria-hidden />
              {progress}
            </p>
            <p className="meta">Podés dejar esta pestaña abierta; al terminar se cierra sola.</p>
          </>
        ) : setup?.state === "unreachable" ? (
          <>
            <h2 id="setup-title">No se pudo conectar a PostgreSQL</h2>
            <p>
              {setup.error} (<code>{setup.host}</code>)
            </p>
            <p className="meta">
              Revisá <code>DATABASE_URL</code> en <code>.env</code> y que el servicio de PostgreSQL esté corriendo.
            </p>
            <div className="modal-actions">
              <button className="btn primary" onClick={onRetry}>
                Reintentar
              </button>
            </div>
          </>
        ) : setup?.state === "missing" ? (
          <>
            <h2 id="setup-title">Primera ejecución</h2>
            <p>
              Para detectar duplicados, la app guarda los hashes y huellas de cada placa en una base de datos
              PostgreSQL propia. La base <code>{setup.database}</code> todavía no existe en <code>{setup.host}</code>.
            </p>
            <p>
              Al crearla se indexan las {setup.badgesInFolder.toLocaleString("es-AR")} placas de la carpeta y se hace el
              primer escaneo ({estimate(setup.badgesInFolder)}). Las placas originales no se modifican.
            </p>
            {error && <p className="modal-error">{error}</p>}
            <div className="modal-actions">
              <button className="btn primary" onClick={onCreate}>
                Crear base de datos
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
