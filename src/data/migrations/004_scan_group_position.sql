-- Member order inside a group; for similar groups position 0 is the center badge.
ALTER TABLE scan_groups ADD COLUMN position integer NOT NULL DEFAULT 0;
