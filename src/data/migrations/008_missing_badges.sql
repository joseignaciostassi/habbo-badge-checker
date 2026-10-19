-- Soft delete: badges whose file left BADGES_DIR keep their row (id, scan and calibration
-- references) but lose their hashes and frames, so no lookup matches them. Reindexed if the file returns.
ALTER TABLE badges ADD COLUMN missing_at timestamptz;
