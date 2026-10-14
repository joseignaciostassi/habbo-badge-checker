"use client";

import { useCallback, useEffect, useState } from "react";
import type { StratumStats, ThresholdRow } from "@/core/calibration";
import type { CalibrationPair, Label } from "@/data/calibrationRepo";
import { PixelBadge } from "../PixelBadge";

interface State {
  pair: CalibrationPair | null;
  strata: (StratumStats & { sampled: number })[];
  table: ThresholdRow[];
}

const LABEL_TEXT: Record<Label, string> = { similar: "Parecida", different: "No parecida", unsure: "No sé" };
const pct = (v: number | null) => (v === null ? "–" : `${(v * 100).toFixed(0)}%`);
/** Score bound as a percentage with at most one decimal: "72.5%", "75%". */
const bound = (v: number) => `${Math.round(Math.min(1, v) * 1000) / 10}%`;
const range = (lo: number, hi: number) => `${bound(lo).slice(0, -1)}–${bound(hi)}`;

export function Labeler() {
  const [state, setState] = useState<State | null>(null);
  const [last, setLast] = useState<{ pair: CalibrationPair; label: Label } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/calibrate", { cache: "no-store" });
    setState(await res.json());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const send = useCallback(
    async (pairId: number, label: Label | null) => {
      setBusy(true);
      await fetch("/api/calibrate", { method: "POST", body: JSON.stringify({ pairId, label }) });
      await load();
      setBusy(false);
    },
    [load],
  );

  const label = useCallback(
    (l: Label) => {
      if (!state?.pair || busy) return;
      setLast({ pair: state.pair, label: l });
      send(state.pair.id, l);
    },
    [state, busy, send],
  );

  const undo = useCallback(() => {
    if (!last || busy) return;
    send(last.pair.id, null);
    setLast(null);
  }, [last, busy, send]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === "p" || k === "arrowleft") label("similar");
      else if (k === "n" || k === "arrowright") label("different");
      else if (k === " ") {
        e.preventDefault();
        label("unsure");
      } else if (k === "z" || k === "backspace") undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [label, undo]);

  if (!state) return <p className="status">Cargando…</p>;
  const labeled = state.strata.reduce((n, s) => n + s.similar + s.different + s.unsure, 0);
  const sampled = state.strata.reduce((n, s) => n + s.sampled, 0);
  const p = state.pair;

  return (
    <>
      <div className="panel info">
        <span className="name">Calibración de umbrales</span>
        <span className="meta">
          ¿Considerarías estas dos placas parecidas, al punto de no querer subir una teniendo la otra? El score se muestra
          recién después de etiquetar, para no condicionarte. Etiquetadas: {labeled} de {sampled}.
        </span>
      </div>

      {p ? (
        <div className="panel labeler">
          <div className="pair">
            <PixelBadge src={`/api/badges/${p.a.id}/image`} width={p.a.width} height={p.a.height} scale={4} box={210} />
            <PixelBadge src={`/api/badges/${p.b.id}/image`} width={p.b.width} height={p.b.height} scale={4} box={210} />
          </div>
          <div className="actions">
            <button type="button" className="btn similar" disabled={busy} onClick={() => label("similar")}>
              Parecida <kbd>P</kbd>
            </button>
            <button type="button" className="btn different" disabled={busy} onClick={() => label("different")}>
              No parecida <kbd>N</kbd>
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => label("unsure")}>
              No sé <kbd>Espacio</kbd>
            </button>
            <button type="button" className="btn" disabled={busy || !last} onClick={undo}>
              Deshacer <kbd>Z</kbd>
            </button>
          </div>
        </div>
      ) : (
        <p className="empty">¡Listo! No quedan pares sin etiquetar. Podés generar más con npm run calibrate -- --sample.</p>
      )}

      {last && (
        <p className="status">
          Último: {last.pair.a.fileName} vs {last.pair.b.fileName} → <strong>{LABEL_TEXT[last.label]}</strong> · diseño{" "}
          {Math.round(last.pair.design * 100)}%, dHash {last.pair.dhash}, silueta {last.pair.silhouette}
        </p>
      )}

      <h2>Estimación por umbral de diseño</h2>
      <div className="panel table-wrap">
        <table className="report">
          <thead>
            <tr>
              <th>Umbral</th>
              <th>Pares en la base</th>
              <th>Precisión</th>
              <th>Cobertura</th>
              <th>Falsos por consulta</th>
              <th>Etiquetas</th>
            </tr>
          </thead>
          <tbody>
            {state.table.map((r) => (
              <tr key={r.threshold}>
                <td>≥ {bound(r.threshold)}</td>
                <td>{r.pairs.toLocaleString("es-AR")}</td>
                <td>{pct(r.precision)}</td>
                <td>{pct(r.recall)}</td>
                <td>{r.precision === null ? "–" : r.falsePerQuery.toFixed(2)}</td>
                <td>{r.labels}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="meta">
          Precisión: de los pares que se reportarían, cuántos son parecidos según tus etiquetas. Cobertura: de los pares
          parecidos con diseño ≥ {state.strata.length ? bound(state.strata[0].lo) : "–"}, cuántos se reportarían. Falsos por consulta: placas no relacionadas que aparecerían
          en promedio al verificar una placa.
        </p>
      </div>

      <h2>Progreso por franja</h2>
      <div className="panel table-wrap">
        <table className="report">
          <thead>
            <tr>
              <th>Diseño</th>
              <th>Pares en la base</th>
              <th>Parecidas</th>
              <th>No parecidas</th>
              <th>No sé</th>
              <th>Pendientes</th>
            </tr>
          </thead>
          <tbody>
            {state.strata.map((s) => (
              <tr key={s.stratum}>
                <td>{range(s.lo, s.hi)}</td>
                <td>{s.population.toLocaleString("es-AR")}</td>
                <td>{s.similar}</td>
                <td>{s.different}</td>
                <td>{s.unsure}</td>
                <td>{s.sampled - s.similar - s.different - s.unsure}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
