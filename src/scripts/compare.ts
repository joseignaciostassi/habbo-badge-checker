import "dotenv/config";
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { config } from "../config";
import { MATCH_LABELS } from "../core/compare";
import { PgBadgeRepository } from "../data/badgeRepo";
import { closePool } from "../data/db";
import { checkBadge } from "../services/checkBadge";

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    dhash: { type: "string" },
    sil: { type: "string" },
    limit: { type: "string", default: "30" },
  },
});

async function main() {
  const file = positionals[0];
  if (!file) {
    console.error("Uso: npm run compare -- <imagen> [--dhash N] [--sil N] [--limit N]");
    process.exitCode = 1;
    return;
  }
  const thresholds = {
    dhash: args.dhash ? Number(args.dhash) : config.thresholds.dhash,
    silhouette: args.sil ? Number(args.sil) : config.thresholds.silhouette,
  };
  const limit = Number(args.limit);

  const { analysis: a, exact, similar } = await checkBadge(new PgBadgeRepository(), await readFile(file), thresholds, limit);

  console.log(`Placa: ${file}`);
  console.log(
    `  ${a.format} ${a.width}x${a.height}, ${a.uniqueFrames} frame(s) único(s)${a.animated ? " — ANIMADA" : ""}` +
      (a.sizeNote ? ` [tamaño: ${a.sizeNote}]` : ""),
  );

  console.log(`\nDuplicados exactos: ${exact.length}`);
  for (const e of exact) {
    console.log(`  ${e.fileName.padEnd(28)} ${`${e.width}x${e.height}`.padEnd(7)} ${MATCH_LABELS[e.match]}`);
  }

  console.log(`\nSimilares (dHash ≤ ${thresholds.dhash}, silueta ≤ ${thresholds.silhouette}): ${similar.length}${similar.length >= limit ? "+" : ""}`);
  for (const s of similar) {
    console.log(`  ${s.fileName.padEnd(28)} ${`${s.width}x${s.height}`.padEnd(7)} dHash ${String(s.dhash).padStart(2)}  silueta ${String(s.silhouette).padStart(2)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
}).finally(closePool);
