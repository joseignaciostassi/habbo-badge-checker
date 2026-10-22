import type pg from "pg";
import type { Thresholds } from "../config";
import type { StratumStats } from "../core/calibration";
import type { BadgeInfo } from "./badgeRepo";
import { getPool } from "./db";

export type Label = "similar" | "different" | "unsure";

export interface CalibrationPair {
  id: number;
  a: BadgeInfo;
  b: BadgeInfo;
  dhash: number;
  silhouette: number;
  design: number;
  /** Sampling stratum of the current design score; null once it falls below the sampled range. */
  stratum: number | null;
}

const badge = (r: Record<string, unknown>, p: "a" | "b"): BadgeInfo => ({
  id: r[`${p}_id`] as number,
  fileName: r[`${p}_file`] as string,
  width: r[`${p}_w`] as number,
  height: r[`${p}_h`] as number,
  animated: r[`${p}_anim`] as boolean,
});

const pairSelect = (extra = "") => `
  SELECT ${extra} p.id, p.dhash, p.silhouette, p.design, p.stratum,
         ba.id AS a_id, ba.file_name AS a_file, ba.orig_width AS a_w, ba.orig_height AS a_h, ba.animated AS a_anim,
         bb.id AS b_id, bb.file_name AS b_file, bb.orig_width AS b_w, bb.orig_height AS b_h, bb.animated AS b_anim
  FROM calibration_pairs p JOIN badges ba ON ba.id = p.a JOIN badges bb ON bb.id = p.b`;

export class CalibrationRepository {
  constructor(private readonly pool: pg.Pool = getPool()) {}

  /**
   * Current design score of every sampled pair (best frame pair within the hash prefilter,
   * as in the scan), or null when no frame pair passes it.
   */
  async currentScores(t: Thresholds): Promise<{ id: number; a: number; b: number; design: number | null }[]> {
    const { rows } = await this.pool.query(
      `SELECT p.id, p.a, p.b, max(edge_iou(f.edges, g.edges)) AS design
       FROM calibration_pairs p
       LEFT JOIN badge_frames f ON f.badge_id = p.a AND NOT f.empty
       LEFT JOIN badge_frames g ON g.badge_id = p.b AND NOT g.empty
         AND bit_count((f.dhash # g.dhash)::bit(64)) <= $1
         AND bit_count((f.silhouette # g.silhouette)::bit(64)) <= $2
       GROUP BY p.id`,
      [t.dhash, t.silhouette],
    );
    return rows;
  }

  /**
   * Replaces strata (bounds and populations), re-stratifies existing pairs by their current
   * score (keeping their labels) and adds the newly sampled pairs.
   */
  async saveSample(
    strata: { stratum: number; lo: number; hi: number; population: number }[],
    existing: { id: number; design: number | null; stratum: number | null }[],
    pairs: { a: number; b: number; dhash: number; silhouette: number; design: number; stratum: number }[],
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const s of strata) {
        await client.query(
          `INSERT INTO calibration_strata (stratum, lo, hi, population) VALUES ($1,$2,$3,$4)
           ON CONFLICT (stratum) DO UPDATE SET lo = EXCLUDED.lo, hi = EXCLUDED.hi, population = EXCLUDED.population`,
          [s.stratum, s.lo, s.hi, s.population],
        );
      }
      await client.query(
        `UPDATE calibration_pairs p SET design = coalesce(u.design, 0), stratum = u.stratum
         FROM unnest($1::int[], $2::real[], $3::int[]) AS u(id, design, stratum) WHERE p.id = u.id`,
        [existing.map((p) => p.id), existing.map((p) => p.design), existing.map((p) => p.stratum)],
      );
      await client.query("DELETE FROM calibration_strata WHERE stratum >= $1", [strata.length]);
      await client.query(
        `INSERT INTO calibration_pairs (a, b, dhash, silhouette, design, stratum)
         SELECT * FROM unnest($1::int[], $2::int[], $3::int[], $4::int[], $5::real[], $6::int[])
         ON CONFLICT (a, b) DO NOTHING`,
        [
          pairs.map((p) => p.a),
          pairs.map((p) => p.b),
          pairs.map((p) => p.dhash),
          pairs.map((p) => p.silhouette),
          pairs.map((p) => p.design),
          pairs.map((p) => p.stratum),
        ],
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  /** Next unlabeled pair from the stratum with the fewest labels, so strata fill evenly. */
  async next(): Promise<CalibrationPair | null> {
    const { rows } = await this.pool.query(
      `WITH counts AS (
         SELECT p.stratum, count(l.pair_id) AS labeled
         FROM calibration_pairs p LEFT JOIN calibration_labels l ON l.pair_id = p.id
         WHERE NOT EXISTS (SELECT 1 FROM badges b WHERE b.id IN (p.a, p.b) AND b.missing_at IS NOT NULL)
         GROUP BY p.stratum
         HAVING count(*) > count(l.pair_id)
       ),
       target AS (SELECT stratum FROM counts ORDER BY labeled, random() LIMIT 1)
       ${pairSelect()}
       WHERE p.stratum = (SELECT stratum FROM target)
         AND ba.missing_at IS NULL AND bb.missing_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM calibration_labels l WHERE l.pair_id = p.id)
       ORDER BY random() LIMIT 1`,
    );
    const r = rows[0];
    return r ? { id: r.id, a: badge(r, "a"), b: badge(r, "b"), dhash: r.dhash, silhouette: r.silhouette, design: r.design, stratum: r.stratum } : null;
  }

  async setLabel(pairId: number, label: Label | null): Promise<void> {
    if (label === null) {
      await this.pool.query("DELETE FROM calibration_labels WHERE pair_id = $1", [pairId]);
      return;
    }
    await this.pool.query(
      `INSERT INTO calibration_labels (pair_id, label) VALUES ($1, $2)
       ON CONFLICT (pair_id) DO UPDATE SET label = EXCLUDED.label, labeled_at = now()`,
      [pairId, label],
    );
  }

  async strataStats(): Promise<StratumStats[]> {
    const { rows } = await this.pool.query(
      `SELECT s.stratum, s.lo, s.hi, s.population,
              count(*) FILTER (WHERE l.label = 'similar')::int AS similar,
              count(*) FILTER (WHERE l.label = 'different')::int AS different,
              count(*) FILTER (WHERE l.label = 'unsure')::int AS unsure,
              count(p.id)::int AS sampled
       FROM calibration_strata s
       LEFT JOIN calibration_pairs p ON p.stratum = s.stratum
         AND NOT EXISTS (SELECT 1 FROM badges b WHERE b.id IN (p.a, p.b) AND b.missing_at IS NOT NULL)
       LEFT JOIN calibration_labels l ON l.pair_id = p.id
       GROUP BY s.stratum ORDER BY s.stratum`,
    );
    return rows;
  }

  /** Labeled pairs, most recent first (for review and to spot the noisy ones). */
  async labeled(limit: number): Promise<(CalibrationPair & { label: Label })[]> {
    const { rows } = await this.pool.query(
      `${pairSelect("l.label,")} JOIN calibration_labels l ON l.pair_id = p.id
       ORDER BY l.labeled_at DESC LIMIT $1`,
      [limit],
    );
    return rows.map((r) => ({
      id: r.id, a: badge(r, "a"), b: badge(r, "b"), dhash: r.dhash, silhouette: r.silhouette,
      design: r.design, stratum: r.stratum, label: r.label,
    }));
  }

  async badgeCount(): Promise<number> {
    const { rows } = await this.pool.query("SELECT count(*)::int AS n FROM badges WHERE missing_at IS NULL");
    return rows[0].n;
  }
}
