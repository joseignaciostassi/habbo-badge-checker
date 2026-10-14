import type pg from "pg";
import type { BadgeAnalysis } from "../core/types";
import { getPool } from "./db";

export interface IndexedFile {
  size: number;
  mtime: Date;
}

export interface BadgeToSave {
  fileName: string;
  size: number;
  mtime: Date;
  analysis: BadgeAnalysis;
}

export interface IndexSummary {
  total: number;
  bySize: { size: string; count: number }[];
  animated: { fileName: string; frames: number }[];
  rareSizes: { fileName: string; size: string; note: string }[];
  errors: { fileName: string; error: string }[];
}

export interface BadgeRepository {
  indexedFiles(): Promise<Map<string, IndexedFile>>;
  saveBadges(batch: BadgeToSave[]): Promise<void>;
  recordError(fileName: string, error: string): Promise<void>;
  summary(): Promise<IndexSummary>;
}

export class PgBadgeRepository implements BadgeRepository {
  constructor(private readonly pool: pg.Pool = getPool()) {}

  async indexedFiles(): Promise<Map<string, IndexedFile>> {
    const { rows } = await this.pool.query("SELECT file_name, file_size, file_mtime FROM badges");
    return new Map(rows.map((r) => [r.file_name, { size: r.file_size, mtime: r.file_mtime }]));
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
                               unique_frames, animated, size_note, indexed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
           ON CONFLICT (file_name) DO UPDATE SET
             file_size=EXCLUDED.file_size, file_mtime=EXCLUDED.file_mtime, format=EXCLUDED.format,
             orig_width=EXCLUDED.orig_width, orig_height=EXCLUDED.orig_height,
             unique_frames=EXCLUDED.unique_frames, animated=EXCLUDED.animated,
             size_note=EXCLUDED.size_note, indexed_at=now()
           RETURNING id`,
          [b.fileName, b.size, b.mtime, a.format, a.width, a.height, a.uniqueFrames, a.animated, a.sizeNote],
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
          `INSERT INTO badge_frames (badge_id, frame_idx, dhash, silhouette, empty)
           SELECT $1, * FROM unnest($2::int[], $3::bigint[], $4::bigint[], $5::bool[])`,
          [
            id,
            a.frames.map((f) => f.frameIdx),
            a.frames.map((f) => f.dhash.toString()),
            a.frames.map((f) => f.silhouette.toString()),
            a.frames.map((f) => f.empty),
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

  async recordError(fileName: string, error: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO index_errors (file_name, error) VALUES ($1, $2)
       ON CONFLICT (file_name) DO UPDATE SET error = EXCLUDED.error, at = now()`,
      [fileName, error],
    );
  }

  async summary(): Promise<IndexSummary> {
    const [total, bySize, animated, rare, errors] = await Promise.all([
      this.pool.query("SELECT count(*)::int AS n FROM badges"),
      this.pool.query(
        `SELECT orig_width || 'x' || orig_height AS size, count(*)::int AS count
         FROM badges GROUP BY 1 ORDER BY 2 DESC`,
      ),
      this.pool.query("SELECT file_name, unique_frames FROM badges WHERE animated ORDER BY file_name"),
      this.pool.query(
        `SELECT file_name, orig_width || 'x' || orig_height AS size, size_note
         FROM badges WHERE size_note IS NOT NULL ORDER BY orig_width, orig_height, file_name`,
      ),
      this.pool.query("SELECT file_name, error FROM index_errors ORDER BY file_name"),
    ]);
    return {
      total: total.rows[0].n,
      bySize: bySize.rows,
      animated: animated.rows.map((r) => ({ fileName: r.file_name, frames: r.unique_frames })),
      rareSizes: rare.rows.map((r) => ({ fileName: r.file_name, size: r.size, note: r.size_note })),
      errors: errors.rows.map((r) => ({ fileName: r.file_name, error: r.error })),
    };
  }
}
