-- Results of the last full scan (npm run scan). Each scan replaces the previous one.
CREATE TABLE scan_runs (
  id          serial PRIMARY KEY,
  started_at  timestamptz NOT NULL,
  finished_at timestamptz NOT NULL,
  thresholds  jsonb NOT NULL,
  stats       jsonb NOT NULL
);

-- relation: identical | identical-crop | same-content | similar
CREATE TABLE scan_pairs (
  run_id     integer NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
  a          integer NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
  b          integer NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
  relation   text NOT NULL,
  dhash      integer,
  silhouette integer,
  design     real,
  PRIMARY KEY (run_id, a, b)
);

-- kind: exact (connected by exact matches only) | similar (contains at least one similar pair)
CREATE TABLE scan_groups (
  run_id   integer NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
  kind     text NOT NULL,
  group_id integer NOT NULL,
  badge_id integer NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
  PRIMARY KEY (run_id, kind, badge_id)
);
CREATE INDEX scan_groups_group_idx ON scan_groups (run_id, kind, group_id);
