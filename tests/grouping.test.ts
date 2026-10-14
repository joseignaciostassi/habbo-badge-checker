import { describe, expect, it } from "vitest";
import { starClusters } from "../src/core/starClusters";
import { UnionFind } from "../src/core/unionFind";

describe("grouping", () => {
  it("union-find joins chains into one component", () => {
    const uf = new UnionFind();
    [[1, 2], [2, 3], [10, 11]].forEach(([a, b]) => uf.union(a, b));
    expect(uf.groups()).toEqual([[1, 2, 3], [10, 11]]);
  });

  it("star clusters do not chain", () => {
    // 1-2-3-4-5 is a chain; 3 is similar to 2 and 4 only.
    const groups = starClusters([{ a: 1, b: 2 }, { a: 2, b: 3 }, { a: 3, b: 4 }, { a: 4, b: 5 }]);
    for (const g of groups) {
      const [center, ...rest] = g;
      expect(rest.length).toBeGreaterThan(0);
      // every member is directly similar to the center
      for (const m of rest) expect(Math.abs(m - center)).toBe(1);
    }
    expect(groups.flat().sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("picks the best-connected badge as center", () => {
    const groups = starClusters([{ a: 1, b: 9 }, { a: 2, b: 9 }, { a: 3, b: 9 }, { a: 3, b: 4 }]);
    expect(groups[0]).toEqual([9, 1, 2, 3]);
  });
});
