import type { Thresholds } from "../config";
import { strongestMatch } from "../core/compare";
import { scanMode } from "../core/scanMode";
import { starClusters } from "../core/starClusters";
import { UnionFind } from "../core/unionFind";
import { type ScanPair, ScanRepository } from "../data/scanRepo";

const CHUNK = 500;
const PARALLEL = 4;
/** Changed badges compared per query in an incremental scan. */
const CHANGED_CHUNK = 100;

export interface ScanStats {
  exactPairs: number;
  exactByRelation: Record<string, number>;
  similarPairs: number;
  exactGroups: number;
  exactGroupSizes: Record<string, number>;
  badgesInExactGroups: number;
  similarGroups: number;
  similarGroupSizes: Record<string, number>;
  badgesInSimilarGroups: number;
  largestSimilarGroup: number;
}

export interface ScanResult {
  stats: ScanStats;
  exactGroups: number[][];
  similarGroups: number[][];
  seconds: number;
  mode: "full" | "incremental";
  /** Badges compared against the whole base (incremental only). */
  changed: number;
}

export type ScanProgress = (done: number, total: number, similarPairs: number) => void;

function sizes(gs: number[][]) {
  const buckets = { "2": 0, "3-5": 0, "6-10": 0, "11-50": 0, ">50": 0 };
  for (const g of gs) {
    const n = g.length;
    buckets[n === 2 ? "2" : n <= 5 ? "3-5" : n <= 10 ? "6-10" : n <= 50 ? "11-50" : ">50"]++;
  }
  return buckets;
}

/**
 * Scan of the base: exact pairs (shared hashes) and similar pairs (prefilter + design score),
 * grouped and stored. When the previous run allows it (see scanMode) only the badges changed
 * since then are compared against the whole base and the other pairs are kept; otherwise every
 * pair is recomputed and the previous run replaced. `onStart` says which.
 */
export async function runScan(
  t: Thresholds,
  onProgress?: ScanProgress,
  opts: { onStart?: (mode: "full" | "incremental", changed: number) => void } = {},
): Promise<ScanResult> {
  const repo = new ScanRepository();
  const startedAt = new Date();

  const previous = await repo.latestRun();
  const changedIds = previous ? await repo.changedSince(previous.startedAt) : [];
  const mode = previous
    ? scanMode({ previous, thresholds: t, changed: changedIds.length, active: await repo.activeCount() })
    : "full";
  opts.onStart?.(mode, changedIds.length);

  const { exact, similar } =
    mode === "incremental" ? await incrementalPairs(repo, previous!.id, changedIds, t, onProgress) : await allPairs(repo, t, onProgress);

  // Groups. Exact duplicates: connected components. Similar: star clusters (a center
  //    badge plus the badges directly similar to it), since components chain into one blob.
  const ufExact = new UnionFind();
  for (const p of exact) ufExact.union(p.a, p.b);
  const exactGroups = ufExact.groups();
  const similarGroups = starClusters(similar).sort((x, y) => y.length - x.length);

  const byRelation = Object.fromEntries(
    (["identical", "identical-crop", "same-content"] as const).map((r) => [r, exact.filter((p) => p.relation === r).length]),
  );
  const stats: ScanStats = {
    exactPairs: exact.length,
    exactByRelation: byRelation,
    similarPairs: similar.length,
    exactGroups: exactGroups.length,
    exactGroupSizes: sizes(exactGroups),
    badgesInExactGroups: exactGroups.reduce((n, g) => n + g.length, 0),
    similarGroups: similarGroups.length,
    similarGroupSizes: sizes(similarGroups),
    badgesInSimilarGroups: similarGroups.reduce((n, g) => n + g.length, 0),
    largestSimilarGroup: similarGroups[0]?.length ?? 0,
  };

  const run = { startedAt, finishedAt: new Date(), thresholds: t, stats: { ...stats } };
  const groups = [
    ...exactGroups.map((m) => ({ kind: "exact" as const, members: m })),
    ...similarGroups.map((m) => ({ kind: "similar" as const, members: m })),
  ];
  if (mode === "incremental") {
    const fresh = [...exact, ...similar].filter((p) => p.fresh);
    await repo.updateScan(previous!.id, run, changedIds, fresh, groups);
  } else {
    await repo.saveScan(run, [...exact, ...similar], groups);
  }

  return {
    stats,
    exactGroups,
    similarGroups,
    seconds: (Date.now() - startedAt.getTime()) / 1000,
    mode,
    changed: mode === "incremental" ? changedIds.length : 0,
  };
}

/** A pair, marked `fresh` when this scan computed it (not kept from the previous run). */
type Found = ScanPair & { fresh?: boolean };

/** Every pair of the base: exact via shared hashes, similar via a chunked self-join by lower badge id. */
async function allPairs(repo: ScanRepository, t: Thresholds, onProgress?: ScanProgress) {
  const exact: Found[] = (await repo.exactPairs()).map((p) => ({ a: p.a, b: p.b, relation: strongestMatch(p.kinds) }));

  const { min, max } = await repo.badgeIdRange();
  const exactKeys = new Set(exact.map((p) => `${p.a}:${p.b}`));
  const similar: Found[] = [];
  const chunks: number[] = [];
  if (min !== null) for (let from = min; from <= max; from += CHUNK) chunks.push(from);
  const total = chunks.length;
  let done = 0;
  const worker = async () => {
    for (let from = chunks.shift(); from !== undefined; from = chunks.shift()) {
      for (const p of await repo.similarPairs(from, from + CHUNK, t)) {
        if (!exactKeys.has(`${p.a}:${p.b}`)) similar.push({ ...p, relation: "similar" });
      }
      onProgress?.(++done, total, similar.length);
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  return { exact, similar };
}

/**
 * The previous run's pairs between unchanged badges, plus the pairs of the changed ones
 * against the whole base. Removed badges have no hashes or frames left, so they just drop out.
 */
async function incrementalPairs(
  repo: ScanRepository,
  runId: number,
  changedIds: number[],
  t: Thresholds,
  onProgress?: ScanProgress,
) {
  const kept = await repo.storedPairs(runId, changedIds);
  const exact: Found[] = kept.filter((p) => p.relation !== "similar");
  const similar: Found[] = kept.filter((p) => p.relation === "similar");
  if (!changedIds.length) return { exact, similar };

  const freshExact = (await repo.exactPairsFor(changedIds)).map((p) => ({ a: p.a, b: p.b, relation: strongestMatch(p.kinds), fresh: true }));
  exact.push(...freshExact);
  const exactKeys = new Set(freshExact.map((p) => `${p.a}:${p.b}`));

  const chunks: number[][] = [];
  for (let i = 0; i < changedIds.length; i += CHANGED_CHUNK) chunks.push(changedIds.slice(i, i + CHANGED_CHUNK));
  const total = chunks.length;
  let done = 0;
  const worker = async () => {
    for (let ids = chunks.shift(); ids !== undefined; ids = chunks.shift()) {
      for (const p of await repo.similarPairsFor(ids, t)) {
        if (!exactKeys.has(`${p.a}:${p.b}`)) similar.push({ ...p, relation: "similar", fresh: true });
      }
      onProgress?.(++done, total, similar.length);
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  return { exact, similar };
}
