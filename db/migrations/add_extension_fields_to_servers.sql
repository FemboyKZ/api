-- Add columns for data provided by the gokz-realtime-status extension
-- that aren't already in the servers table.

ALTER TABLE servers
  ADD COLUMN mm_version VARCHAR(50) DEFAULT NULL COMMENT 'Metamod:Source version' AFTER version,
  ADD COLUMN sm_version VARCHAR(50) DEFAULT NULL COMMENT 'SourceMod version' AFTER mm_version,
  ADD COLUMN gokz_loaded TINYINT DEFAULT NULL COMMENT 'Whether GOKZ plugin is loaded (1=yes, 0=no)' AFTER sm_version;
