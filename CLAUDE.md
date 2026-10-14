# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A local tool for a Habbo emulator ("holo") admin to check, before uploading a badge (40x40/42x42 GIF/PNG, usually static, sometimes animated), whether an identical or similar badge already exists among ~27k badges. Next.js (App Router) + TypeScript, `sharp` for decoding, PostgreSQL 18 (local now, Supabase later), images read from a local folder (Supabase Storage later). The UI, CLI output and conversation with the user are in Spanish (rioplatense).

## Commands

```bash
npm run dev                 # web UI on http://localhost:3000 (/, /scan, /calibrate)
npm test                    # vitest (all tests, DB-free)
npx vitest run tests/core.test.ts -t "empty frame"   # single file / single test
npm run typecheck           # tsc --noEmit
npm run db:create           # create the DB named in DATABASE_URL if missing
npm run migrate             # apply new files in src/data/migrations/ (tracked in schema_migrations)
npm run index [-- --limit 200]   # incremental indexer over BADGES_DIR
npm run compare -- <image> [--dhash N --sil N --design 0.8 --limit N]
npm run scan [-- --design 0.85]  # full-base duplicate/similar scan, stored in scan_* tables
npm run calibrate [-- --sample --per 40 --synthetic 300]  # threshold calibration report
```

Config lives in `.env` (see `.env.example`): `DATABASE_URL`, `BADGES_DIR`, `SIM_DHASH_MAX`, `SIM_SILHOUETTE_MAX`, `SIM_DESIGN_MIN` (web check), `SIM_SCAN_DESIGN_MIN` (scan). Scripts load it via `dotenv/config`; Next loads it itself.

Nothing runs automatically: starting the app does not index, migrate or scan. New badges in the folder need `npm run index`, then `npm run scan` to show up in `/scan`.

## Architecture

Layers (the web and the scripts share everything below `app/`):

- `src/core/` — pure image logic, no I/O. `analyzeBadge(buffer)` in `analyze.ts` is the single entry point used by the indexer, the CLI and the web API.
- `src/data/` — PostgreSQL via plain `pg` and SQL (no ORM). `badgeRepo.ts` (index + lookups), `scanRepo.ts`, `calibrationRepo.ts`. Pool cached on `globalThis` for Next dev HMR.
- `src/storage/` — `ImageStore` interface; `LocalFsStore` reads `BADGES_DIR` read-only. A Supabase Storage implementation is meant to slot in here for the Vercel deploy.
- `src/services/checkBadge.ts` — analyze + exact lookup + similar lookup; used by `/api/check` and `npm run compare`.
- `src/scripts/` — CLI entry points (run with `tsx`).

### Analysis pipeline (`src/core`)

1. `decode.ts`: sharp with `animated: true` gives coalesced full frames (format sniffed from content; some `.gif` files are PNGs).
2. `normalize.ts`: alpha=0 pixels set to (0,0,0,0); each axis normalized to 40 **without rescaling** — centered crop if larger, centered transparent padding if smaller, odd extra pixel goes bottom/right. Sizes other than 40x40/42x42 get a `size_note`.
3. Frames are deduped by pixels: one unique frame = static (the common, simple path), more = `animated`. Fully transparent frames are flagged `empty` and excluded from exact and similarity matching.
4. Exact hashes (SHA-256 over pixels, dimensions in the prefix) per frame: `full`, `crop40`, `offset` (only 42x42, the 9 possible 40x40 windows), `content` (tight crop to visible pixels). `crop40` and `offset` share the `"crop"` prefix so they match each other; the UI maps kinds to *Idéntica* / *Idéntica al recortar a 40x40* / *Mismo contenido* (`compare.ts`).
5. Perceptual per frame: 64-bit `dhash` (over mid-gray) and `silhouette` stored as signed BIGINT, compared with `bit_count((a # b)::bit(64))`; plus `edges`, a color-boundary map stored as `bit(1640)` (40 rows x 41 bits, last column is zero padding so 1px shifts never wrap rows).

### Similarity rule

hash prefilter (`dhash ≤ SIM_DHASH_MAX AND silhouette ≤ SIM_SILHOUETTE_MAX`) **then** design score `edge_iou(edges) ≥ threshold`. The 64-bit hashes alone mostly encode the outline and gave many false positives; the design score is the real verification. Thresholds were calibrated from 351 hand-labeled pairs: 0.80 for the web (~92% precision), 0.85 for the scan (~99%) — see `config.scanThresholds`.

### Invariants to keep in sync

- `edgeIoU()` in `src/core/perceptual.ts` mirrors the SQL function `edge_iou()` (migration `002_edge_map.sql`): same layout and the same 9 shifts (`0, ±1, ±40, ±41, ±42`). Changing one requires changing the other.
- Any change to fingerprints/hashes must bump `ANALYSIS_VERSION` in `src/core/analyze.ts`; the indexer reprocesses badges whose stored `analysis_version` is lower (otherwise it only processes new or changed files by size+mtime).
- Migrations are append-only numbered SQL files; never edit an applied one.
- Never write to `BADGES_DIR` or copy badges into the repo (`.gitignore` excludes `*.gif`/`*.png`).

### Scan and calibration

- `npm run scan`: exact pairs via a self-join on shared hashes; similar pairs via a chunked `badge_frames` self-join in PG (4 chunks in parallel, ~35 s for 27k). Exact groups = connected components (`unionFind.ts`); similar groups = greedy star clusters (`starClusters.ts`: a center plus its direct neighbours, position 0 is the center) because connected components chained into one giant group. Results replace the previous run in `scan_runs`/`scan_pairs`/`scan_groups`; `/scan` only reads them.
- `npm run calibrate --sample` stratifies candidate pairs by design score into 5-point bands (55–100%) and stores population per band; `/calibrate` collects blind labels; `thresholdTable()` in `src/core/calibration.ts` weights labels by band population to estimate precision, coverage and false hits per check.

## Tests

`tests/` uses synthetic badges generated with sharp in `tests/helpers.ts` (`design()` builds block patterns; use different `block` sizes for "different design" cases, since equal grids share edges). Covered cases include 40 vs 42 with border, off-center 42x42, border-only differences, recolor, 1px shift, white vs transparent border (must not be exact), repeated GIF frames, animated vs static, and empty frames.
