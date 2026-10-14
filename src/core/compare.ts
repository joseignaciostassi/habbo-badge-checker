import { edgeIoU, hamming } from "./perceptual";
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

/** Strongest relation implied by a set of matched hash kinds. */
export function strongestMatch(kinds: ExactKind[]): ExactMatch {
  const groups = new Set(kinds.map(hashGroup));
  return PRIORITY.find((p) => groups.has(p))!;
}

export const MATCH_PRIORITY = PRIORITY;

/** Strongest exact relation between two analyses, if any frame pair shares a hash. */
export function exactMatch(a: BadgeAnalysis, b: BadgeAnalysis): ExactMatch | null {
  const bHashes = new Set(b.exactHashes.map((h) => h.hash.toString("hex")));
  const found = new Set(a.exactHashes.filter((h) => bHashes.has(h.hash.toString("hex"))).map((h) => hashGroup(h.kind)));
  return PRIORITY.find((p) => found.has(p)) ?? null;
}

export interface Similarity {
  dhash: number;
  silhouette: number;
  /** Design similarity 0..1 (edge map IoU). */
  design: number;
}

/** Best frame pair (highest design score) over all non-empty frames (any frame may match). */
export function perceptualDistance(a: BadgeAnalysis, b: BadgeAnalysis): Similarity | null {
  let best: Similarity | null = null;
  for (const fa of a.frames) {
    if (fa.empty) continue;
    for (const fb of b.frames) {
      if (fb.empty) continue;
      const d = {
        dhash: hamming(fa.dhash, fb.dhash),
        silhouette: hamming(fa.silhouette, fb.silhouette),
        design: edgeIoU(fa.edges, fb.edges),
      };
      if (!best || d.design > best.design) best = d;
    }
  }
  return best;
}

/** Similarity rule: hashes as a coarse prefilter, design score as the verification. */
export function isSimilar(s: Similarity, t: { dhash: number; silhouette: number; design: number }): boolean {
  return s.dhash <= t.dhash && s.silhouette <= t.silhouette && s.design >= t.design;
}
