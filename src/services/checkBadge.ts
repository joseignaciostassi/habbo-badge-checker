import type { Thresholds } from "../config";
import { analyzeBadge } from "../core/analyze";
import { type ExactMatch, MATCH_PRIORITY, strongestMatch } from "../core/compare";
import type { BadgeAnalysis } from "../core/types";
import type { BadgeInfo, BadgeRepository, SimilarHit } from "../data/badgeRepo";

export interface ExactResult extends BadgeInfo {
  match: ExactMatch;
}

export interface CheckResult {
  analysis: BadgeAnalysis;
  exact: ExactResult[];
  /** Similar badges, excluding those already reported as exact. */
  similar: SimilarHit[];
}

/** Checks an image against the index: exact duplicates and similar badges, always both. */
export async function checkBadge(
  repo: BadgeRepository,
  image: Buffer,
  thresholds: Thresholds,
  limit = 200,
): Promise<CheckResult> {
  const analysis = await analyzeBadge(image);
  const frames = analysis.frames.filter((f) => !f.empty);

  const [exactHits, similar] = await Promise.all([
    repo.findExact(analysis.exactHashes.map((h) => h.hash)),
    repo.findSimilar(frames, thresholds, limit),
  ]);

  const exact = exactHits
    .map(({ kinds, ...info }) => ({ ...info, match: strongestMatch(kinds) }))
    .sort(
      (a, b) =>
        MATCH_PRIORITY.indexOf(a.match) - MATCH_PRIORITY.indexOf(b.match) || a.fileName.localeCompare(b.fileName),
    );

  const exactIds = new Set(exact.map((e) => e.id));
  return { analysis, exact, similar: similar.filter((s) => !exactIds.has(s.id)) };
}
