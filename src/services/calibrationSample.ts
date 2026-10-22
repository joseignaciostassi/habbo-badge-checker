import { config } from "../config";
import { SAMPLE_EXTRA, STRATA, stratumOf } from "../core/calibration";
import { CalibrationRepository } from "../data/calibrationRepo";
import { ScanRepository } from "../data/scanRepo";
import { UpdateBusyError, withUpdateLock } from "../data/updateLock";

const CHUNK = 500;
const PARALLEL = 4;

/** Small seeded PRNG (mulberry32) for the reservoir sampling. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Candidate pairs over the whole base, stratified by design score. Existing pairs are
 * re-stratified by their current score (labels are kept), then up to `extra` new random pairs
 * are added to each band, so every band keeps getting labels.
 */
export async function runCalibrationSample(opts: {
  extra: number;
  onProgress?: (done: number, total: number) => void;
}): Promise<{ added: number; below: number }> {
  const repo = new CalibrationRepository();
  const scan = new ScanRepository();
  const t = { ...config.thresholds, design: STRATA[0][0] };
  const existing = (await repo.currentScores(t)).map((p) => {
    const s = p.design === null ? -1 : stratumOf(p.design);
    return { ...p, stratum: s < 0 ? null : s };
  });
  const sampled = new Set(existing.map((p) => `${p.a}:${p.b}`));
  const exact = new Set((await scan.exactPairs()).map((p) => `${p.a}:${p.b}`));
  const { min, max } = await scan.badgeIdRange();

  const population = STRATA.map(() => 0);
  const seen = STRATA.map(() => 0);
  const reservoirs: { a: number; b: number; dhash: number; silhouette: number; design: number }[][] = STRATA.map(() => []);
  const rand = rng(Date.now() & 0xffff);
  const starts: number[] = [];
  if (min !== null) for (let from = min; from <= max; from += CHUNK) starts.push(from);
  const total = starts.length;
  let done = 0;
  const worker = async () => {
    for (let from = starts.shift(); from !== undefined; from = starts.shift()) {
      for (const p of await scan.similarPairs(from, from + CHUNK, t)) {
        if (exact.has(`${p.a}:${p.b}`)) continue;
        const s = stratumOf(p.design);
        if (s < 0) continue;
        population[s]++;
        if (sampled.has(`${p.a}:${p.b}`)) continue;
        // Reservoir sampling keeps a uniform sample of each stratum.
        const n = ++seen[s];
        if (reservoirs[s].length < opts.extra) reservoirs[s].push(p);
        else {
          const j = Math.floor(rand() * n);
          if (j < opts.extra) reservoirs[s][j] = p;
        }
      }
      opts.onProgress?.(++done, total);
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));

  const pairs = reservoirs.flatMap((r, i) => r.map((p) => ({ ...p, stratum: i })));
  await repo.saveSample(
    STRATA.map(([lo, hi], i) => ({ stratum: i, lo, hi, population: population[i] })),
    existing,
    pairs,
  );
  return { added: pairs.length, below: existing.filter((p) => p.stratum === null).length };
}

export interface SampleJob {
  running: boolean;
  progress: { done: number; total: number } | null;
  result: { added: number; below: number } | null;
  error: string | null;
  finishedAt: string | null;
}

// Kept on globalThis so Next.js dev hot reloads keep the running job.
const g = globalThis as { __sampleJob?: SampleJob };

export function getSampleJob(): SampleJob | null {
  return g.__sampleJob ?? null;
}

/**
 * Starts "Generar más pares" in the background, under the update lock so it never runs at
 * the same time as "Actualizar BD". Returns false when one is already running.
 */
export function startSample(): boolean {
  if (g.__sampleJob?.running) return false;
  const job: SampleJob = { running: true, progress: null, result: null, error: null, finishedAt: null };
  g.__sampleJob = job;
  void (async () => {
    try {
      job.result = await withUpdateLock(() =>
        runCalibrationSample({ extra: SAMPLE_EXTRA, onProgress: (done, total) => (job.progress = { done, total }) }),
      );
    } catch (e) {
      job.error = e instanceof UpdateBusyError ? e.message : `Error al generar pares: ${e instanceof Error ? e.message : String(e)}`;
      if (!(e instanceof UpdateBusyError)) console.error(e);
    } finally {
      job.running = false;
      job.progress = null;
      job.finishedAt = new Date().toISOString();
    }
  })();
  return true;
}
