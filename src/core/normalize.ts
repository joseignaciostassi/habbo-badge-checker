import type { RgbaImage } from "./types";

export const SIZE = 40;

/** Copy with every alpha=0 pixel set to (0,0,0,0), dropping hidden colors. */
export function cleanAlpha(img: RgbaImage): RgbaImage {
  const data = Buffer.from(img.data);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) data[i] = data[i + 1] = data[i + 2] = 0;
  }
  return { width: img.width, height: img.height, data };
}

/**
 * Centered placement of one axis into SIZE. When the difference is odd the
 * extra pixel goes to bottom/right (crop removes it there, padding adds it there).
 * Returns the source start and destination start for that axis.
 */
function axisPlacement(dim: number, offset?: number) {
  if (dim >= SIZE) return { src: offset ?? Math.floor((dim - SIZE) / 2), dst: 0, len: SIZE };
  return { src: 0, dst: Math.floor((SIZE - dim) / 2), len: dim };
}

/**
 * Normalizes to SIZE x SIZE without rescaling: crops larger axes (centered, or
 * at the given offset) and pads smaller axes with transparency, centered.
 * Expects an alpha-cleaned image.
 */
export function normalize40(img: RgbaImage, offX?: number, offY?: number): RgbaImage {
  if (img.width === SIZE && img.height === SIZE) return img;

  const x = axisPlacement(img.width, offX);
  const y = axisPlacement(img.height, offY);
  const out = Buffer.alloc(SIZE * SIZE * 4);
  for (let row = 0; row < y.len; row++) {
    const srcStart = ((y.src + row) * img.width + x.src) * 4;
    img.data.copy(out, ((y.dst + row) * SIZE + x.dst) * 4, srcStart, srcStart + x.len * 4);
  }
  return { width: SIZE, height: SIZE, data: out };
}

/** Describes sizes other than 40x40 / 42x42, for the review list. */
export function sizeNote(width: number, height: number): string | null {
  if ((width === 40 && height === 40) || (width === 42 && height === 42)) return null;
  const notes: string[] = [];
  if (width !== height) notes.push("non-square");
  if (width < SIZE || height < SIZE) notes.push("smaller");
  if (width > SIZE || height > SIZE) notes.push("larger");
  if ((width - SIZE) % 2 !== 0 || (height - SIZE) % 2 !== 0) notes.push("odd-diff");
  return notes.join(",");
}

export function isEmpty(img: RgbaImage): boolean {
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i] !== 0) return false;
  return true;
}

/** Tight crop to the bounding box of visible (alpha>0) pixels, or null if empty. */
export function cropToContent(img: RgbaImage): RgbaImage | null {
  let minX = img.width, minY = img.height, maxX = -1, maxY = -1;
  for (let yy = 0; yy < img.height; yy++) {
    for (let xx = 0; xx < img.width; xx++) {
      if (img.data[(yy * img.width + xx) * 4 + 3] !== 0) {
        if (xx < minX) minX = xx;
        if (xx > maxX) maxX = xx;
        if (yy < minY) minY = yy;
        if (yy > maxY) maxY = yy;
      }
    }
  }
  if (maxX < 0) return null;
  const w = maxX - minX + 1, h = maxY - minY + 1;
  const out = Buffer.alloc(w * h * 4);
  for (let row = 0; row < h; row++) {
    const s = ((minY + row) * img.width + minX) * 4;
    img.data.copy(out, row * w * 4, s, s + w * 4);
  }
  return { width: w, height: h, data: out };
}
