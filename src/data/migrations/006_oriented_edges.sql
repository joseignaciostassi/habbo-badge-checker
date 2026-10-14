-- Oriented edge maps: two planes of 40 rows x 41 bits (right-neighbour boundaries, then
-- bottom-neighbour boundaries) with 2 zero rows between them: (40+2+40)*41 = 3362 bits.
-- Old maps are dropped; bump ANALYSIS_VERSION so `npm run index` recomputes them.
ALTER TABLE badge_frames ALTER COLUMN edges TYPE bit(3362) USING NULL;

-- Same 9 shifts of up to 1px over both planes at once: the gap rows keep the +-42 bit
-- shifts from crossing planes. Mirrors edgeIoU() in src/core/perceptual.ts.
CREATE OR REPLACE FUNCTION edge_iou(a bit(3362), b bit(3362)) RETURNS real
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT coalesce(max(bit_count(a & s)::real / nullif(bit_count(a | s), 0)), 0)
  FROM (VALUES (b), (b << 1), (b >> 1), (b << 41), (b >> 41),
               (b << 40), (b << 42), (b >> 40), (b >> 42)) AS v(s)
$$;
