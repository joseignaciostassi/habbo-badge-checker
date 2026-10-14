/** RGBA pixel buffer (4 bytes per pixel, row-major). */
export interface RgbaImage {
  width: number;
  height: number;
  data: Buffer;
}

export type ExactKind = "full" | "crop40" | "offset" | "content";

export interface ExactHash {
  kind: ExactKind;
  hash: Buffer; // sha256, 32 bytes
  frameIdx: number;
}

export interface FrameFingerprint {
  frameIdx: number;
  /** 64-bit fingerprints, as signed BIGINT-compatible values. */
  dhash: bigint;
  silhouette: bigint;
  /** Fully transparent frame: excluded from exact and similarity matching. */
  empty: boolean;
}

export interface BadgeAnalysis {
  format: string;
  width: number;
  height: number;
  uniqueFrames: number;
  animated: boolean;
  /** Non-null when the size is not 40x40 / 42x42 (listed for review). */
  sizeNote: string | null;
  frames: FrameFingerprint[];
  exactHashes: ExactHash[];
  /** Unique normalized 40x40 frames (alpha-cleaned). */
  normalized: RgbaImage[];
}
