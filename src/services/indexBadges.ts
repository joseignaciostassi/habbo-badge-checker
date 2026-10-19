import { ANALYSIS_VERSION, analyzeBadge } from "../core/analyze";
import { type FolderDiff, folderDiff, pendingFiles } from "../core/folderDiff";
import { type BadgeToSave, PgBadgeRepository } from "../data/badgeRepo";
import { getImageStore } from "../storage/localFsStore";

const BATCH = 100;

export interface IndexOptions {
  /** Process at most this many pending files. */
  limit?: number;
  /** Mark missing badges even when the safety brake trips. */
  allowMassMissing?: boolean;
  onProgress?: (done: number, total: number, errors: number) => void;
}

export interface IndexResult {
  diff: FolderDiff;
  /** Files analyzed in this run (including the ones that failed). */
  processed: number;
  errors: number;
  markedMissing: number;
  /** Missing badges left unmarked because too many disappeared at once. */
  blockedMissing: number;
  seconds: number;
}

/** Folder vs index, without touching anything. */
export async function computeFolderDiff(repo = new PgBadgeRepository()): Promise<FolderDiff> {
  const [files, indexed, errors] = await Promise.all([getImageStore().list(), repo.indexedFiles(), repo.indexErrors()]);
  return folderDiff(files, indexed, errors, ANALYSIS_VERSION);
}

/**
 * Incremental indexer: analyzes new, changed, outdated and restored files, and soft-deletes
 * badges whose file left the folder (unless the safety brake trips). Never writes to the folder.
 */
export async function runIndex(opts: IndexOptions = {}): Promise<IndexResult> {
  const repo = new PgBadgeRepository();
  const store = getImageStore();
  const diff = await computeFolderDiff(repo);
  let pending = pendingFiles(diff);
  if (opts.limit !== undefined) pending = pending.slice(0, opts.limit);

  const started = Date.now();
  let done = 0, errors = 0;
  for (let i = 0; i < pending.length; i += BATCH) {
    const chunk = pending.slice(i, i + BATCH);
    const results = await Promise.all(
      chunk.map(async (f): Promise<BadgeToSave | null> => {
        try {
          return { fileName: f.name, size: f.size, mtime: f.mtime, analysis: await analyzeBadge(await store.read(f.name)) };
        } catch (e) {
          errors++;
          await repo.recordError(f.name, e instanceof Error ? e.message : String(e));
          return null;
        }
      }),
    );
    await repo.saveBadges(results.filter((r): r is BadgeToSave => r !== null));
    done += chunk.length;
    opts.onProgress?.(done, pending.length, errors);
  }

  const blocked = diff.massMissing && !opts.allowMassMissing;
  if (!blocked) await repo.markMissing(diff.missing);

  return {
    diff,
    processed: done,
    errors,
    markedMissing: blocked ? 0 : diff.missing.length,
    blockedMissing: blocked ? diff.missing.length : 0,
    seconds: (Date.now() - started) / 1000,
  };
}
