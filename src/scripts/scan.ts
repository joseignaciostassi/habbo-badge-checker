import "dotenv/config";
import { parseArgs } from "node:util";
import { config } from "../config";
import { MATCH_LABELS } from "../core/compare";
import { closePool, getPool } from "../data/db";
import { DatabaseUnavailableError, prepareDatabase } from "../data/setup";
import { UpdateBusyError, withUpdateLock } from "../data/updateLock";
import { runScan } from "../services/scanBadges";

const { values: args } = parseArgs({
  options: { dhash: { type: "string" }, sil: { type: "string" }, design: { type: "string" } },
});

async function main() {
  await prepareDatabase();
  const t = {
    dhash: args.dhash ? Number(args.dhash) : config.scanThresholds.dhash,
    silhouette: args.sil ? Number(args.sil) : config.scanThresholds.silhouette,
    design: args.design ? Number(args.design) : config.scanThresholds.design,
  };
  console.log(`Umbrales: diseño ≥ ${t.design}, prefiltro dHash ≤ ${t.dhash}, silueta ≤ ${t.silhouette}`);
  const t0 = Date.now();
  const { stats, exactGroups, similarGroups, seconds } = await withUpdateLock(() =>
    runScan(t, (done, total, pairs) =>
      process.stdout.write(`\rSimilitud: bloque ${done}/${total}  ${((Date.now() - t0) / 1000).toFixed(0)}s  pares: ${pairs}   `),
    ),
  );
  process.stdout.write("\n");

  console.log(`\n===== ESCANEO COMPLETO (${seconds.toFixed(0)}s) =====`);
  console.log(`Pares exactos: ${stats.exactPairs}`);
  for (const [r, n] of Object.entries(stats.exactByRelation)) console.log(`  ${MATCH_LABELS[r as keyof typeof MATCH_LABELS]}: ${n}`);
  console.log(`Grupos de duplicados exactos: ${stats.exactGroups} (${stats.badgesInExactGroups} placas)`, stats.exactGroupSizes);
  console.log(`Pares similares (no exactos): ${stats.similarPairs}`);
  console.log(`Grupos con similares: ${stats.similarGroups} (${stats.badgesInSimilarGroups} placas), el más grande: ${stats.largestSimilarGroup}`, stats.similarGroupSizes);

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
    console.error(e instanceof UpdateBusyError || e instanceof DatabaseUnavailableError ? e.message : e);
    process.exitCode = 1;
  })
  .finally(closePool);
