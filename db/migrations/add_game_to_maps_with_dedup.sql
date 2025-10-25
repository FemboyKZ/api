-- Add game column to maps table with deduplication

-- Step 1: Add the game column without constraints first
ALTER TABLE maps
ADD COLUMN game VARCHAR(50) DEFAULT 'csgo' COMMENT 'Game type: csgo, counterstrike2, etc.' AFTER name;

-- Step 2: Update game values based on server_ip/server_port by joining with servers table
UPDATE maps m
INNER JOIN servers s ON m.server_ip = s.ip AND m.server_port = s.port
SET m.game = s.game;

-- Step 3: Consolidate duplicate entries (keep the one with most playtime, sum the rest)
CREATE TEMPORARY TABLE maps_consolidated AS
SELECT 
    name,
    game,
    SUM(playtime) as playtime,
    MAX(server_ip) as server_ip,
    MAX(server_port) as server_port,
    MAX(last_played) as last_played,
    MIN(created_at) as created_at
FROM maps
GROUP BY name, game;

-- Step 4: Clear the maps table
TRUNCATE TABLE maps;

-- Step 5: Insert consolidated data back
INSERT INTO maps (name, game, playtime, server_ip, server_port, last_played, created_at)
SELECT name, game, playtime, server_ip, server_port, last_played, created_at
FROM maps_consolidated;

-- Step 6: Drop temporary table
DROP TEMPORARY TABLE maps_consolidated;

-- Step 7: Add the unique constraint and index
ALTER TABLE maps
MODIFY COLUMN game VARCHAR(50) NOT NULL,
ADD UNIQUE KEY unique_map_game (name, game),
ADD INDEX idx_game (game);
