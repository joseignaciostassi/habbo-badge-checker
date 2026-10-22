import type pg from "pg";
import type { Thresholds } from "../config";
import type { ExactKind } from "../core/types";
import type { BadgeInfo } from "./badgeRepo";
import { getPool } from "./db";

export type Relation = "identical" | "identical-crop" | "same-content" | "similar";
export type GroupKind = "exact" | "similar";

export interface ScanPair {
  a: number;
  b: number;
  relation: Relation;
  dhash?: number;
  silhouette?: number;
  design?: number;
}

export interface ScanRun {
  id: number;
  startedAt: Date;
  finishedAt: Date;
  thresholds: Thresholds;
  stats: Record<string, unknown>;
}

export interface ScanGroup {
  groupId: number;
  members: BadgeInfo[];
  pairs: ScanPair[];
}

export class ScanRepository {
  constructor(private readonly pool: pg.Pool = getPool()) {}

  async badgeIdRange(): Promise<{ min: number; max: number }> {
    const { rows } = await this.pool.query("SELECT min(id) AS min, max(id) AS max FROM badges WHERE missing_at IS NULL");
    return rows[0];
  }

  /** Every pair of badges sharing at least one exact hash, with the kinds involved. */
  async exactPairs(): Promise<{ a: number; b: number; kinds: ExactKind[] }[]> {
    const { rows } = await this.pool.query(
      `SELECT x.badge_id AS a, y.badge_id AS b, array_agg(DISTINCT x.kind) AS kinds
       FROM badge_exact_hashes x
       JOIN badge_exact_hashes y ON y.hash = x.hash AND y.badge_id > x.badge_id
       GROUP BY 1, 2`,
    );
    return rows;
  }

  /** Like exactPairs, but only the pairs involving any of `ids` (each pair once, a < b). */
  async exactPairsFor(ids: number[]): Promise<{ a: number; b: number; kinds: ExactKind[] }[]> {
    const { rows } = await this.pool.query(
      `SELECT least(x.badge_id, y.badge_id) AS a, greatest(x.badge_id, y.badge_id) AS b, array_agg(DISTINCT x.kind) AS kinds
       FROM badge_exact_hashes x
       JOIN badge_exact_hashes y ON y.hash = x.hash AND y.badge_id <> x.badge_id
       WHERE x.badge_id = ANY($1)
       GROUP BY 1, 2`,
      [ids],
    );
    return rows;
  }

  /** Similar pairs whose lower badge id is in [fromId, toId): best frame pair per badge pair. */
  async similarPairs(fromId: number, toId: number, t: Thresholds): Promise<Required<Omit<ScanPair, "relation">>[]> {
    const { rows } = await this.pool.query(
      `WITH pre AS (
         SELECT f.badge_id AS a, g.badge_id AS b,
                bit_count((f.dhash # g.dhash)::bit(64))::int AS d1,
                bit_count((f.silhouette # g.silhouette)::bit(64))::int AS d2,
                f.edges AS fe, g.edges AS ge
         FROM badge_frames f
         JOIN badge_frames g ON g.badge_id > f.badge_id
         WHERE f.badge_id >= $1 AND f.badge_id < $2 AND NOT f.empty AND NOT g.empty
           AND bit_count((f.dhash # g.dhash)::bit(64)) <= $3
           AND bit_count((f.silhouette # g.silhouette)::bit(64)) <= $4
       ),
       scored AS (SELECT a, b, d1, d2, edge_iou(fe, ge) AS design FROM pre)
       SELECT DISTINCT ON (a, b) a, b, d1 AS dhash, d2 AS silhouette, design
       FROM scored WHERE design >= $5
       ORDER BY a, b, design DESC`,
      [fromId, toId, t.dhash, t.silhouette, t.design],
    );
    return rows;
  }

  /** Like similarPairs, but the pairs involving any of `ids` against the whole base (each pair once, a < b). */
  async similarPairsFor(ids: number[], t: Thresholds): Promise<Required<Omit<ScanPair, "relation">>[]> {
    const { rows } = await this.pool.query(
      `WITH pre AS (
         SELECT least(f.badge_id, g.badge_id) AS a, greatest(f.badge_id, g.badge_id) AS b,
                bit_count((f.dhash # g.dhash)::bit(64))::int AS d1,
                bit_count((f.silhouette # g.silhouette)::bit(64))::int AS d2,
                f.edges AS fe, g.edges AS ge
         FROM badge_frames f
         JOIN badge_frames g ON g.badge_id <> f.badge_id
         WHERE f.badge_id = ANY($1) AND NOT f.empty AND NOT g.empty
           AND bit_count((f.dhash # g.dhash)::bit(64)) <= $2
           AND bit_count((f.silhouette # g.silhouette)::bit(64)) <= $3
       ),
       scored AS (SELECT a, b, d1, d2, edge_iou(fe, ge) AS design FROM pre)
       SELECT DISTINCT ON (a, b) a, b, d1 AS dhash, d2 AS silhouette, design
       FROM scored WHERE design >= $4
       ORDER BY a, b, design DESC`,
      [ids, t.dhash, t.silhouette, t.design],
    );
    return rows;
  }

  /** Replaces the previous scan with this one. */
  async saveScan(
    run: Omit<ScanRun, "id">,
    pairs: ScanPair[],
    groups: { kind: GroupKind; members: number[] }[],
  ): Promise<number> {
    return this.transaction(async (client) => {
      await client.query("DELETE FROM scan_runs");
      const { rows } = await client.query(
        "INSERT INTO scan_runs (started_at, finished_at, thresholds, stats) VALUES ($1,$2,$3,$4) RETURNING id",
        [run.startedAt, run.finishedAt, run.thresholds, run.stats],
      );
      const runId: number = rows[0].id;
      await insertPairs(client, runId, pairs);
      await insertGroups(client, runId, groups);
      return runId;
    });
  }

  /**
   * Updates a scan in place after an incremental pass: replaces the pairs touching `changedIds`
   * with `newPairs` and rewrites the groups; the other pairs stay as they were.
   */
  async updateScan(
    runId: number,
    run: Omit<ScanRun, "id">,
    changedIds: number[],
    newPairs: ScanPair[],
    groups: { kind: GroupKind; members: number[] }[],
  ): Promise<void> {
    await this.transaction(async (client) => {
      await client.query("UPDATE scan_runs SET started_at=$2, finished_at=$3, thresholds=$4, stats=$5 WHERE id=$1", [
        runId,
        run.startedAt,
        run.finishedAt,
        run.thresholds,
        run.stats,
      ]);
      await client.query("DELETE FROM scan_pairs WHERE run_id=$1 AND (a = ANY($2) OR b = ANY($2))", [runId, changedIds]);
      await client.query("DELETE FROM scan_groups WHERE run_id=$1", [runId]);
      await insertPairs(client, runId, newPairs);
      await insertGroups(client, runId, groups);
    });
  }

  private async transaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  /** Active badges indexed or marked missing since `since` (new, changed, restored, reanalyzed, removed). */
  async changedSince(since: Date): Promise<number[]> {
    const { rows } = await this.pool.query("SELECT id FROM badges WHERE indexed_at >= $1 OR missing_at >= $1 ORDER BY id", [since]);
    return rows.map((r) => r.id);
  }

  async activeCount(): Promise<number> {
    const { rows } = await this.pool.query("SELECT count(*)::int AS n FROM badges WHERE missing_at IS NULL");
    return rows[0].n;
  }

  /** Pairs stored for a run that do not touch any of `excludeIds`. */
  async storedPairs(runId: number, excludeIds: number[]): Promise<ScanPair[]> {
    const { rows } = await this.pool.query(
      `SELECT a, b, relation, dhash, silhouette, design FROM scan_pairs
       WHERE run_id = $1 AND NOT (a = ANY($2) OR b = ANY($2))`,
      [runId, excludeIds],
    );
    return rows.map((r) => ({
      a: r.a,
      b: r.b,
      relation: r.relation,
      ...(r.relation === "similar" && { dhash: r.dhash, silhouette: r.silhouette, design: r.design }),
    }));
  }

  /** When the last scan started, and whether any badge was indexed or marked missing after that. */
  async freshness(): Promise<{ scannedAt: Date | null; stale: boolean }> {
    const { rows } = await this.pool.query(
      `SELECT (SELECT max(started_at) FROM scan_runs) AS scanned_at,
              (SELECT max(greatest(indexed_at, missing_at)) FROM badges) AS changed_at`,
    );
    const { scanned_at, changed_at } = rows[0];
    return { scannedAt: scanned_at, stale: !scanned_at || (changed_at !== null && changed_at > scanned_at) };
  }

  async latestRun(): Promise<ScanRun | null> {
    const { rows } = await this.pool.query("SELECT * FROM scan_runs ORDER BY id DESC LIMIT 1");
    const r = rows[0];
    return r ? { id: r.id, startedAt: r.started_at, finishedAt: r.finished_at, thresholds: r.thresholds, stats: r.stats } : null;
  }

  /** A page of groups of one kind (largest first), with members and the pairs inside each group. */
  async groups(runId: number, kind: GroupKind, offset: number, limit: number): Promise<{ total: number; groups: ScanGroup[] }> {
    const { rows: ids } = await this.pool.query(
      `SELECT group_id, count(*)::int AS n, count(*) OVER ()::int AS total
       FROM scan_groups WHERE run_id = $1 AND kind = $2
       GROUP BY group_id ORDER BY n DESC, group_id OFFSET $3 LIMIT $4`,
      [runId, kind, offset, limit],
    );
    if (!ids.length) return { total: 0, groups: [] };
    const groupIds = ids.map((r) => r.group_id);

    const { rows: members } = await this.pool.query(
      `SELECT g.group_id, b.id, b.file_name, b.orig_width, b.orig_height, b.animated
       FROM scan_groups g JOIN badges b ON b.id = g.badge_id
       WHERE g.run_id = $1 AND g.kind = $2 AND g.group_id = ANY($3)
       ORDER BY g.position, b.file_name`,
      [runId, kind, groupIds],
    );
    const { rows: pairs } = await this.pool.query(
      `SELECT ga.group_id, p.a, p.b, p.relation, p.dhash, p.silhouette, p.design
       FROM scan_pairs p
       JOIN scan_groups ga ON ga.run_id = p.run_id AND ga.kind = $2 AND ga.badge_id = p.a
       JOIN scan_groups gb ON gb.run_id = p.run_id AND gb.kind = $2 AND gb.badge_id = p.b AND gb.group_id = ga.group_id
       WHERE p.run_id = $1 AND ga.group_id = ANY($3) AND ($2 <> 'exact' OR p.relation <> 'similar')
       ORDER BY p.design DESC NULLS FIRST`,
      [runId, kind, groupIds],
    );

    const groups = groupIds.map((gid) => ({
      groupId: gid,
      members: members
        .filter((m) => m.group_id === gid)
        .map((m) => ({ id: m.id, fileName: m.file_name, width: m.orig_width, height: m.orig_height, animated: m.animated })),
      pairs: pairs
        .filter((p) => p.group_id === gid)
        .map((p) => ({ a: p.a, b: p.b, relation: p.relation, dhash: p.dhash, silhouette: p.silhouette, design: p.design })),
    }));
    return { total: ids[0].total, groups };
  }
}

async function insertPairs(client: pg.PoolClient, runId: number, pairs: ScanPair[]) {
  for (let i = 0; i < pairs.length; i += 5000) {
    const chunk = pairs.slice(i, i + 5000);
    await client.query(
      `INSERT INTO scan_pairs (run_id, a, b, relation, dhash, silhouette, design)
       SELECT $1, * FROM unnest($2::int[], $3::int[], $4::text[], $5::int[], $6::int[], $7::real[])`,
      [
        runId,
        chunk.map((p) => p.a),
        chunk.map((p) => p.b),
        chunk.map((p) => p.relation),
        chunk.map((p) => p.dhash ?? null),
        chunk.map((p) => p.silhouette ?? null),
        chunk.map((p) => p.design ?? null),
      ],
    );
  }
}

async function insertGroups(client: pg.PoolClient, runId: number, groups: { kind: GroupKind; members: number[] }[]) {
  const flat = groups.flatMap((g, gi) => g.members.map((id, pos) => ({ kind: g.kind, gi, id, pos })));
  for (let i = 0; i < flat.length; i += 5000) {
    const chunk = flat.slice(i, i + 5000);
    await client.query(
      `INSERT INTO scan_groups (run_id, kind, group_id, badge_id, position)
       SELECT $1, * FROM unnest($2::text[], $3::int[], $4::int[], $5::int[])`,
      [runId, chunk.map((r) => r.kind), chunk.map((r) => r.gi), chunk.map((r) => r.id), chunk.map((r) => r.pos)],
    );
  }
}
