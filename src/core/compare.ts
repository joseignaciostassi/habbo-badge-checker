import { hamming } from "./perceptual";
import type { BadgeAnalysis, ExactKind } from "./types";

export type ExactMatch = "identical" | "identical-crop" | "same-content";

/** Hash group: crop40 and offset hashes are comparable with each other. */
export function hashGroup(kind: ExactKind): ExactMatch {
  if (kind === "full") return "identical";
  if (kind === "content") return "same-content";
  return "identical-crop";
}

const PRIORITY: ExactMatch[] = ["identical", "identical-crop", "same-content"];

export const MATCH_LABELS: Record<ExactMatch, string> = {
  identical: "Idéntica",
  "identical-crop": "Idéntica al recortar a 40x40",
  "same-content": "Mismo contenido, distinto relleno/posición",
};

/** Strongest exact relation between two analyses, if any frame pair shares a hash. */
export function exactMatch(a: BadgeAnalysis, b: BadgeAnalysis): ExactMatch | null {
  const bHashes = new Set(b.exactHashes.map((h) => h.hash.toString("hex")));
  const found = new Set(a.exactHashes.filter((h) => bHashes.has(h.hash.toString("hex"))).map((h) => hashGroup(h.kind)));
  return PRIORITY.find((p) => found.has(p)) ?? null;
}

/** Smallest distances over all non-empty frame pairs (any frame may match). */
export function perceptualDistance(a: BadgeAnalysis, b: BadgeAnalysis): { dhash: number; silhouette: number } | null {
  let best: { dhash: number; silhouette: number } | null = null;
  for (const fa of a.frames) {
    if (fa.empty) continue;
    for (const fb of b.frames) {
      if (fb.empty) continue;
      const d = { dhash: hamming(fa.dhash, fb.dhash), silhouette: hamming(fa.silhouette, fb.silhouette) };
      if (!best || d.dhash + d.silhouette < best.dhash + best.silhouette) best = d;
    }
  }
  return best;
}
