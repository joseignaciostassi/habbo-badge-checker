# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A local tool for a Habbo emulator ("holo") admin to check, before uploading a badge (40x40/42x42 GIF/PNG, usually static, sometimes animated), whether an identical or similar badge already exists among ~27k badges. Next.js (App Router) + TypeScript, `sharp` for decoding, PostgreSQL 18 (local), images read from a local folder (`BADGES_DIR`). The UI and conversation with the user are in Spanish (rioplatense). Everything is done from the web; there are no CLI scripts.

## Commands

```bash
npm run dev                 # web UI on http://localhost:3000 (/, /scan, /calibrate)
npm test                    # vitest (all tests, DB-free)
npx vitest run tests/core.test.ts -t "empty frame"   # single file / single test
npm run typecheck           # tsc --noEmit
```

Config lives in `.env` (see `.env.example`): `DATABASE_URL`, `BADGES_DIR`, `SIM_DHASH_MAX`, `SIM_SILHOUETTE_MAX`, `SIM_DESIGN_MIN` (web check), `SIM_SCAN_DESIGN_MIN` (scan). Next loads it itself.

There are no DB commands: `src/data/setup.ts` creates the database and applies pending migrations (`src/data/migrations/`, tracked in `schema_migrations`). The web applies pending migrations on its own and, when the database does not exist or PostgreSQL is unreachable, `SyncBanner` shows `SetupDialog` ("Crear base de datos" runs create + migrate + index + scan as one job; `/scan` and `/calibrate` render nothing until the database is ready). `checkDatabase()` probes the TCP port before using pg, because a refused `localhost` connection makes pg reject with an AggregateError that hangs Next dev renders.

Starting the app does not index or scan. Every page shows `SyncBanner` (`app/SyncBanner.tsx`), which asks `GET /api/sync` whether the folder differs from the index or the scan is stale (older than the last change, or made with other thresholds than `config.scanThresholds`); its "Actualizar BD" button (`POST /api/sync`) runs the incremental index and then the scan in the background (`src/services/sync.ts`, job state on `globalThis`). "Actualizar BD", migrations and "Generar más pares" share a PG advisory lock (`src/data/updateLock.ts`), so only one runs at a time.

## Architecture

Layers:

- `src/core/` — pure image logic, no I/O. `analyzeBadge(buffer)` in `analyze.ts` is the single entry point used by the indexer and the web API.
- `src/data/` — PostgreSQL via plain `pg` and SQL (no ORM). `badgeRepo.ts` (index + lookups), `scanRepo.ts`, `calibrationRepo.ts`. Pool cached on `globalThis` for Next dev HMR.
- `src/storage/` — `ImageStore` interface; `LocalFsStore` reads `BADGES_DIR` read-only; another image source would be a new `ImageStore` implementation.
- `src/services/` — `checkBadge.ts` (analyze + exact + similar lookup; `/api/check`, gated by `validateUpload.ts`: `.gif`/`.png` name, GIF/PNG content, ≤ 200 KB, ≤ 50x50 per frame; the pure rules in `src/core/uploadRules.ts` are also checked in the browser before uploading; the indexed folder is never limited), `indexBadges.ts` / `scanBadges.ts` (index and scan), `sync.ts` (change status and the "Actualizar BD" job), `calibrationSample.ts` (the "Generar más pares" job).

### Analysis pipeline (`src/core`)

1. `decode.ts`: sharp with `animated: true` gives coalesced full frames (format sniffed from content; some `.gif` files are PNGs).
2. `normalize.ts`: alpha=0 pixels set to (0,0,0,0); each axis normalized to 40 **without rescaling** — centered crop if larger, centered transparent padding if smaller, odd extra pixel goes bottom/right. Sizes other than 40x40/42x42 get a `size_note`.
3. Frames are deduped by pixels: one unique frame = static (the common, simple path), more = `animated`. Fully transparent frames are flagged `empty` and excluded from exact and similarity matching.
4. Exact hashes (SHA-256 over pixels, dimensions in the prefix) per frame: `full`, `crop40`, `offset` (only 42x42, the 9 possible 40x40 windows), `content` (tight crop to visible pixels). `crop40` and `offset` share the `"crop"` prefix so they match each other; the UI maps kinds to *Idéntica* / *Idéntica al recortar a 40x40* / *Mismo contenido* (`compare.ts`).
5. Perceptual per frame: 64-bit `dhash` (over mid-gray) and `silhouette` stored as signed BIGINT, compared with `bit_count((a # b)::bit(64))`; plus `edges`, an oriented color-boundary map stored as `bit(3362)`: two planes of 40 rows x 41 bits (pixels differing from their right neighbour, then from their bottom neighbour) with 2 zero rows between them; the last column is zero padding so 1px shifts never wrap rows, and the gap keeps shifts from crossing planes.

### Similarity rule

hash prefilter (`dhash ≤ SIM_DHASH_MAX AND silhouette ≤ SIM_SILHOUETTE_MAX`) **then** design score `edge_iou(edges) ≥ threshold`. The 64-bit hashes alone mostly encode the outline and gave many false positives; the design score is the real verification. Thresholds were calibrated from 409 hand-labeled pairs: 0.575 for the web (~93% precision), 0.725 for the scan (~99%) — see `config.scanThresholds`. Oriented edges score ~0.16 lower than the old combined map, so old thresholds do not carry over.

### Invariants to keep in sync

- `edgeIoU()` in `src/core/perceptual.ts` mirrors the SQL function `edge_iou()` (latest definition in migration `006_oriented_edges.sql`): same layout and the same 9 shifts (`0, ±1, ±40, ±41, ±42`). Changing one requires changing the other.
- Any change to fingerprints/hashes must bump `ANALYSIS_VERSION` in `src/core/analyze.ts`; the indexer reprocesses badges whose stored `analysis_version` is lower (otherwise it only processes new or changed files by size+mtime).
- Migrations are append-only numbered SQL files; never edit an applied one.
- Badges whose file left the folder are soft-deleted (`badges.missing_at`): the row stays (scan/calibration references, labels) but its hashes and frames are deleted, so lookups and scans skip it without extra filters; queries that read `badges` directly must filter `missing_at IS NULL`. `folderDiff()` (`src/core/folderDiff.ts`) decides what is new/changed/outdated/restored/missing for both the indexer and the web; it refuses to mark more than 5% missing at once unless forced. The file name is the badge's identity: renames are a delete plus a new badge, never merged.
- Never write to `BADGES_DIR` or copy badges into the repo (`.gitignore` excludes `*.gif`/`*.png`). The demo badges are a `badges.zip` attached to a GitHub Release, extracted into the gitignored `./badges` that `.env.example` points `BADGES_DIR` at; never commit them.

### Scan and calibration

- Incremental scan (`runScan`, run by "Actualizar BD"): when the previous run has the same thresholds and at most 25% of the active badges changed since its `started_at` (`indexed_at`/`missing_at`, rule in `src/core/scanMode.ts`), only those badges are compared against the whole base (`exactPairsFor`/`similarPairsFor`), the stored pairs between unchanged badges are kept, groups are recomputed from all pairs and the run is updated in place (`updateScan`). It relies on pairs between unchanged badges being stable, so a migration that changes `edge_iou()` without bumping `ANALYSIS_VERSION` must also `DELETE FROM scan_runs` to force a full scan.
- Full scan: exact pairs via a self-join on shared hashes; similar pairs via a chunked `badge_frames` self-join in PG (4 chunks in parallel, ~35 s for 27k). Exact groups = connected components (`unionFind.ts`); similar groups = greedy star clusters (`starClusters.ts`: a center plus its direct neighbours, position 0 is the center) because connected components chained into one giant group. Results replace the previous run in `scan_runs`/`scan_pairs`/`scan_groups`; `/scan` only reads them.
- "Generar más pares" on `/calibrate` (`POST /api/calibrate/sample`, `runCalibrationSample`) re-stratifies the existing pairs by their current design score (labels are kept; pairs below 45% drop out) into 2.5-point bands (45–100%), stores population per band and adds up to `SAMPLE_EXTRA` (12) new random pairs per band; `/calibrate` collects blind labels; `thresholdTable()` in `src/core/calibration.ts` weights labels by band population to estimate precision, coverage and false hits per check.

## Tests

`tests/` uses synthetic badges generated with sharp in `tests/helpers.ts` (`design()` builds block patterns; use different `block` sizes for "different design" cases, since equal grids share edges). Covered cases include 40 vs 42 with border, off-center 42x42, border-only differences, recolor, 1px shift, white vs transparent border (must not be exact), horizontal vs vertical stripes (oriented edges), repeated GIF frames, animated vs static, and empty frames.
