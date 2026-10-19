/** A file in the badges folder. */
export interface FolderFile {
  name: string;
  size: number;
  mtime: Date;
}

/** What the index knows about a file. */
export interface IndexedFile {
  size: number;
  mtime: Date;
  version: number;
  /** Set when the file left the folder (soft delete). */
  missingAt: Date | null;
}

export interface FolderDiff {
  added: FolderFile[];
  changed: FolderFile[];
  /** Indexed with an older ANALYSIS_VERSION. */
  outdated: FolderFile[];
  /** Marked missing and back in the folder. */
  restored: FolderFile[];
  /** Indexed, not in the folder and not yet marked missing. */
  missing: string[];
  /** Too many missing at once (folder empty or misconfigured?): they are not marked unless forced. */
  massMissing: boolean;
  /** Badges currently indexed and not missing. */
  active: number;
}

/** Share of active badges that may disappear in one run before the safety brake kicks in. */
export const MASS_MISSING_RATIO = 0.05;

/**
 * Compares the folder with the index. Files that failed to index are only retried once they
 * change after the recorded error, so unreadable non-badges do not stay pending forever.
 */
export function folderDiff(
  files: FolderFile[],
  indexed: Map<string, IndexedFile>,
  errors: Map<string, Date>,
  version: number,
): FolderDiff {
  const diff: FolderDiff = { added: [], changed: [], outdated: [], restored: [], missing: [], massMissing: false, active: 0 };
  const present = new Set<string>();
  for (const f of files) {
    present.add(f.name);
    const prev = indexed.get(f.name);
    if (!prev) {
      const failedAt = errors.get(f.name);
      if (!failedAt || f.mtime > failedAt) diff.added.push(f);
    } else if (prev.missingAt) diff.restored.push(f);
    else if (prev.size !== f.size || prev.mtime.getTime() !== f.mtime.getTime()) diff.changed.push(f);
    else if (prev.version < version) diff.outdated.push(f);
  }
  for (const [name, prev] of indexed) {
    if (prev.missingAt) continue;
    diff.active++;
    if (!present.has(name)) diff.missing.push(name);
  }
  diff.massMissing = diff.missing.length > 0 && diff.missing.length > diff.active * MASS_MISSING_RATIO;
  return diff;
}

/** Files that need (re)analysis, in name order. */
export function pendingFiles(diff: FolderDiff): FolderFile[] {
  return [...diff.added, ...diff.changed, ...diff.outdated, ...diff.restored].sort((a, b) => a.name.localeCompare(b.name));
}

export function hasChanges(diff: FolderDiff): boolean {
  return pendingFiles(diff).length > 0 || diff.missing.length > 0;
}
