-- Add game column to players table with deduplication

-- Step 1: Add the game column without constraints first
ALTER TABLE players
ADD COLUMN game VARCHAR(50) DEFAULT 'csgo' COMMENT 'Game type: csgo, counterstrike2, etc.' AFTER name;

-- Step 2: Update game values based on server_ip/server_port by joining with servers table
UPDATE players p
INNER JOIN servers s ON p.server_ip = s.ip AND p.server_port = s.port
SET p.game = s.game;

-- Step 3: Consolidate duplicate entries (keep the one with most playtime, sum the rest)
CREATE TEMPORARY TABLE players_consolidated AS
SELECT 
    steamid,
    MAX(name) as name,
    game,
    SUM(playtime) as playtime,
    MAX(server_ip) as server_ip,
    MAX(server_port) as server_port,
    MAX(last_seen) as last_seen,
    MIN(created_at) as created_at
FROM players
GROUP BY steamid, game;

-- Step 4: Clear the players table
TRUNCATE TABLE players;

-- Step 5: Insert consolidated data back
INSERT INTO players (steamid, name, game, playtime, server_ip, server_port, last_seen, created_at)
SELECT steamid, name, game, playtime, server_ip, server_port, last_seen, created_at
FROM players_consolidated;

-- Step 6: Drop temporary table
DROP TEMPORARY TABLE players_consolidated;

-- Step 7: Add the unique constraint and index
ALTER TABLE players
MODIFY COLUMN game VARCHAR(50) NOT NULL,
ADD UNIQUE KEY unique_player_game (steamid, game),
ADD INDEX idx_game (game);
