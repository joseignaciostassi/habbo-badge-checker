"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { type ExactMatch, MATCH_LABELS } from "@/core/compare";
import { PixelBadge } from "./PixelBadge";

interface BadgeInfo {
  id: number;
  fileName: string;
  width: number;
  height: number;
  animated: boolean;
}

interface CheckResponse {
  upload: { format: string; width: number; height: number; uniqueFrames: number; animated: boolean; sizeNote: string | null };
  exact: (BadgeInfo & { match: ExactMatch })[];
  similar: (BadgeInfo & { dhash: number; silhouette: number; design: number })[];
}

interface Thresholds {
  dhash: number;
  silhouette: number;
  design: number;
}

export function Checker({ defaults }: { defaults: Thresholds }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [thresholds, setThresholds] = useState(defaults);
  const [result, setResult] = useState<CheckResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const pick = useCallback((f: File | undefined | null) => {
    if (!f) return;
    setFile(f);
    setResult(null);
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(f);
    });
  }, []);

  // Paste an image from the clipboard (Ctrl+V).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => pick(e.clipboardData?.files[0]);
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [pick]);

  // Re-check whenever the file or the thresholds change (debounced for the sliders).
  useEffect(() => {
    if (!file) return;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      const body = new FormData();
      body.set("file", file);
      body.set("dhash", String(thresholds.dhash));
      body.set("sil", String(thresholds.silhouette));
      body.set("design", String(thresholds.design));
      try {
        const res = await fetch("/api/check", { method: "POST", body, signal: ctrl.signal });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? res.statusText);
        setResult(json);
        setError(null);
      } catch (e) {
        if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [file, thresholds]);

  const up = result?.upload;

  return (
    <>
      <div
        className={`panel dropzone${over ? " over" : ""}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          pick(e.dataTransfer.files[0]);
        }}
      >
        <input ref={inputRef} type="file" accept="image/gif,image/png" onChange={(e) => pick(e.target.files?.[0])} />
        {preview && up ? (
          <PixelBadge src={preview} width={up.width} height={up.height} scale={4} box={210} title="Placa subida" />
        ) : (
          <div className="pixel-box" style={{ width: 210, height: 210 }} />
        )}
        <div className="info">
          {file ? <span className="name">{file.name}</span> : <span className="name">Subí una placa</span>}
          {up ? (
            <>
              <span className="meta">
                {up.format.toUpperCase()} · {up.width}x{up.height} · {up.uniqueFrames} frame{up.uniqueFrames > 1 ? "s" : ""} único
                {up.uniqueFrames > 1 ? "s" : ""}
              </span>
              {up.animated && <span className="tag animated">Animada</span>}
              {up.sizeNote && <span className="meta">Tamaño fuera de lo normal ({up.sizeNote}): se normaliza a 40x40</span>}
            </>
          ) : (
            <span className="hint">Arrastrá un GIF o PNG, hacé clic para elegirlo o pegalo con Ctrl+V.</span>
          )}
          {loading && <span className="status">Buscando…</span>}
          {error && <span className="error">{error}</span>}
        </div>
      </div>

      {result && preview && up && (
        <>
          <h2>
            Duplicados exactos <span className="count">({result.exact.length})</span>
          </h2>
          {result.exact.length === 0 ? (
            <p className="empty">No hay duplicados exactos.</p>
          ) : (
            <div className="grid">
              {result.exact.map((m) => (
                <MatchCard key={m.id} badge={m} preview={preview} up={up}>
                  <span className={`tag ${m.match}`}>{MATCH_LABELS[m.match]}</span>
                </MatchCard>
              ))}
            </div>
          )}

          <h2>
            Similares <span className="count">({result.similar.length})</span>
          </h2>
          <div className="controls">
            <Slider
              label="Diseño ≥"
              min={30}
              max={100}
              value={Math.round(thresholds.design * 100)}
              suffix="%"
              onChange={(v) => setThresholds((t) => ({ ...t, design: v / 100 }))}
            />
            <details>
              <summary>Prefiltro</summary>
              <div className="controls">
                <Slider
                  label="dHash ≤"
                  value={thresholds.dhash}
                  onChange={(dhash) => setThresholds((t) => ({ ...t, dhash }))}
                />
                <Slider
                  label="Silueta ≤"
                  value={thresholds.silhouette}
                  onChange={(silhouette) => setThresholds((t) => ({ ...t, silhouette }))}
                />
              </div>
            </details>
            <button type="button" onClick={() => setThresholds(defaults)}>
              Restablecer
            </button>
          </div>
          {result.similar.length === 0 ? (
            <p className="empty">No hay placas similares con estos umbrales.</p>
          ) : (
            <div className="grid">
              {result.similar.map((m) => (
                <MatchCard key={m.id} badge={m} preview={preview} up={up}>
                  <span className="tag similar">Diseño {Math.round(m.design * 100)}%</span>
                  <span className="meta">
                    dHash {m.dhash} · silueta {m.silhouette}
                  </span>
                </MatchCard>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}

function MatchCard({
  badge,
  preview,
  up,
  children,
}: {
  badge: BadgeInfo;
  preview: string;
  up: { width: number; height: number };
  children: React.ReactNode;
}) {
  return (
    <div className="panel match">
      <div className="pair">
        <PixelBadge src={preview} width={up.width} height={up.height} title="Placa subida" />
        <PixelBadge src={`/api/badges/${badge.id}/image`} width={badge.width} height={badge.height} title={badge.fileName} />
      </div>
      <div className="info">
        <span className="name">{badge.fileName}</span>
        <span className="meta">
          {badge.width}x{badge.height}
          {badge.animated ? " · animada" : ""}
        </span>
        {children}
      </div>
    </div>
  );
}

function Slider({
  label,
  value,
  onChange,
  min = 0,
  max = 32,
  suffix = "",
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  suffix?: string;
}) {
  return (
    <label>
      {label}
      <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <output>
        {value}
        {suffix}
      </output>
    </label>
  );
}
