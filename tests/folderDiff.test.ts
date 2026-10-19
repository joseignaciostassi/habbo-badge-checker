import { describe, expect, it } from "vitest";
import { folderDiff, hasChanges, type IndexedFile, pendingFiles } from "../src/core/folderDiff";

const T0 = new Date("2026-01-01T00:00:00Z");
const T1 = new Date("2026-02-01T00:00:00Z");
const file = (name: string, size = 100, mtime = T0) => ({ name, size, mtime });
const idx = (size = 100, mtime = T0, version = 3, missingAt: Date | null = null): IndexedFile => ({ size, mtime, version, missingAt });

/** n indexed badges A0..A(n-1), all present unless removed. */
function base(n: number) {
  const names = Array.from({ length: n }, (_, i) => `A${i}.gif`);
  return { names, indexed: new Map(names.map((n) => [n, idx()])) };
}

describe("folder diff", () => {
  it("no changes when folder and index agree", () => {
    const { names, indexed } = base(5);
    const d = folderDiff(names.map((n) => file(n)), indexed, new Map(), 3);
    expect(hasChanges(d)).toBe(false);
    expect(d.active).toBe(5);
  });

  it("classifies added, changed, outdated, missing and restored", () => {
    const indexed = new Map([
      ["SAME.gif", idx()],
      ["SIZE.gif", idx(90)],
      ["TIME.gif", idx(100, T1)],
      ["OLD.gif", idx(100, T0, 2)],
      ["GONE.gif", idx()],
      ["BACK.gif", idx(100, T0, 3, T1)],
      ["STILLGONE.gif", idx(100, T0, 3, T1)],
    ]);
    const files = ["SAME", "SIZE", "TIME", "OLD", "BACK", "NEW"].map((n) => file(`${n}.gif`));
    const d = folderDiff(files, indexed, new Map(), 3);
    expect(d.added.map((f) => f.name)).toEqual(["NEW.gif"]);
    expect(d.changed.map((f) => f.name)).toEqual(["SIZE.gif", "TIME.gif"]);
    expect(d.outdated.map((f) => f.name)).toEqual(["OLD.gif"]);
    expect(d.restored.map((f) => f.name)).toEqual(["BACK.gif"]);
    expect(d.missing).toEqual(["GONE.gif"]);
    expect(d.active).toBe(5);
    expect(pendingFiles(d).map((f) => f.name)).toEqual(["BACK.gif", "NEW.gif", "OLD.gif", "SIZE.gif", "TIME.gif"]);
  });

  it("files that failed are retried only once they change", () => {
    const errors = new Map([["BAD.gif", T1]]);
    expect(hasChanges(folderDiff([file("BAD.gif", 5, T0)], new Map(), errors, 3))).toBe(false);
    const later = new Date(T1.getTime() + 1000);
    expect(folderDiff([file("BAD.gif", 5, later)], new Map(), errors, 3).added).toHaveLength(1);
  });

  it("safety brake when too many badges disappear at once", () => {
    const { names, indexed } = base(100);
    expect(folderDiff(names.slice(5).map((n) => file(n)), indexed, new Map(), 3).massMissing).toBe(false); // 5%
    expect(folderDiff(names.slice(6).map((n) => file(n)), indexed, new Map(), 3).massMissing).toBe(true); // 6%
    expect(folderDiff([], indexed, new Map(), 3).massMissing).toBe(true); // empty folder
  });
});
