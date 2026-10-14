import type { RgbaImage } from "./types";

const GRAY_BG = 128;

/** Area-average (box) resampling of a single-channel image to arbitrary size. */
export function boxResize(src: Float64Array, w: number, h: number, nw: number, nh: number): Float64Array {
  const out = new Float64Array(nw * nh);
  const sx = w / nw, sy = h / nh;
  for (let oy = 0; oy < nh; oy++) {
    const y0 = oy * sy, y1 = y0 + sy;
    for (let ox = 0; ox < nw; ox++) {
      const x0 = ox * sx, x1 = x0 + sx;
      let sum = 0;
      for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
        const wy = Math.min(y + 1, y1) - Math.max(y, y0);
        for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
          const wx = Math.min(x + 1, x1) - Math.max(x, x0);
          sum += src[y * w + x] * wx * wy;
        }
      }
      out[oy * nw + ox] = sum / (sx * sy);
    }
  }
  return out;
}

function bitsToSigned64(bits: number[]): bigint {
  let v = 0n;
  for (const b of bits) v = (v << 1n) | BigInt(b);
  return BigInt.asIntN(64, v);
}

/** dHash of the image composited over mid gray: 9x8 luminance, horizontal gradient signs. */
export function dHash(img: RgbaImage): bigint {
  const n = img.width * img.height;
  const gray = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = img.data[i * 4 + 3] / 255;
    const lum = 0.299 * img.data[i * 4] + 0.587 * img.data[i * 4 + 1] + 0.114 * img.data[i * 4 + 2];
    gray[i] = lum * a + GRAY_BG * (1 - a);
  }
  const small = boxResize(gray, img.width, img.height, 9, 8);
  const bits: number[] = [];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) bits.push(small[y * 9 + x] < small[y * 9 + x + 1] ? 1 : 0);
  }
  return bitsToSigned64(bits);
}

/** Silhouette hash: alpha mask (visible / not visible) at 8x8, bit set when >=50% covered. */
export function silhouetteHash(img: RgbaImage): bigint {
  const n = img.width * img.height;
  const mask = new Float64Array(n);
  for (let i = 0; i < n; i++) mask[i] = img.data[i * 4 + 3] > 0 ? 1 : 0;
  const small = boxResize(mask, img.width, img.height, 8, 8);
  return bitsToSigned64(Array.from(small, (v) => (v >= 0.5 ? 1 : 0)));
}

/** Edge map row width: 40 pixels + 1 zero padding column, so 1px shifts never wrap rows. */
export const EDGE_ROW = 41;
/** Rows of zero padding between the two planes, so 1px shifts never cross from one to the other. */
const EDGE_GAP_ROWS = 2;
/** Start of the second plane (bottom-neighbour boundaries); the first (right-neighbour) starts at 0. */
const EDGE_PLANE2 = (40 + EDGE_GAP_ROWS) * EDGE_ROW;
export const EDGE_BITS = EDGE_PLANE2 + 40 * EDGE_ROW;
/** Sum of |dR|+|dG|+|dB| above which two visible neighbours count as a color boundary. */
const EDGE_COLOR_DIFF = 48;

/**
 * Oriented color-boundary map of a normalized 40x40 frame, in two planes: the first marks
 * pixels that differ from their right neighbour (vertical boundaries), the second those that
 * differ from their bottom neighbour (horizontal boundaries). A difference is a visibility
 * change or a color change. It captures the pixel-art design while ignoring the palette, so
 * recolored versions keep the same map; keeping orientations apart stops a horizontal stroke
 * from matching a vertical one.
 */
export function edgeMap(img: RgbaImage): Uint8Array {
  const d = img.data;
  const differ = (p: number, q: number) => {
    const av = d[p + 3] > 0, bv = d[q + 3] > 0;
    if (av !== bv) return true;
    if (!av) return false;
    return Math.abs(d[p] - d[q]) + Math.abs(d[p + 1] - d[q + 1]) + Math.abs(d[p + 2] - d[q + 2]) > EDGE_COLOR_DIFF;
  };
  const map = new Uint8Array(EDGE_BITS);
  for (let y = 0; y < 40; y++) {
    for (let x = 0; x < 40; x++) {
      const p = (y * 40 + x) * 4;
      if (x < 39 && differ(p, p + 4)) map[y * EDGE_ROW + x] = 1;
      if (y < 39 && differ(p, p + 160)) map[EDGE_PLANE2 + y * EDGE_ROW + x] = 1;
    }
  }
  return map;
}

/**
 * Design similarity: best intersection-over-union of two edge maps (both planes together)
 * over the 9 shifts of up to 1px. Mirrors the SQL function edge_iou().
 */
export function edgeIoU(a: Uint8Array, b: Uint8Array): number {
  let best = 0;
  for (const shift of [0, 1, -1, EDGE_ROW, -EDGE_ROW, EDGE_ROW - 1, EDGE_ROW + 1, -EDGE_ROW + 1, -EDGE_ROW - 1]) {
    let inter = 0, union = 0;
    for (let i = 0; i < EDGE_BITS; i++) {
      const j = i + shift;
      const bv = j >= 0 && j < EDGE_BITS ? b[j] : 0;
      if (a[i] && bv) inter++;
      if (a[i] || bv) union++;
    }
    if (union && inter / union > best) best = inter / union;
  }
  return best;
}

export function edgeMapToBits(map: Uint8Array): string {
  return map.join("");
}

export function hamming(a: bigint, b: bigint): number {
  let x = BigInt.asUintN(64, a ^ b);
  let c = 0;
  while (x) {
    x &= x - 1n;
    c++;
  }
  return c;
}
