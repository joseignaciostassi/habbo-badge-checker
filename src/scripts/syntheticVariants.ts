import sharp from "sharp";
import type { RgbaImage } from "../core/types";

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const copy = (i: RgbaImage): RgbaImage => ({ ...i, data: Buffer.from(i.data) });
const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

/**
 * Modifications an admin would still call "the same badge", applied to a normalized
 * 40x40 frame. Used as positives when calibrating thresholds.
 */
export function syntheticVariants(r: () => number): Record<string, (i: RgbaImage) => RgbaImage | Promise<RgbaImage>> {
  return {
    "recoloreada leve": (i) => {
      const o = copy(i);
      for (let p = 0; p < o.data.length; p += 4) {
        o.data[p] = clamp(o.data[p] + 12);
        o.data[p + 2] = clamp(o.data[p + 2] - 8);
      }
      return o;
    },
    "otros colores": (i) => {
      const o = copy(i);
      for (let p = 0; p < o.data.length; p += 4) {
        const [rr, g, b] = [o.data[p], o.data[p + 1], o.data[p + 2]];
        o.data[p] = g;
        o.data[p + 1] = b;
        o.data[p + 2] = rr;
      }
      return o;
    },
    "desplazada 1px": (i) => {
      const o = copy(i);
      o.data.fill(0);
      for (let y = 0; y < 40; y++) i.data.copy(o.data, (y * 40 + 1) * 4, y * 160, y * 160 + 156);
      return o;
    },
    ruido: (i) => {
      const o = copy(i);
      for (let p = 0; p < o.data.length; p += 4) {
        if (o.data[p + 3] && r() < 0.08) for (let c = 0; c < 3; c++) o.data[p + c] = clamp(o.data[p + c] + (r() - 0.5) * 60);
      }
      return o;
    },
    "bloque editado": (i) => {
      const o = copy(i);
      const bx = 12 + Math.floor(r() * 12), by = 12 + Math.floor(r() * 12);
      const c = [r() * 255, r() * 255, r() * 255].map(Math.floor);
      for (let y = by; y < by + 5; y++) {
        for (let x = bx; x < bx + 5; x++) {
          const p = (y * 40 + x) * 4;
          if (o.data[p + 3]) o.data.set(c, p);
        }
      }
      return o;
    },
    "paleta 16 colores": async (i) => {
      const gif = await sharp(i.data, { raw: { width: 40, height: 40, channels: 4 } }).gif({ colours: 16, dither: 0 }).toBuffer();
      const { data } = await sharp(gif).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      return { width: 40, height: 40, data };
    },
  };
}

export function toPng(img: RgbaImage): Promise<Buffer> {
  return sharp(img.data, { raw: { width: img.width, height: img.height, channels: 4 } }).png().toBuffer();
}
