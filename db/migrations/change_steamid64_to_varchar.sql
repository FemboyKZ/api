-- Migration: Change steamid64 from BIGINT UNSIGNED to VARCHAR(20)
-- Reason: JavaScript/MySQL precision loss with large BIGINT values
-- Steam IDs are strings from the API and should be stored as such
-- Max Steam ID length is 17 characters (76561199999999999), using VARCHAR(20) for safety

-- Step 1: Add new column
ALTER TABLE kz_players 
ADD COLUMN steamid64_new VARCHAR(20) NULL AFTER steamid64;

-- Step 2: Copy data as strings (this preserves exact values)
UPDATE kz_players 
SET steamid64_new = CAST(steamid64 AS CHAR);

-- Step 3: Verify all rows copied
-- Run this manually to check: SELECT COUNT(*) FROM kz_players WHERE steamid64_new IS NULL;
-- Should return 0

-- Step 4: Drop old column and constraints
ALTER TABLE kz_players 
DROP INDEX steamid64,
DROP COLUMN steamid64;

-- Step 5: Rename new column
ALTER TABLE kz_players 
CHANGE COLUMN steamid64_new steamid64 VARCHAR(20) NOT NULL;

-- Step 6: Add unique index
ALTER TABLE kz_players 
ADD UNIQUE INDEX steamid64 (steamid64);

-- Step 7: Update kz_records table to use VARCHAR for consistency (optional but recommended)
-- This adds a new column that can be used for joins, keeping player_id as the primary reference
-- Uncomment if you want to denormalize for performance:
ALTER TABLE kz_records ADD COLUMN steamid64 VARCHAR(20) NULL AFTER player_id;
UPDATE kz_records r JOIN kz_players p ON r.player_id = p.id SET r.steamid64 = p.steamid64;
ALTER TABLE kz_records ADD INDEX idx_steamid64 (steamid64);
