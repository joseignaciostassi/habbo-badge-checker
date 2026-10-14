import { createHash } from "node:crypto";
import { decodeBadge } from "./decode";
import { exactHashes } from "./exactHashes";
import { cleanAlpha, isEmpty, normalize40, sizeNote } from "./normalize";
import { dHash, edgeMap, silhouetteHash } from "./perceptual";

/** Bump when fingerprints change: the indexer reprocesses badges with an older version. */
export const ANALYSIS_VERSION = 2;
import type { BadgeAnalysis, ExactHash, FrameFingerprint, RgbaImage } from "./types";

/** Drops repeated frames (identical pixels after alpha cleaning). */
function uniqueFrames(frames: RgbaImage[]): RgbaImage[] {
  if (frames.length === 1) return frames;
  const seen = new Set<string>();
  return frames.filter((f) => {
    const key = createHash("sha256").update(f.data).digest("hex");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Full analysis of one badge file. Shared by the indexer, the CLI and the web. */
export async function analyzeBadge(input: Buffer): Promise<BadgeAnalysis> {
  const decoded = await decodeBadge(input);
  const frames = uniqueFrames(decoded.frames.map(cleanAlpha));

  const fingerprints: FrameFingerprint[] = [];
  const hashes: ExactHash[] = [];
  const normalized: RgbaImage[] = [];

  frames.forEach((frame, idx) => {
    const n = normalize40(frame);
    normalized.push(n);
    const empty = isEmpty(frame);
    fingerprints.push({ frameIdx: idx, dhash: dHash(n), silhouette: silhouetteHash(n), edges: edgeMap(n), empty });
    // Empty frames would match every other empty frame: no exact hashes for them.
    if (!empty) hashes.push(...exactHashes(frame, idx, n));
  });

  return {
    format: decoded.format,
    width: decoded.width,
    height: decoded.height,
    uniqueFrames: frames.length,
    animated: frames.length > 1,
    sizeNote: sizeNote(decoded.width, decoded.height),
    frames: fingerprints,
    exactHashes: hashes,
    normalized,
  };
}
