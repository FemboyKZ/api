-- Remove server owner Steam ID column from servers table
-- This field is not needed and was being extracted from RCON but never used

ALTER TABLE servers
DROP COLUMN IF EXISTS steamid;
