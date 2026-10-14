import { createHash } from "node:crypto";
import { cropToContent, normalize40 } from "./normalize";
import type { ExactHash, RgbaImage } from "./types";

/** SHA-256 over pixels; dimensions are part of the hash so shapes never collide. */
export function pixelHash(prefix: string, img: RgbaImage): Buffer {
  return createHash("sha256").update(`${prefix}:${img.width}x${img.height}:`).update(img.data).digest();
}

/**
 * Exact hashes of one alpha-cleaned, full (uncropped) frame.
 * - full:    the whole original image
 * - crop40:  the centered 40x40 normalization
 * - offset:  for 42x42, every 40x40 window (offsets 0..2), in case the design is off-center
 * - content: tight crop to visible pixels (same design, different padding/position)
 * All crop-type hashes (crop40/offset) share one hash space so they match each other.
 */
export function exactHashes(frame: RgbaImage, frameIdx: number, crop40: RgbaImage): ExactHash[] {
  const out: ExactHash[] = [
    { kind: "full", hash: pixelHash("full", frame), frameIdx },
    { kind: "crop40", hash: pixelHash("crop", crop40), frameIdx },
  ];

  if (frame.width === 42 && frame.height === 42) {
    for (let oy = 0; oy <= 2; oy++) {
      for (let ox = 0; ox <= 2; ox++) {
        if (ox === 1 && oy === 1) continue; // same as crop40
        out.push({ kind: "offset", hash: pixelHash("crop", normalize40(frame, ox, oy)), frameIdx });
      }
    }
  }

  const content = cropToContent(frame);
  if (content) out.push({ kind: "content", hash: pixelHash("content", content), frameIdx });
  return out;
}
