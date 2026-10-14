-- Design similarity: color-boundary map per frame (40 rows x 41 bits, last column is zero padding).
ALTER TABLE badge_frames ADD COLUMN edges bit(1640);

-- Fingerprint version per badge; the indexer reprocesses badges below the current version.
ALTER TABLE badges ADD COLUMN analysis_version integer NOT NULL DEFAULT 1;

-- Best intersection-over-union of two edge maps over the 9 shifts of up to 1px.
-- Shifting left by k compares a[i] with b[i+k]; the padding column keeps rows from wrapping.
-- Mirrors edgeIoU() in src/core/perceptual.ts.
CREATE FUNCTION edge_iou(a bit(1640), b bit(1640)) RETURNS real
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT coalesce(max(bit_count(a & s)::real / nullif(bit_count(a | s), 0)), 0)
  FROM (VALUES (b), (b << 1), (b >> 1), (b << 41), (b >> 41),
               (b << 40), (b << 42), (b >> 40), (b >> 42)) AS v(s)
$$;
