import { describe, expect, it } from "vitest";
import { analyzeBadge } from "../src/core/analyze";
import { exactMatch, perceptualDistance } from "../src/core/compare";
import { cleanAlpha, normalize40, sizeNote } from "../src/core/normalize";
import { blank, border, design, getPx, mapColors, paste, setPx, toGif, toPng } from "./helpers";

const SIM = { dhash: 10, silhouette: 8 };
const RED = [220, 30, 40, 255] as const;
const WHITE = [255, 255, 255, 255] as const;

/** 40x40 badge: 36x36 design centered on a canvas. */
function badge40(seed: number) {
  return paste(blank(40, 40), design(seed), 2, 2);
}

describe("normalization", () => {
  it("crops 42x42 by 1px on each side", () => {
    const img = border(paste(blank(42, 42, [9, 9, 9, 255]), badge40(1), 1, 1), [...RED], 1);
    const n = normalize40(cleanAlpha(img));
    expect(n.width).toBe(40);
    expect(n.data.equals(cleanAlpha(badge40(1)).data)).toBe(true);
  });

  it("odd differences drop the extra pixel at bottom/right", () => {
    const img = blank(41, 41);
    setPx(img, 0, 0, [1, 2, 3, 255]); // kept: crop starts at 0
    setPx(img, 40, 40, [4, 5, 6, 255]); // dropped
    const n = normalize40(img);
    expect(getPx(n, 0, 0)).toEqual([1, 2, 3, 255]);
    expect(n.data.subarray(4).every((v) => v === 0)).toBe(true);
  });

  it("pads smaller images with centered transparency (extra pixel bottom/right)", () => {
    const img = blank(35, 35, [10, 20, 30, 255]);
    const n = normalize40(img);
    expect(getPx(n, 1, 1)[3]).toBe(0);
    expect(getPx(n, 2, 2)).toEqual([10, 20, 30, 255]); // floor(5/2) = 2
    expect(getPx(n, 36, 36)).toEqual([10, 20, 30, 255]);
    expect(getPx(n, 37, 37)[3]).toBe(0);
    expect(sizeNote(35, 35)).toBe("smaller,odd-diff");
    expect(sizeNote(42, 42)).toBeNull();
  });

  it("clears hidden colors under alpha=0", async () => {
    const a = badge40(2);
    const b = { ...a, data: Buffer.from(a.data) };
    setPx(b, 0, 0, [200, 100, 50, 0]);
    expect(exactMatch(await analyzeBadge(await toPng(a)), await analyzeBadge(await toPng(b)))).toBe("identical");
  });
});

describe("main detection cases", () => {
  it("same badge at 40x40 and 42x42 with an extra 1px border", async () => {
    const a = await analyzeBadge(await toPng(badge40(3)));
    const b = await analyzeBadge(await toPng(border(paste(blank(42, 42), badge40(3), 1, 1), [...RED])));
    expect(exactMatch(a, b)).toBe("identical-crop");
  });

  it("42x42 with off-center design is caught by crop offsets", async () => {
    const solid = paste(blank(40, 40, [...WHITE]), design(4, 40), 0, 0); // fills the whole 40x40
    const off = border(paste(blank(42, 42, [...RED]), solid, 0, 2), [...RED], 0);
    const a = await analyzeBadge(await toPng(solid));
    const b = await analyzeBadge(await toPng(off));
    expect(b.exactHashes.some((h) => h.kind === "offset")).toBe(true);
    expect(exactMatch(a, b)).toBe("identical-crop");
  });

  it("two 42x42 differing only in the outer border are identical when cropped", async () => {
    const inner = badge40(5);
    const a = await analyzeBadge(await toPng(border(paste(blank(42, 42), inner, 1, 1), [...RED])));
    const b = await analyzeBadge(await toPng(border(paste(blank(42, 42), inner, 1, 1), [0, 90, 200, 255])));
    expect(exactMatch(a, b)).toBe("identical-crop");
  });

  it("slightly recolored badge is similar, not exact", async () => {
    const orig = badge40(6);
    const tinted = mapColors(orig, ([r, g, b, a]) => [Math.min(255, r + 12), g, Math.max(0, b - 8), a]);
    const a = await analyzeBadge(await toPng(orig));
    const b = await analyzeBadge(await toPng(tinted));
    expect(exactMatch(a, b)).toBeNull();
    const d = perceptualDistance(a, b)!;
    expect(d.dhash).toBeLessThanOrEqual(SIM.dhash);
    expect(d.silhouette).toBeLessThanOrEqual(SIM.silhouette);
  });

  it("badge shifted by 1px is similar (and same content)", async () => {
    const a = await analyzeBadge(await toPng(paste(blank(40, 40), design(7), 2, 2)));
    const b = await analyzeBadge(await toPng(paste(blank(40, 40), design(7), 3, 2)));
    expect(exactMatch(a, b)).toBe("same-content");
    const d = perceptualDistance(a, b)!;
    expect(d.dhash).toBeLessThanOrEqual(SIM.dhash);
    expect(d.silhouette).toBeLessThanOrEqual(SIM.silhouette);
  });

  it("white border vs transparent border are NOT equal", async () => {
    const inner = paste(blank(40, 40), design(8, 38), 1, 1);
    const a = await analyzeBadge(await toPng(inner));
    const b = await analyzeBadge(await toPng(border(inner, [...WHITE])));
    expect(exactMatch(a, b)).toBeNull();
  });

  it("unrelated badges are not similar", async () => {
    const a = await analyzeBadge(await toPng(badge40(9)));
    const b = await analyzeBadge(await toPng(badge40(10)));
    expect(exactMatch(a, b)).toBeNull();
    expect(perceptualDistance(a, b)!.dhash).toBeGreaterThan(SIM.dhash);
  });
});

describe("animation", () => {
  it("GIF with repeated identical frames is treated as static", async () => {
    const f = badge40(11);
    const a = await analyzeBadge(await toGif([f, f, f]));
    expect(a.uniqueFrames).toBe(1);
    expect(a.animated).toBe(false);
    expect(exactMatch(a, await analyzeBadge(await toGif([f])))).toBe("identical");
  });

  it("animated badge matches its static version", async () => {
    const f1 = badge40(12), f2 = badge40(13);
    const anim = await analyzeBadge(await toGif([f1, f2]));
    expect(anim.animated).toBe(true);
    expect(anim.uniqueFrames).toBe(2);
    const stat = await analyzeBadge(await toGif([f2]));
    expect(exactMatch(anim, stat)).toBe("identical");
    expect(perceptualDistance(anim, stat)!.dhash).toBe(0);
  });

  it("animated badge with an empty frame: empty frame never matches", async () => {
    const empty = blank(40, 40);
    const a = await analyzeBadge(await toGif([badge40(14), empty]));
    const b = await analyzeBadge(await toGif([badge40(15), empty]));
    expect(a.animated).toBe(true);
    expect(a.frames.filter((f) => f.empty)).toHaveLength(1);
    expect(exactMatch(a, b)).toBeNull();
    expect(perceptualDistance(a, b)!.dhash).toBeGreaterThan(SIM.dhash);
    expect(exactMatch(a, await analyzeBadge(await toPng(badge40(14))))).toBe("identical");
  });
});
