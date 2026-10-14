import "dotenv/config";
import { parseArgs } from "node:util";
import { config } from "../config";
import { analyzeBadge } from "../core/analyze";
import { STRATA, stratumOf, thresholdTable } from "../core/calibration";
import { isSimilar, perceptualDistance } from "../core/compare";
import { CalibrationRepository } from "../data/calibrationRepo";
import { closePool, getPool } from "../data/db";
import { ScanRepository } from "../data/scanRepo";
import { getImageStore } from "../storage/localFsStore";
import { rng, syntheticVariants, toPng } from "./syntheticVariants";

const { values: args } = parseArgs({
  options: {
    sample: { type: "boolean", default: false },
    per: { type: "string", default: "12" },
    synthetic: { type: "string", default: "300" },
  },
});

const pct = (v: number | null) => (v === null ? "   -  " : `${(v * 100).toFixed(1).padStart(5)}%`);
/** Stratum bound as a percentage: "72.5%", "75%". */
const fmtPct = (v: number) => `${Math.round(v * 1000) / 10}%`;

/**
 * Candidate pairs over the whole base, stratified by design score. Existing pairs are
 * re-stratified by their current score, then each stratum is topped up with new random pairs
 * until it has `per` pairs, so extra labels go where the sample is thin.
 */
async function sample(per: number) {
  const repo = new CalibrationRepository();
  const scan = new ScanRepository();
  const t = { ...config.thresholds, design: STRATA[0][0] };
  console.log(`Buscando pares candidatos (diseño ≥ ${t.design}, dHash ≤ ${t.dhash}, silueta ≤ ${t.silhouette})…`);
  const existing = (await repo.currentScores(t)).map((p) => {
    const s = p.design === null ? -1 : stratumOf(p.design);
    return { ...p, stratum: s < 0 ? null : s };
  });
  const sampled = new Set(existing.map((p) => `${p.a}:${p.b}`));
  const exact = new Set((await scan.exactPairs()).map((p) => `${p.a}:${p.b}`));
  const { min, max } = await scan.badgeIdRange();

  const have = STRATA.map((_, i) => existing.filter((p) => p.stratum === i).length);
  const wanted = have.map((n) => Math.max(0, per - n));
  const population = STRATA.map(() => 0);
  const seen = STRATA.map(() => 0);
  const reservoirs: { a: number; b: number; dhash: number; silhouette: number; design: number }[][] = STRATA.map(() => []);
  const rand = rng(Date.now() & 0xffff);
  const starts: number[] = [];
  for (let from = min; from <= max; from += 500) starts.push(from);
  let done = 0;
  const worker = async () => {
    for (let from = starts.shift(); from !== undefined; from = starts.shift()) {
      for (const p of await scan.similarPairs(from, from + 500, t)) {
        if (exact.has(`${p.a}:${p.b}`)) continue;
        const s = stratumOf(p.design);
        if (s < 0) continue;
        population[s]++;
        if (sampled.has(`${p.a}:${p.b}`)) continue;
        // Reservoir sampling keeps a uniform sample of each stratum.
        const n = ++seen[s];
        if (reservoirs[s].length < wanted[s]) reservoirs[s].push(p);
        else {
          const j = Math.floor(rand() * n);
          if (j < wanted[s]) reservoirs[s][j] = p;
        }
      }
      process.stdout.write(`\r  bloque ${++done}`);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  process.stdout.write("\n");

  await repo.saveSample(
    STRATA.map(([lo, hi], i) => ({ stratum: i, lo, hi, population: population[i] })),
    existing,
    reservoirs.flatMap((r, i) => r.map((p) => ({ ...p, stratum: i }))),
  );
  const below = existing.filter((p) => p.stratum === null).length;
  if (below) console.log(`  ${below} pares ya muestreados quedaron debajo de ${fmtPct(t.design)} (conservan la etiqueta, no cuentan)`);
  for (const [i, [lo, hi]] of STRATA.entries()) {
    console.log(
      `  ${fmtPct(lo)}–${fmtPct(Math.min(1, hi))}: ${population[i]} pares, ${have[i]} ya en la muestra + ${reservoirs[i].length} nuevos`,
    );
  }
}

/** Synthetic positives: share of modified real badges that still count as similar, per threshold. */
async function syntheticRecall(n: number) {
  const store = getImageStore();
  const { rows } = await getPool().query(
    "SELECT file_name FROM badges WHERE NOT animated ORDER BY md5(file_name) LIMIT $1",
    [n],
  );
  const variants = syntheticVariants(rng(42));
  const results: Record<string, { design: number; prefilter: boolean }[]> = {};
  for (const { file_name } of rows) {
    const base = await analyzeBadge(await store.read(file_name));
    for (const [name, fn] of Object.entries(variants)) {
      const v = await analyzeBadge(await toPng(await fn(base.normalized[0])));
      const d = perceptualDistance(base, v);
      if (!d) continue;
      (results[name] ??= []).push({
        design: d.design,
        prefilter: isSimilar(d, { ...config.thresholds, design: 0 }),
      });
    }
  }
  return results;
}

async function report(syntheticN: number) {
  const repo = new CalibrationRepository();
  const strata = await repo.strataStats();
  const table = thresholdTable(strata, await repo.badgeCount());

  console.log("\nEtiquetas por franja de diseño:");
  console.log("  franja        pares base  parecidas  distintas  no sé");
  for (const s of strata) {
    console.log(
      `  ${`${fmtPct(s.lo)}–${fmtPct(Math.min(1, s.hi))}`.padEnd(12)} ${String(s.population).padStart(10)}` +
        `  ${String(s.similar).padStart(9)}  ${String(s.different).padStart(9)}  ${String(s.unsure).padStart(5)}`,
    );
  }

  const synth = syntheticN > 0 ? await syntheticRecall(syntheticN) : {};
  const names = Object.keys(synth);
  console.log("\nPor umbral de diseño (estimado sobre toda la base):");
  console.log(
    "  umbral     pares   precisión  cobertura  falsos/consulta  etiquetas" + (names.length ? "  | sintéticas detectadas" : ""),
  );
  for (const r of table) {
    const syn = names.length
      ? "  | " + Math.min(...names.map((n) => synth[n].filter((x) => x.prefilter && x.design >= r.threshold).length / synth[n].length)).toLocaleString("es", { style: "percent", maximumFractionDigits: 1 })
      : "";
    console.log(
      `  ≥ ${fmtPct(r.threshold).padEnd(5)}  ${String(r.pairs).padStart(7)}  ${pct(r.precision)}     ${pct(r.recall)}       ${r.falsePerQuery.toFixed(2).padStart(6)}       ${String(r.labels).padStart(5)}${syn}`,
    );
  }
  if (names.length) {
    console.log(`\nVariantes sintéticas (${syntheticN} placas reales modificadas) detectadas por umbral:`);
    console.log("  " + "variante".padEnd(20) + table.map((r) => `≥${fmtPct(r.threshold)}`.padStart(8)).join(""));
    for (const n of names) {
      console.log(
        "  " + n.padEnd(20) +
          table.map((r) => `${((synth[n].filter((x) => x.prefilter && x.design >= r.threshold).length / synth[n].length) * 100).toFixed(0)}%`.padStart(8)).join(""),
      );
    }
  }
  console.log(
    "\nPrecisión: de los pares que se reportarían, cuántos son realmente parecidos según tus etiquetas.\n" +
      `Cobertura: de los pares parecidos (con diseño ≥ ${fmtPct(STRATA[0][0])} y dentro del prefiltro), cuántos se reportarían.\n` +
      "Falsos/consulta: placas no relacionadas que aparecerían, en promedio, al verificar una placa.",
  );
}

async function main() {
  const repo = new CalibrationRepository();
  if (args.sample || !(await repo.hasSample())) await sample(Number(args.per));
  await report(Number(args.synthetic));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(closePool);
