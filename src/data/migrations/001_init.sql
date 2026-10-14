CREATE TABLE badges (
  id            serial PRIMARY KEY,
  file_name     text NOT NULL UNIQUE,
  file_size     integer NOT NULL,
  file_mtime    timestamptz NOT NULL,
  format        text NOT NULL,
  orig_width    integer NOT NULL,
  orig_height   integer NOT NULL,
  unique_frames integer NOT NULL,
  animated      boolean NOT NULL,
  size_note     text,
  indexed_at    timestamptz NOT NULL DEFAULT now()
);

-- kind: full | crop40 | offset | content. crop40 and offset share one hash space.
CREATE TABLE badge_exact_hashes (
  badge_id  integer NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
  kind      text NOT NULL,
  hash      bytea NOT NULL,
  frame_idx integer NOT NULL
);
CREATE INDEX badge_exact_hashes_hash_idx ON badge_exact_hashes (hash);
CREATE INDEX badge_exact_hashes_badge_idx ON badge_exact_hashes (badge_id);

-- One row per unique frame (static badges: exactly one row).
CREATE TABLE badge_frames (
  badge_id   integer NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
  frame_idx  integer NOT NULL,
  dhash      bigint NOT NULL,
  silhouette bigint NOT NULL,
  empty      boolean NOT NULL,
  PRIMARY KEY (badge_id, frame_idx)
);

CREATE TABLE index_errors (
  file_name text PRIMARY KEY,
  error     text NOT NULL,
  at        timestamptz NOT NULL DEFAULT now()
);
