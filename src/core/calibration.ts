/** Design-score strata used for sampling: [lo, hi). The last one includes 1.0. */
export const STRATA: [number, number][] = [
  [0.55, 0.6], [0.6, 0.65], [0.65, 0.7], [0.7, 0.75], [0.75, 0.8],
  [0.8, 0.85], [0.85, 0.9], [0.9, 0.95], [0.95, 1.0001],
];

export function stratumOf(design: number): number {
  return STRATA.findIndex(([lo, hi]) => design >= lo && design < hi);
}

export interface StratumStats {
  stratum: number;
  lo: number;
  hi: number;
  /** Candidate pairs in the whole base within this stratum (after the hash prefilter). */
  population: number;
  similar: number;
  different: number;
  unsure: number;
}

export interface ThresholdRow {
  threshold: number;
  /** Estimated pairs reported at this threshold (whole base). */
  pairs: number;
  /** Estimated truly-similar pairs among them. */
  truePairs: number;
  precision: number | null;
  /** Share of all truly-similar candidate pairs (design >= lowest stratum) kept. */
  recall: number | null;
  /** Estimated unrelated badges shown per uploaded badge. */
  falsePerQuery: number;
  /** Labels backing the estimate (strata at or above the threshold). */
  labels: number;
}

/**
 * Stratified estimate: within each stratum, P(similar) is the labeled share (unsure ignored),
 * scaled by the stratum's population. Thresholds align with stratum boundaries.
 */
export function thresholdTable(strata: StratumStats[], badgeCount: number): ThresholdRow[] {
  const est = strata.map((s) => {
    const n = s.similar + s.different;
    const p = n ? s.similar / n : null;
    return { ...s, n, p, truePairs: p === null ? 0 : p * s.population };
  });
  const allTrue = est.reduce((sum, s) => sum + s.truePairs, 0);
  return strata.map((s) => {
    const above = est.filter((e) => e.lo >= s.lo);
    const pairs = above.reduce((sum, e) => sum + e.population, 0);
    const labeled = above.filter((e) => e.p !== null);
    const labeledPairs = labeled.reduce((sum, e) => sum + e.population, 0);
    const truePairs = labeled.reduce((sum, e) => sum + e.truePairs, 0);
    const precision = labeledPairs ? truePairs / labeledPairs : null;
    const falsePairs = precision === null ? 0 : pairs * (1 - precision);
    return {
      threshold: s.lo,
      pairs,
      truePairs,
      precision,
      recall: allTrue ? truePairs / allTrue : null,
      // Each false pair shows up in two badges' result lists.
      falsePerQuery: (2 * falsePairs) / badgeCount,
      labels: above.reduce((sum, e) => sum + e.n, 0),
    };
  });
}
