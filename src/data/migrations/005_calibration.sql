-- Threshold calibration: a stratified sample of candidate pairs (by design score) that the
-- admin labels by hand, plus the population size of each stratum to weight the estimates.
CREATE TABLE calibration_strata (
  stratum    integer PRIMARY KEY,
  lo         real NOT NULL,
  hi         real NOT NULL,
  population integer NOT NULL
);

CREATE TABLE calibration_pairs (
  id         serial PRIMARY KEY,
  a          integer NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
  b          integer NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
  dhash      integer NOT NULL,
  silhouette integer NOT NULL,
  design     real NOT NULL,
  stratum    integer NOT NULL REFERENCES calibration_strata(stratum),
  UNIQUE (a, b)
);

-- label: similar | different | unsure
CREATE TABLE calibration_labels (
  pair_id    integer PRIMARY KEY REFERENCES calibration_pairs(id) ON DELETE CASCADE,
  label      text NOT NULL CHECK (label IN ('similar', 'different', 'unsure')),
  labeled_at timestamptz NOT NULL DEFAULT now()
);
