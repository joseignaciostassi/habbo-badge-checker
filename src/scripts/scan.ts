import "dotenv/config";
import { parseArgs } from "node:util";
import { config } from "../config";
import { MATCH_LABELS, strongestMatch } from "../core/compare";
import { starClusters } from "../core/starClusters";
import { UnionFind } from "../core/unionFind";
import { closePool, getPool } from "../data/db";
import { type ScanPair, ScanRepository } from "../data/scanRepo";

const CHUNK = 500;
const PARALLEL = 4;

const { values: args } = parseArgs({
  options: { dhash: { type: "string" }, sil: { type: "string" }, design: { type: "string" } },
});

async function main() {
  const t = {
    dhash: args.dhash ? Number(args.dhash) : config.scanThresholds.dhash,
    silhouette: args.sil ? Number(args.sil) : config.scanThresholds.silhouette,
    design: args.design ? Number(args.design) : config.scanThresholds.design,
  };
  const repo = new ScanRepository();
  const startedAt = new Date();
  console.log(`Umbrales: diseño ≥ ${t.design}, prefiltro dHash ≤ ${t.dhash}, silueta ≤ ${t.silhouette}`);

  // 1. Exact duplicates: badges sharing any exact hash.
  const exact: ScanPair[] = (await repo.exactPairs()).map((p) => ({ a: p.a, b: p.b, relation: strongestMatch(p.kinds) }));
  console.log(`Pares exactos: ${exact.length}`);

  // 2. Similar pairs: self-join in chunks of lower badge id, a few chunks at a time.
  const { min, max } = await repo.badgeIdRange();
  const exactKeys = new Set(exact.map((p) => `${p.a}:${p.b}`));
  const similar: ScanPair[] = [];
  const chunks: number[] = [];
  for (let from = min; from <= max; from += CHUNK) chunks.push(from);
  let done = 0;
  const t0 = Date.now();
  const worker = async () => {
    for (let from = chunks.shift(); from !== undefined; from = chunks.shift()) {
      for (const p of await repo.similarPairs(from, from + CHUNK, t)) {
        if (!exactKeys.has(`${p.a}:${p.b}`)) similar.push({ ...p, relation: "similar" });
      }
      done++;
      const total = Math.ceil((max - min + 1) / CHUNK);
      process.stdout.write(`\rSimilitud: bloque ${done}/${total}  ${((Date.now() - t0) / 1000).toFixed(0)}s  pares: ${similar.length}   `);
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  process.stdout.write("\n");

  // 3. Groups. Exact duplicates: connected components. Similar: star clusters (a center
  //    badge plus the badges directly similar to it), since components chain into one blob.
  const ufExact = new UnionFind();
  for (const p of exact) ufExact.union(p.a, p.b);
  const exactGroups = ufExact.groups();
  const similarGroups = starClusters(similar).sort((x, y) => y.length - x.length);

  const sizes = (gs: number[][]) => {
    const buckets = { "2": 0, "3-5": 0, "6-10": 0, "11-50": 0, ">50": 0 };
    for (const g of gs) {
      const n = g.length;
      buckets[n === 2 ? "2" : n <= 5 ? "3-5" : n <= 10 ? "6-10" : n <= 50 ? "11-50" : ">50"]++;
    }
    return buckets;
  };
  const byRelation = Object.fromEntries(
    (["identical", "identical-crop", "same-content"] as const).map((r) => [r, exact.filter((p) => p.relation === r).length]),
  );
  const stats = {
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
    { startedAt, finishedAt: new Date(), thresholds: t, stats },
    [...exact, ...similar],
    [...exactGroups.map((m) => ({ kind: "exact" as const, members: m })), ...similarGroups.map((m) => ({ kind: "similar" as const, members: m }))],
  );

  console.log(`\n===== ESCANEO COMPLETO (${((Date.now() - startedAt.getTime()) / 1000).toFixed(0)}s) =====`);
  console.log(`Pares exactos: ${exact.length}`);
  for (const [r, n] of Object.entries(byRelation)) console.log(`  ${MATCH_LABELS[r as keyof typeof MATCH_LABELS]}: ${n}`);
  console.log(`Grupos de duplicados exactos: ${exactGroups.length} (${stats.badgesInExactGroups} placas)`, stats.exactGroupSizes);
  console.log(`Pares similares (no exactos): ${similar.length}`);
  console.log(`Grupos con similares: ${similarGroups.length} (${stats.badgesInSimilarGroups} placas), el más grande: ${stats.largestSimilarGroup}`, stats.similarGroupSizes);

  const names = new Map<number, string>(
    (await getPool().query("SELECT id, file_name FROM badges")).rows.map((r) => [r.id, r.file_name]),
  );
  const show = (g: number[]) => g.slice(0, 8).map((id) => names.get(id)).join(", ") + (g.length > 8 ? `, … (+${g.length - 8})` : "");
  console.log("\nGrupos exactos más grandes:");
  for (const g of exactGroups.slice(0, 5)) console.log(`  [${g.length}] ${show(g)}`);
  console.log("\nGrupos similares más grandes:");
  for (const g of similarGroups.slice(0, 5)) console.log(`  [${g.length}] ${show(g)}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(closePool);
