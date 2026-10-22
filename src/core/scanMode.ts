import type { Thresholds } from "../config";

/** Above this share of changed badges an incremental scan costs about as much as a full one. */
export const INCREMENTAL_MAX_RATIO = 0.25;

/**
 * Whether a scan can reuse the previous run: only the badges that changed since then are
 * compared against the whole base, and the pairs between unchanged badges are kept. Needs a
 * previous run with the same thresholds and few enough changed badges.
 */
export function scanMode(opts: {
  previous: { thresholds: Thresholds } | null;
  thresholds: Thresholds;
  changed: number;
  active: number;
}): "full" | "incremental" {
  const { previous, thresholds: t, changed, active } = opts;
  if (!previous) return "full";
  const p = previous.thresholds;
  if (p.dhash !== t.dhash || p.silhouette !== t.silhouette || p.design !== t.design) return "full";
  return changed <= active * INCREMENTAL_MAX_RATIO ? "incremental" : "full";
}
