import type { Thresholds } from "../config";
import { strongestMatch } from "../core/compare";
import { starClusters } from "../core/starClusters";
import { UnionFind } from "../core/unionFind";
import { type ScanPair, ScanRepository } from "../data/scanRepo";

const CHUNK = 500;
const PARALLEL = 4;

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
}

function sizes(gs: number[][]) {
  const buckets = { "2": 0, "3-5": 0, "6-10": 0, "11-50": 0, ">50": 0 };
  for (const g of gs) {
    const n = g.length;
    buckets[n === 2 ? "2" : n <= 5 ? "3-5" : n <= 10 ? "6-10" : n <= 50 ? "11-50" : ">50"]++;
  }
  return buckets;
}

/**
 * Full-base scan: exact pairs (shared hashes) and similar pairs (prefilter + design score),
 * grouped and stored, replacing the previous run.
 */
export async function runScan(
  t: Thresholds,
  onProgress?: (done: number, total: number, similarPairs: number) => void,
): Promise<ScanResult> {
  const repo = new ScanRepository();
  const startedAt = new Date();

  // 1. Exact duplicates: badges sharing any exact hash.
  const exact: ScanPair[] = (await repo.exactPairs()).map((p) => ({ a: p.a, b: p.b, relation: strongestMatch(p.kinds) }));

  // 2. Similar pairs: self-join in chunks of lower badge id, a few chunks at a time.
  const { min, max } = await repo.badgeIdRange();
  const exactKeys = new Set(exact.map((p) => `${p.a}:${p.b}`));
  const similar: ScanPair[] = [];
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

  // 3. Groups. Exact duplicates: connected components. Similar: star clusters (a center
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

  await repo.saveScan(
    { startedAt, finishedAt: new Date(), thresholds: t, stats: { ...stats } },
    [...exact, ...similar],
    [...exactGroups.map((m) => ({ kind: "exact" as const, members: m })), ...similarGroups.map((m) => ({ kind: "similar" as const, members: m }))],
  );

  return { stats, exactGroups, similarGroups, seconds: (Date.now() - startedAt.getTime()) / 1000 };
}
