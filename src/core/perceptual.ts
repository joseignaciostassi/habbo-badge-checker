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

export function hamming(a: bigint, b: bigint): number {
  let x = BigInt.asUintN(64, a ^ b);
  let c = 0;
  while (x) {
    x &= x - 1n;
    c++;
  }
  return c;
}
