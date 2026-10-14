import sharp from "sharp";
import type { RgbaImage } from "../src/core/types";

type Rgba = [number, number, number, number];
const T: Rgba = [0, 0, 0, 0];

/** Deterministic PRNG (mulberry32). */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function blank(w: number, h: number, color: Rgba = T): RgbaImage {
  const data = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set(color, i * 4);
  return { width: w, height: h, data };
}

export function setPx(img: RgbaImage, x: number, y: number, c: Rgba) {
  img.data.set(c, (y * img.width + x) * 4);
}

export function getPx(img: RgbaImage, x: number, y: number): Rgba {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
}

/**
 * A badge-like design: a rounded shape of random 4x4 color blocks from a small
 * palette (GIF-safe), transparent around it. `size` is the design's square size.
 */
export function design(seed: number, size = 36): RgbaImage {
  const r = rng(seed);
  const palette: Rgba[] = Array.from({ length: 5 }, () => [
    Math.floor(r() * 256), Math.floor(r() * 256), Math.floor(r() * 256), 255,
  ]);
  const img = blank(size, size);
  const blocks = Math.ceil(size / 4);
  const grid = Array.from({ length: blocks * blocks }, () => palette[Math.floor(r() * palette.length)]);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (Math.hypot(x - c, y - c) > size / 2) continue;
      setPx(img, x, y, grid[Math.floor(y / 4) * blocks + Math.floor(x / 4)]);
    }
  }
  return img;
}

/** Paste `src` onto `dst` at (x, y), replacing pixels. */
export function paste(dst: RgbaImage, src: RgbaImage, x: number, y: number): RgbaImage {
  const out = { ...dst, data: Buffer.from(dst.data) };
  for (let yy = 0; yy < src.height; yy++) {
    for (let xx = 0; xx < src.width; xx++) setPx(out, x + xx, y + yy, getPx(src, xx, yy));
  }
  return out;
}

/** Fill the outer `width`-px ring with a color. */
export function border(img: RgbaImage, color: Rgba, width = 1): RgbaImage {
  const out = { ...img, data: Buffer.from(img.data) };
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (x < width || y < width || x >= img.width - width || y >= img.height - width) setPx(out, x, y, color);
    }
  }
  return out;
}

export function mapColors(img: RgbaImage, fn: (c: Rgba) => Rgba): RgbaImage {
  const out = { ...img, data: Buffer.from(img.data) };
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) setPx(out, x, y, fn(getPx(img, x, y)));
  return out;
}

export function toPng(img: RgbaImage): Promise<Buffer> {
  return sharp(img.data, { raw: { width: img.width, height: img.height, channels: 4 } }).png().toBuffer();
}

/** Encodes one or more frames as a (possibly animated) GIF. */
export function toGif(frames: RgbaImage[]): Promise<Buffer> {
  const { width, height } = frames[0];
  const data = Buffer.concat(frames.map((f) => f.data));
  return sharp(data, { raw: { width, height: height * frames.length, channels: 4, pageHeight: height } })
    .gif({ dither: 0, loop: 0, delay: frames.map(() => 100) })
    .toBuffer();
}
