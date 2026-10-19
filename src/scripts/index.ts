import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { MASS_MISSING_RATIO } from "../core/folderDiff";
import { PgBadgeRepository } from "../data/badgeRepo";
import { closePool } from "../data/db";
import { UpdateBusyError, withUpdateLock } from "../data/updateLock";
import { runIndex } from "../services/indexBadges";

const { values: args } = parseArgs({
  options: { limit: { type: "string" }, "allow-mass-missing": { type: "boolean", default: false } },
});

async function main() {
  const started = Date.now();
  let shownTotal = false;
  const r = await withUpdateLock(() =>
    runIndex({
      limit: args.limit ? Number(args.limit) : undefined,
      allowMassMissing: args["allow-mass-missing"],
      onProgress(done, total, errors) {
        shownTotal = true;
        const secs = (Date.now() - started) / 1000;
        const rate = done / Math.max(secs, 0.001);
        const eta = rate > 0 ? Math.round((total - done) / rate) : 0;
        process.stdout.write(
          `\r[${done}/${total}] ${((done / total) * 100).toFixed(1)}%  ${rate.toFixed(0)}/s  ETA ${eta}s  errores: ${errors}   `,
        );
      },
    }),
  );
  if (shownTotal) process.stdout.write("\n");
  const d = r.diff;
  console.log(
    `Nuevas: ${d.added.length} | modificadas: ${d.changed.length} | a reanalizar: ${d.outdated.length} | ` +
      `restauradas: ${d.restored.length} | faltantes: ${d.missing.length}`,
  );
  console.log(`Procesados en esta corrida: ${r.processed} (${r.errors} con error) en ${r.seconds.toFixed(1)}s`);
  if (r.markedMissing) console.log(`Marcadas como eliminadas (ya no están en la carpeta): ${r.markedMissing}`);
  if (r.blockedMissing) {
    console.log(
      `\nATENCIÓN: faltan ${r.blockedMissing} de ${d.active} placas (más del ${MASS_MISSING_RATIO * 100}%). ` +
        `No se marcó ninguna como eliminada: revisá BADGES_DIR.\n` +
        `Si es correcto, corré: npm run index -- --allow-mass-missing`,
    );
  }

  await printSummary(new PgBadgeRepository());
}

async function printSummary(repo: PgBadgeRepository) {
  const s = await repo.summary();
  console.log(`\n===== RESUMEN =====`);
  console.log(`Total indexado: ${s.total}${s.missing ? ` (+${s.missing} eliminadas de la carpeta)` : ""}`);
  console.log(`\nPor tamaño:`);
  for (const r of s.bySize.slice(0, 15)) console.log(`  ${r.size.padEnd(8)} ${r.count}`);
  if (s.bySize.length > 15) {
    const rest = s.bySize.slice(15);
    console.log(`  (+${rest.length} tamaños más, ${rest.reduce((n, r) => n + r.count, 0)} placas)`);
  }
  console.log(`\nAnimadas: ${s.animated.length}`);
  for (const a of s.animated) console.log(`  ${a.fileName} (${a.frames} frames únicos)`);
  console.log(`\nTamaños distintos de 40x40/42x42: ${s.rareSizes.length}`);
  console.log(`\nArchivos con error: ${s.errors.length}`);
  for (const e of s.errors) console.log(`  ${e.fileName}: ${e.error}`);

  await mkdir("reports", { recursive: true });
  await writeFile("reports/rare-sizes.csv", ["file_name,size,note", ...s.rareSizes.map((r) => `${r.fileName},${r.size},"${r.note}"`)].join("\n"));
  await writeFile("reports/animated.csv", ["file_name,unique_frames", ...s.animated.map((a) => `${a.fileName},${a.frames}`)].join("\n"));
  await writeFile("reports/errors.csv", ["file_name,error", ...s.errors.map((e) => `${e.fileName},"${e.error.replace(/"/g, "'")}"`)].join("\n"));
  console.log(`\nListados completos en reports/ (rare-sizes.csv, animated.csv, errors.csv)`);
}

main().catch((e) => {
  console.error(e instanceof UpdateBusyError ? e.message : e);
  process.exitCode = 1;
}).finally(closePool);
