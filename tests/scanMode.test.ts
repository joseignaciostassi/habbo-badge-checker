import { describe, expect, it } from "vitest";
import { scanMode } from "../src/core/scanMode";

const t = { dhash: 20, silhouette: 10, design: 0.725 };

describe("scan mode", () => {
  it("is incremental with a previous run, the same thresholds and few changes", () => {
    expect(scanMode({ previous: { thresholds: t }, thresholds: t, changed: 1, active: 27_000 })).toBe("incremental");
    expect(scanMode({ previous: { thresholds: t }, thresholds: t, changed: 0, active: 27_000 })).toBe("incremental");
    expect(scanMode({ previous: { thresholds: t }, thresholds: t, changed: 6_750, active: 27_000 })).toBe("incremental");
  });

  it("is full without a previous run, with other thresholds or with many changes", () => {
    expect(scanMode({ previous: null, thresholds: t, changed: 1, active: 27_000 })).toBe("full");
    expect(scanMode({ previous: { thresholds: { ...t, design: 0.7 } }, thresholds: t, changed: 1, active: 27_000 })).toBe("full");
    expect(scanMode({ previous: { thresholds: { ...t, dhash: 18 } }, thresholds: t, changed: 1, active: 27_000 })).toBe("full");
    expect(scanMode({ previous: { thresholds: t }, thresholds: t, changed: 6_751, active: 27_000 })).toBe("full");
  });
});
