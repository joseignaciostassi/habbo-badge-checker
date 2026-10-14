-- Calibration pairs are re-stratified by the current design score on every sample; a labeled
-- pair whose score fell below the sampled range keeps its label but has no stratum.
ALTER TABLE calibration_pairs ALTER COLUMN stratum DROP NOT NULL;
