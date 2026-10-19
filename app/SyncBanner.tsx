"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FolderChanges, SyncJob, SyncStatus } from "@/services/sync";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function changeSummary(f: FolderChanges): string {
  return [
    f.added && plural(f.added, "nueva", "nuevas"),
    f.changed && plural(f.changed, "modificada", "modificadas"),
    f.restored && plural(f.restored, "restaurada", "restauradas"),
    f.missing && !f.massMissing && plural(f.missing, "eliminada", "eliminadas"),
    f.outdated && plural(f.outdated, "a reanalizar", "a reanalizar"),
  ]
    .filter(Boolean)
    .join(" · ");
}

function progressText(job: SyncJob): string {
  const p = job.progress;
  if (job.phase === "indexing") return p ? `Indexando placas ${p.done}/${p.total}…` : "Revisando la carpeta…";
  return p ? `Escaneando la base, bloque ${p.done}/${p.total}…` : "Escaneando la base…";
}

function resultText(job: SyncJob): string {
  const r = job.result;
  if (!r) return "Base actualizada.";
  const parts = [
    r.indexed && plural(r.indexed, "placa indexada", "placas indexadas"),
    r.errors && plural(r.errors, "archivo con error", "archivos con error"),
    r.markedMissing && plural(r.markedMissing, "marcada como eliminada", "marcadas como eliminadas"),
    r.scanned && `escaneo rehecho (${r.exactGroups} grupos exactos, ${r.similarGroups} de similares)`,
  ].filter(Boolean);
  return `Base actualizada${parts.length ? `: ${parts.join(", ")}` : ""}.`;
}

/**
 * Tells when the badges folder changed since the last index (or the scan is older than the
 * index) and offers "Actualizar BD", which indexes and rescans in the background.
 */
export function SyncBanner() {
  const router = useRouter();
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Last finished job this page watched, shown until dismissed. */
  const [finished, setFinished] = useState<SyncJob | null>(null);
  const watching = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/sync", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? res.statusText);
      setStatus(data);
      setError(null);
      const job: SyncJob | null = data.job;
      if (job?.running) watching.current = true;
      else if (watching.current && job) {
        watching.current = false;
        setFinished(job);
        router.refresh(); // re-render server pages such as /scan with the new data
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [router]);

  useEffect(() => {
    refresh();
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const running = status?.job?.running ?? false;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(refresh, 1000);
    return () => clearInterval(id);
  }, [running, refresh]);

  const start = async (allowMassMissing = false) => {
    setFinished(null);
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowMassMissing }),
      });
      const data = await res.json();
      if (!res.ok && res.status !== 409) throw new Error(data.error ?? res.statusText);
      watching.current = true;
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (error) {
    return (
      <div className="sync-banner warn" role="status">
        <span className="sync-text">No se pudo revisar la carpeta de placas: {error}</span>
      </div>
    );
  }
  if (!status) return null;

  if (status.job?.running) {
    return (
      <div className="sync-banner" role="status">
        <span className="spinner" aria-hidden />
        <span className="sync-text">{progressText(status.job)}</span>
      </div>
    );
  }

  const f = status.folder;
  const summary = f ? changeSummary(f) : "";
  const examples = f
    ? (
        [
          ["Nuevas", f.examples.added],
          ["Modificadas", f.examples.changed],
          ["Restauradas", f.examples.restored],
          ["Eliminadas", f.examples.missing],
        ] as const
      ).filter(([, names]) => names.length)
    : [];

  return (
    <>
      {finished && (
        <div className={`sync-banner ${finished.phase === "error" ? "warn" : "ok"}`} role="status">
          <span className="sync-text">{finished.phase === "error" ? finished.error : resultText(finished)}</span>
          <button className="btn small ghost" onClick={() => setFinished(null)} aria-label="Cerrar">
            ✕
          </button>
        </div>
      )}

      {status.needsUpdate && (
        <div className="sync-banner" role="status">
          <span className="sync-text">
            {summary && <>Cambios en la carpeta de placas: {summary}. </>}
            {status.scanStale && (
              <>{status.scannedAt ? "El escaneo es anterior a los últimos cambios." : "Todavía no hay un escaneo de la base."}</>
            )}
          </span>
          <button className="btn small primary" onClick={() => start()}>
            Actualizar BD
          </button>
          {examples.length > 0 && (
            <details className="sync-details">
              <summary>Ver placas</summary>
              {examples.map(([label, names]) => (
                <p key={label}>
                  <strong>{label}:</strong> {names.join(", ")}
                  {label === "Eliminadas" && f!.missing > names.length && ` … (+${f!.missing - names.length})`}
                </p>
              ))}
            </details>
          )}
        </div>
      )}

      {f?.massMissing && (
        <div className="sync-banner warn" role="alert">
          <span className="sync-text">
            Faltan {f.missing} placas de la carpeta ({(f.missingRatio * 100).toFixed(1)}% de la base). Puede que{" "}
            <code>BADGES_DIR</code> esté mal configurada o desconectada, así que no se marcan como eliminadas.
          </span>
          <button
            className="btn small"
            onClick={() => {
              if (confirm(`¿Marcar ${f.missing} placas como eliminadas? Dejan de aparecer en las búsquedas hasta que vuelvan a la carpeta.`)) {
                start(true);
              }
            }}
          >
            Marcar igual como eliminadas
          </button>
        </div>
      )}
    </>
  );
}
