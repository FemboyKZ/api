-- Add game column to players and maps tables to separate statistics by game

-- Add game column to players table
ALTER TABLE players
ADD COLUMN game VARCHAR(50) NOT NULL DEFAULT 'csgo' COMMENT 'Game type: csgo, counterstrike2, etc.' AFTER name,
ADD UNIQUE KEY unique_player_game (steamid, game),
ADD INDEX idx_game (game);

-- Add game column to maps table
ALTER TABLE maps
ADD COLUMN game VARCHAR(50) NOT NULL DEFAULT 'csgo' COMMENT 'Game type: csgo, counterstrike2, etc.' AFTER name,
ADD UNIQUE KEY unique_map_game (name, game),
ADD INDEX idx_game (game);
