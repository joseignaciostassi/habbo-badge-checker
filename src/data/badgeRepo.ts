import type pg from "pg";
import type { Thresholds } from "../config";
import { ANALYSIS_VERSION } from "../core/analyze";
import type { IndexedFile } from "../core/folderDiff";
import { EDGE_BITS, edgeMapToBits } from "../core/perceptual";
import type { BadgeAnalysis, ExactKind, FrameFingerprint } from "../core/types";
import { getPool } from "./db";

export type { IndexedFile };

export interface BadgeToSave {
  fileName: string;
  size: number;
  mtime: Date;
  analysis: BadgeAnalysis;
}

export interface IndexSummary {
  /** Active badges (in the folder). */
  total: number;
  /** Indexed badges whose file left the folder. */
  missing: number;
  bySize: { size: string; count: number }[];
  animated: { fileName: string; frames: number }[];
  rareSizes: { fileName: string; size: string; note: string }[];
  errors: { fileName: string; error: string }[];
}

export interface BadgeInfo {
  id: number;
  fileName: string;
  width: number;
  height: number;
  animated: boolean;
}

export interface ExactHit extends BadgeInfo {
  /** Kinds of the stored hashes that matched. */
  kinds: ExactKind[];
}

export interface SimilarHit extends BadgeInfo {
  dhash: number;
  silhouette: number;
  /** Design similarity 0..1 (edge map IoU). */
  design: number;
}

export interface BadgeRepository {
  indexedFiles(): Promise<Map<string, IndexedFile>>;
  indexErrors(): Promise<Map<string, Date>>;
  saveBadges(batch: BadgeToSave[]): Promise<void>;
  markMissing(fileNames: string[]): Promise<void>;
  recordError(fileName: string, error: string): Promise<void>;
  summary(): Promise<IndexSummary>;
  findExact(hashes: Buffer[]): Promise<ExactHit[]>;
  findSimilar(frames: FrameFingerprint[], t: Thresholds, limit: number): Promise<SimilarHit[]>;
  getBadge(id: number): Promise<BadgeInfo | null>;
}

const BADGE_COLS = "b.id, b.file_name, b.orig_width, b.orig_height, b.animated";

function toInfo(r: Record<string, unknown>): BadgeInfo {
  return {
    id: r.id as number,
    fileName: r.file_name as string,
    width: r.orig_width as number,
    height: r.orig_height as number,
    animated: r.animated as boolean,
  };
}

export class PgBadgeRepository implements BadgeRepository {
  constructor(private readonly pool: pg.Pool = getPool()) {}

  async indexedFiles(): Promise<Map<string, IndexedFile>> {
    const { rows } = await this.pool.query("SELECT file_name, file_size, file_mtime, analysis_version, missing_at FROM badges");
    return new Map(
      rows.map((r) => [r.file_name, { size: r.file_size, mtime: r.file_mtime, version: r.analysis_version, missingAt: r.missing_at }]),
    );
  }

  /** When each file last failed to index. */
  async indexErrors(): Promise<Map<string, Date>> {
    const { rows } = await this.pool.query("SELECT file_name, at FROM index_errors");
    return new Map(rows.map((r) => [r.file_name, r.at]));
  }

  /** Upserts a batch in one transaction, replacing any previous hashes/frames. */
  async saveBadges(batch: BadgeToSave[]): Promise<void> {
    if (!batch.length) return;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const b of batch) {
        const a = b.analysis;
        const { rows } = await client.query(
          `INSERT INTO badges (file_name, file_size, file_mtime, format, orig_width, orig_height,
                               unique_frames, animated, size_note, analysis_version, indexed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
           ON CONFLICT (file_name) DO UPDATE SET
             file_size=EXCLUDED.file_size, file_mtime=EXCLUDED.file_mtime, format=EXCLUDED.format,
             orig_width=EXCLUDED.orig_width, orig_height=EXCLUDED.orig_height,
             unique_frames=EXCLUDED.unique_frames, animated=EXCLUDED.animated,
             size_note=EXCLUDED.size_note, analysis_version=EXCLUDED.analysis_version, indexed_at=now(),
             missing_at=NULL
           RETURNING id`,
          [b.fileName, b.size, b.mtime, a.format, a.width, a.height, a.uniqueFrames, a.animated, a.sizeNote, ANALYSIS_VERSION],
        );
        const id: number = rows[0].id;
        await client.query("DELETE FROM badge_exact_hashes WHERE badge_id = $1", [id]);
        await client.query("DELETE FROM badge_frames WHERE badge_id = $1", [id]);
        await client.query(
          `INSERT INTO badge_exact_hashes (badge_id, kind, hash, frame_idx)
           SELECT $1, * FROM unnest($2::text[], $3::bytea[], $4::int[])`,
          [id, a.exactHashes.map((h) => h.kind), a.exactHashes.map((h) => h.hash), a.exactHashes.map((h) => h.frameIdx)],
        );
        await client.query(
          `INSERT INTO badge_frames (badge_id, frame_idx, dhash, silhouette, empty, edges)
           SELECT $1, f, d, s, e, g::bit(${EDGE_BITS})
           FROM unnest($2::int[], $3::bigint[], $4::bigint[], $5::bool[], $6::text[]) AS u(f, d, s, e, g)`,
          [
            id,
            a.frames.map((f) => f.frameIdx),
            a.frames.map((f) => f.dhash.toString()),
            a.frames.map((f) => f.silhouette.toString()),
            a.frames.map((f) => f.empty),
            a.frames.map((f) => edgeMapToBits(f.edges)),
          ],
        );
      }
      await client.query("DELETE FROM index_errors WHERE file_name = ANY($1)", [batch.map((b) => b.fileName)]);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  /**
   * Soft delete: keeps the badge row (and what references it) but drops its hashes and frames,
   * so lookups and scans no longer match it.
   */
  async markMissing(fileNames: string[]): Promise<void> {
    if (!fileNames.length) return;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        "UPDATE badges SET missing_at = now() WHERE file_name = ANY($1) AND missing_at IS NULL RETURNING id",
        [fileNames],
      );
      const ids = rows.map((r) => r.id);
      await client.query("DELETE FROM badge_exact_hashes WHERE badge_id = ANY($1)", [ids]);
      await client.query("DELETE FROM badge_frames WHERE badge_id = ANY($1)", [ids]);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  async recordError(fileName: string, error: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO index_errors (file_name, error) VALUES ($1, $2)
       ON CONFLICT (file_name) DO UPDATE SET error = EXCLUDED.error, at = now()`,
      [fileName, error],
    );
  }

  async findExact(hashes: Buffer[]): Promise<ExactHit[]> {
    if (!hashes.length) return [];
    const { rows } = await this.pool.query(
      `SELECT ${BADGE_COLS}, array_agg(DISTINCT h.kind) AS kinds
       FROM badge_exact_hashes h JOIN badges b ON b.id = h.badge_id
       WHERE h.hash = ANY($1::bytea[])
       GROUP BY b.id ORDER BY b.file_name`,
      [hashes],
    );
    return rows.map((r) => ({ ...toInfo(r), kinds: r.kinds }));
  }

  /**
   * Hashes prefilter (both Hamming distances within thresholds), then the design score
   * (edge_iou) verifies. Keeps the best frame pair per badge.
   */
  async findSimilar(frames: FrameFingerprint[], t: Thresholds, limit: number): Promise<SimilarHit[]> {
    if (!frames.length) return [];
    const { rows } = await this.pool.query(
      `WITH q AS (
         SELECT d AS dhash, s AS silhouette, g::bit(${EDGE_BITS}) AS edges
         FROM unnest($1::bigint[], $2::bigint[], $3::text[]) AS u(d, s, g)
       ),
       pre AS (
         SELECT f.badge_id, f.edges AS f_edges, q.edges AS q_edges,
                bit_count((f.dhash # q.dhash)::bit(64))::int AS d1,
                bit_count((f.silhouette # q.silhouette)::bit(64))::int AS d2
         FROM badge_frames f CROSS JOIN q
         WHERE NOT f.empty
           AND bit_count((f.dhash # q.dhash)::bit(64)) <= $4
           AND bit_count((f.silhouette # q.silhouette)::bit(64)) <= $5
       ),
       scored AS (SELECT badge_id, d1, d2, edge_iou(q_edges, f_edges) AS design FROM pre),
       best AS (
         SELECT DISTINCT ON (badge_id) badge_id, d1, d2, design FROM scored
         WHERE design >= $6
         ORDER BY badge_id, design DESC
       )
       SELECT ${BADGE_COLS}, best.d1, best.d2, best.design
       FROM best JOIN badges b ON b.id = best.badge_id
       ORDER BY best.design DESC, best.d1 + best.d2, b.file_name
       LIMIT $7`,
      [
        frames.map((f) => f.dhash.toString()),
        frames.map((f) => f.silhouette.toString()),
        frames.map((f) => edgeMapToBits(f.edges)),
        t.dhash,
        t.silhouette,
        t.design,
        limit,
      ],
    );
    return rows.map((r) => ({ ...toInfo(r), dhash: r.d1, silhouette: r.d2, design: r.design }));
  }

  async getBadge(id: number): Promise<BadgeInfo | null> {
    const { rows } = await this.pool.query(`SELECT ${BADGE_COLS} FROM badges b WHERE b.id = $1`, [id]);
    return rows[0] ? toInfo(rows[0]) : null;
  }

  async summary(): Promise<IndexSummary> {
    const [total, bySize, animated, rare, errors] = await Promise.all([
      this.pool.query(
        "SELECT count(*) FILTER (WHERE missing_at IS NULL)::int AS n, count(missing_at)::int AS missing FROM badges",
      ),
      this.pool.query(
        `SELECT orig_width || 'x' || orig_height AS size, count(*)::int AS count
         FROM badges WHERE missing_at IS NULL GROUP BY 1 ORDER BY 2 DESC`,
      ),
      this.pool.query("SELECT file_name, unique_frames FROM badges WHERE animated AND missing_at IS NULL ORDER BY file_name"),
      this.pool.query(
        `SELECT file_name, orig_width || 'x' || orig_height AS size, size_note
         FROM badges WHERE size_note IS NOT NULL AND missing_at IS NULL ORDER BY orig_width, orig_height, file_name`,
      ),
      this.pool.query("SELECT file_name, error FROM index_errors ORDER BY file_name"),
    ]);
    return {
      total: total.rows[0].n,
      missing: total.rows[0].missing,
      bySize: bySize.rows,
      animated: animated.rows.map((r) => ({ fileName: r.file_name, frames: r.unique_frames })),
      rareSizes: rare.rows.map((r) => ({ fileName: r.file_name, size: r.size, note: r.size_note })),
      errors: errors.rows.map((r) => ({ fileName: r.file_name, error: r.error })),
    };
  }
}
