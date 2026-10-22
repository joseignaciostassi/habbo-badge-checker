import { config } from "../config";
import { hasChanges } from "../core/folderDiff";
import { ScanRepository } from "../data/scanRepo";
import { databaseTarget, ensureDatabase } from "../data/setup";
import { UpdateBusyError, withUpdateLock } from "../data/updateLock";
import { getImageStore } from "../storage/localFsStore";
import { computeFolderDiff, runIndex } from "./indexBadges";
import { runScan } from "./scanBadges";

/** How many file names of each kind the status lists. */
const EXAMPLES = 20;
/** Listing the folder stats ~27k files, so the status is reused for a few seconds. */
const CACHE_MS = 3000;

export interface FolderChanges {
  added: number;
  changed: number;
  outdated: number;
  restored: number;
  missing: number;
  /** Too many missing at once: "Actualizar BD" will not mark them unless forced. */
  massMissing: boolean;
  /** Missing share of the active badges, 0..1. */
  missingRatio: number;
  examples: { added: string[]; changed: string[]; restored: string[]; missing: string[] };
}

/** Whether the app's database can be used; anything but "ready" shows the first-run dialog. */
export type SetupInfo =
  | { state: "ready" }
  | { state: "missing"; database: string; host: string; badgesInFolder: number }
  | { state: "unreachable"; database: string; host: string; error: string };

export interface SyncJob {
  running: boolean;
  /** First run: the job also creates the database. */
  setup: boolean;
  phase: "creating" | "indexing" | "scanning" | "done" | "error";
  progress: { done: number; total: number } | null;
  /** While scanning: "incremental" compares only `changed` badges against the base. */
  scan: { mode: "full" | "incremental"; changed: number } | null;
  startedAt: string;
  finishedAt: string | null;
  result: {
    indexed: number;
    errors: number;
    markedMissing: number;
    blockedMissing: number;
    scanned: boolean;
    exactGroups?: number;
    similarGroups?: number;
  } | null;
  error: string | null;
}

export interface SyncStatus {
  setup: SetupInfo;
  /** Null while an update is running. */
  folder: FolderChanges | null;
  /** Folder differs from the index. */
  folderChanged: boolean;
  /** No scan yet, or badges changed after the last one. */
  scanStale: boolean;
  scannedAt: string | null;
  job: SyncJob | null;
  /** Anything for "Actualizar BD" to do (missing badges held by the safety brake do not count). */
  needsUpdate: boolean;
}

// Kept on globalThis so Next.js dev hot reloads keep the running job and the cache.
const g = globalThis as {
  __syncJob?: SyncJob;
  __syncStatus?: { at: number; value: Promise<Omit<SyncStatus, "job">> };
};

const IDLE = { folder: null, folderChanged: false, scanStale: false, scannedAt: null, needsUpdate: false };

async function computeStatus(): Promise<Omit<SyncStatus, "job">> {
  // Applies pending migrations on the way, so a code update never needs a manual step.
  const db = await ensureDatabase({ create: false });
  if (db.state === "missing") {
    const badgesInFolder = (await getImageStore().list()).length;
    return { ...IDLE, setup: { state: "missing", ...databaseTarget(), badgesInFolder } };
  }
  if (db.state === "unreachable") return { ...IDLE, setup: { state: "unreachable", ...databaseTarget(), error: db.error } };

  const [diff, fresh] = await Promise.all([computeFolderDiff(), new ScanRepository().freshness()]);
  const names = (fs: { name: string }[]) => fs.slice(0, EXAMPLES).map((f) => f.name);
  const folder: FolderChanges = {
    added: diff.added.length,
    changed: diff.changed.length,
    outdated: diff.outdated.length,
    restored: diff.restored.length,
    missing: diff.missing.length,
    massMissing: diff.massMissing,
    missingRatio: diff.active ? diff.missing.length / diff.active : 0,
    examples: {
      added: names(diff.added),
      changed: names(diff.changed),
      restored: names(diff.restored),
      missing: diff.missing.slice(0, EXAMPLES),
    },
  };
  const folderChanged = hasChanges(diff);
  const onlyHeldMissing =
    diff.massMissing && folder.added + folder.changed + folder.outdated + folder.restored === 0;
  return {
    setup: { state: "ready" },
    folder,
    folderChanged,
    scanStale: fresh.stale,
    scannedAt: fresh.scannedAt?.toISOString() ?? null,
    needsUpdate: (folderChanged && !onlyHeldMissing) || fresh.stale,
  };
}

export async function getSyncStatus(): Promise<SyncStatus> {
  const job = g.__syncJob ?? null;
  if (job?.running) {
    return { ...IDLE, setup: { state: "ready" }, job };
  }
  if (!g.__syncStatus || Date.now() - g.__syncStatus.at > CACHE_MS) {
    const value = computeStatus();
    g.__syncStatus = { at: Date.now(), value };
    value.catch(() => (g.__syncStatus = undefined));
  }
  return { ...(await g.__syncStatus.value), job };
}

/**
 * Starts "Actualizar BD" in the background: incremental index (new, changed, restored,
 * missing badges) and then, if anything changed since the last scan, a scan of the changed
 * badges against the base (a full one when runScan cannot reuse the previous run). With `setup`
 * (first run) it first creates the database and applies the migrations.
 * Returns false when an update is already running in this process.
 */
export function startSync(opts: { allowMassMissing?: boolean; setup?: boolean } = {}): boolean {
  if (g.__syncJob?.running) return false;
  const job: SyncJob = {
    running: true,
    setup: opts.setup === true,
    phase: opts.setup ? "creating" : "indexing",
    progress: null,
    scan: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    result: null,
    error: null,
  };
  g.__syncJob = job;

  void (async () => {
    try {
      const db = await ensureDatabase({ create: job.setup });
      if (db.state === "unreachable") throw new Error(db.error);
      if (db.state === "missing") throw new Error(`La base ${databaseTarget().database} no existe.`);
      job.phase = "indexing";
      await withUpdateLock(async () => {
        const idx = await runIndex({
          allowMassMissing: opts.allowMassMissing,
          onProgress: (done, total) => (job.progress = { done, total }),
        });
        job.result = {
          indexed: idx.processed,
          errors: idx.errors,
          markedMissing: idx.markedMissing,
          blockedMissing: idx.blockedMissing,
          scanned: false,
        };
        if ((await new ScanRepository().freshness()).stale) {
          job.phase = "scanning";
          job.progress = null;
          const scan = await runScan(config.scanThresholds, (done, total) => (job.progress = { done, total }), {
            onStart: (mode, changed) => (job.scan = { mode, changed }),
          });
          job.result = { ...job.result, scanned: true, exactGroups: scan.stats.exactGroups, similarGroups: scan.stats.similarGroups };
        }
      });
      job.phase = "done";
    } catch (e) {
      job.phase = "error";
      job.error = e instanceof UpdateBusyError ? e.message : `Error al actualizar: ${e instanceof Error ? e.message : String(e)}`;
      if (!(e instanceof UpdateBusyError)) console.error(e);
    } finally {
      job.running = false;
      job.progress = null;
      job.finishedAt = new Date().toISOString();
      g.__syncStatus = undefined;
    }
  })();
  return true;
}
