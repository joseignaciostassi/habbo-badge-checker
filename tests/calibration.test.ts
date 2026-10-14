import { describe, expect, it } from "vitest";
import { stratumOf, thresholdTable } from "../src/core/calibration";

const s = (stratum: number, lo: number, hi: number, population: number, similar: number, different: number) =>
  ({ stratum, lo, hi, population, similar, different, unsure: 0 });

describe("calibration estimates", () => {
  it("maps design scores to strata, including 1.0", () => {
    expect(stratumOf(0.5)).toBe(-1);
    expect(stratumOf(0.55)).toBe(0);
    expect(stratumOf(0.8)).toBe(5);
    expect(stratumOf(1)).toBe(8);
  });

  it("weights labeled shares by stratum population", () => {
    // low stratum: 1000 pairs, 10% similar → 100 true; high stratum: 100 pairs, all similar → 100 true
    const table = thresholdTable([s(0, 0.6, 0.8, 1000, 1, 9), s(1, 0.8, 1.0001, 100, 10, 0)], 1000);
    const [low, high] = table;
    expect(low.pairs).toBe(1100);
    expect(low.precision).toBeCloseTo(200 / 1100);
    expect(low.recall).toBeCloseTo(1);
    expect(high.precision).toBe(1);
    expect(high.recall).toBeCloseTo(0.5);
    expect(high.falsePerQuery).toBe(0);
    // 900 false pairs, each seen from both badges, over 1000 badges
    expect(low.falsePerQuery).toBeCloseTo(1.8);
  });
});
