import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { ANALYSIS_VERSION, analyzeBadge } from "../core/analyze";
import { type BadgeToSave, PgBadgeRepository } from "../data/badgeRepo";
import { closePool } from "../data/db";
import { getImageStore } from "../storage/localFsStore";

const BATCH = 100;

const { values: args } = parseArgs({
  options: { limit: { type: "string" } },
});

function progress(done: number, total: number, started: number, errors: number) {
  const secs = (Date.now() - started) / 1000;
  const rate = done / Math.max(secs, 0.001);
  const eta = rate > 0 ? Math.round((total - done) / rate) : 0;
  process.stdout.write(
    `\r[${done}/${total}] ${((done / total) * 100).toFixed(1)}%  ${rate.toFixed(0)}/s  ETA ${eta}s  errores: ${errors}   `,
  );
}

async function main() {
  const store = getImageStore();
  const repo = new PgBadgeRepository();

  const [files, indexed] = await Promise.all([store.list(), repo.indexedFiles()]);
  files.sort((a, b) => a.name.localeCompare(b.name));
  let pending = files.filter((f) => {
    const prev = indexed.get(f.name);
    return (
      !prev ||
      prev.size !== f.size ||
      prev.mtime.getTime() !== f.mtime.getTime() ||
      prev.version < ANALYSIS_VERSION
    );
  });
  if (args.limit) pending = pending.slice(0, Number(args.limit));

  const present = new Set(files.map((f) => f.name));
  const missing = [...indexed.keys()].filter((name) => !present.has(name));
  console.log(`Archivos en carpeta: ${files.length} | ya indexados: ${indexed.size} | a procesar: ${pending.length}`);

  const started = Date.now();
  let done = 0, errors = 0;
  for (let i = 0; i < pending.length; i += BATCH) {
    const chunk = pending.slice(i, i + BATCH);
    const results = await Promise.all(
      chunk.map(async (f): Promise<BadgeToSave | null> => {
        try {
          return { fileName: f.name, size: f.size, mtime: f.mtime, analysis: await analyzeBadge(await store.read(f.name)) };
        } catch (e) {
          errors++;
          await repo.recordError(f.name, e instanceof Error ? e.message : String(e));
          return null;
        }
      }),
    );
    await repo.saveBadges(results.filter((r): r is BadgeToSave => r !== null));
    done += chunk.length;
    progress(done, pending.length, started, errors);
  }
  if (pending.length) process.stdout.write("\n");
  console.log(`Procesados en esta corrida: ${done} (${errors} con error) en ${((Date.now() - started) / 1000).toFixed(1)}s`);

  await printSummary(repo, missing);
}

async function printSummary(repo: PgBadgeRepository, missing: string[]) {
  const s = await repo.summary();
  console.log(`\n===== RESUMEN =====`);
  console.log(`Total indexado: ${s.total}`);
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
  if (missing.length) console.log(`\nIndexados que ya no están en la carpeta: ${missing.length}`);

  await mkdir("reports", { recursive: true });
  await writeFile("reports/rare-sizes.csv", ["file_name,size,note", ...s.rareSizes.map((r) => `${r.fileName},${r.size},"${r.note}"`)].join("\n"));
  await writeFile("reports/animated.csv", ["file_name,unique_frames", ...s.animated.map((a) => `${a.fileName},${a.frames}`)].join("\n"));
  await writeFile("reports/errors.csv", ["file_name,error", ...s.errors.map((e) => `${e.fileName},"${e.error.replace(/"/g, "'")}"`)].join("\n"));
  console.log(`\nListados completos en reports/ (rare-sizes.csv, animated.csv, errors.csv)`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
}).finally(closePool);
