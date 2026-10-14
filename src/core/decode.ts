import sharp from "sharp";
import type { RgbaImage } from "./types";

export interface DecodedBadge {
  format: string;
  width: number;
  height: number;
  /** Full composited (coalesced) frames, RGBA. */
  frames: RgbaImage[];
}

/**
 * Decodes a GIF/PNG (format sniffed from content, not the extension).
 * libvips composites each GIF page onto the previous ones, so every frame
 * is a full coalesced image, never a raw partial frame.
 */
export async function decodeBadge(input: Buffer): Promise<DecodedBadge> {
  const img = sharp(input, { animated: true, limitInputPixels: 4096 * 4096 });
  const meta = await img.metadata();
  const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  const width = info.width;
  const pages = meta.pages ?? 1;
  const pageHeight = meta.pageHeight ?? info.height;
  const frameBytes = width * pageHeight * 4;

  if (pages === 1) {
    return { format: meta.format ?? "unknown", width, height: pageHeight, frames: [{ width, height: pageHeight, data }] };
  }

  const frames: RgbaImage[] = [];
  for (let p = 0; p < pages; p++) {
    frames.push({ width, height: pageHeight, data: data.subarray(p * frameBytes, (p + 1) * frameBytes) });
  }
  return { format: meta.format ?? "unknown", width, height: pageHeight, frames };
}
