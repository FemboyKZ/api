-- KZ Records Database Schema

-- Players table - normalized player data
CREATE TABLE IF NOT EXISTS kz_players (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  steamid64 VARCHAR(20) NOT NULL UNIQUE,
  steam_id VARCHAR(32) NOT NULL,
  player_name VARCHAR(100) NOT NULL,
  is_banned BOOLEAN DEFAULT FALSE,
  total_records INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  INDEX idx_steam_id (steam_id),
  INDEX idx_player_name (player_name(50)),
  INDEX idx_total_records (total_records DESC),
  INDEX idx_is_banned (is_banned)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Maps table - normalized map data
CREATE TABLE IF NOT EXISTS kz_maps (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  map_id INT NOT NULL, -- Original map_id from source (-1 for null)
  map_name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  filesize INT NULL COMMENT 'Map file size in bytes',
  validated BOOLEAN NULL COMMENT 'Whether map is validated by KZ team',
  difficulty TINYINT NULL COMMENT 'Map difficulty (1-7)',
  approved_by_steamid64 VARCHAR(20) NULL COMMENT 'SteamID64 of approver',
  workshop_url VARCHAR(500) NULL COMMENT 'Steam Workshop URL',
  download_url VARCHAR(500) NULL COMMENT 'Direct download URL',
  global_created_on DATETIME NULL COMMENT 'Creation timestamp from GlobalAPI',
  global_updated_on DATETIME NULL COMMENT 'Last update timestamp from GlobalAPI',
  
  UNIQUE KEY unique_map_id_name (map_id, map_name),
  INDEX idx_map_name (map_name(50)),
  INDEX idx_maps_filter (validated, difficulty)
) COMMENT = 'Normalized map data with GlobalAPI metadata' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Servers table - normalized server data
CREATE TABLE IF NOT EXISTS kz_servers (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  server_id INT NOT NULL UNIQUE,
  api_key VARCHAR(50) NULL,
  port INT NULL,
  server_name VARCHAR(255) NOT NULL,
  ip VARCHAR(45) NULL,
  owner_steamid64 VARCHAR(20) NULL,
  created_on DATETIME NULL,
  updated_on DATETIME NULL,
  approval_status INT NULL,
  approved_by_steamid64 VARCHAR(20) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_server_name (server_name(50)),
  INDEX idx_ip_port (ip, port),
  
  CONSTRAINT fk_server_owner FOREIGN KEY (owner_steamid64) REFERENCES kz_players(steamid64) ON DELETE SET NULL,
  CONSTRAINT fk_server_approver FOREIGN KEY (approved_by_steamid64) REFERENCES kz_players(steamid64) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Records table - main table for 25M+ records
CREATE TABLE IF NOT EXISTS kz_records (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  original_id BIGINT UNSIGNED NULL UNIQUE, -- Original ID from source API data
  
  -- Foreign keys
  player_id VARCHAR(20) NOT NULL,
  map_id INT UNSIGNED NOT NULL,
  server_id INT UNSIGNED NOT NULL,
  
  -- Record details
  mode VARCHAR(32) NOT NULL,
  stage TINYINT UNSIGNED NOT NULL DEFAULT 0,
  time DECIMAL(10,3) NOT NULL, -- Time in seconds with millisecond precision
  teleports SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  points INT NOT NULL DEFAULT 0,
  tickrate SMALLINT UNSIGNED NOT NULL DEFAULT 128,
  
  -- Additional metadata
  record_filter_id INT NOT NULL DEFAULT 0,
  replay_id INT UNSIGNED NOT NULL DEFAULT 0,
  updated_by INT NOT NULL DEFAULT 0,
  
  -- Timestamps
  created_on TIMESTAMP NOT NULL,
  updated_on TIMESTAMP NOT NULL,
  inserted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  -- Essential indexes for common queries
  INDEX idx_player_map_mode (player_id, map_id, mode, stage, time),
  INDEX idx_leaderboard (map_id, mode, stage, teleports, time),
  INDEX idx_recent_records (created_on DESC, mode, map_id),
  INDEX idx_server_records (server_id, created_on DESC),
  INDEX idx_mode_stage (mode, stage, teleports, time),
  INDEX idx_original_id (original_id),
  
  -- Foreign key constraints
  CONSTRAINT fk_player FOREIGN KEY (player_id) REFERENCES kz_players(steamid64) ON DELETE CASCADE,
  CONSTRAINT fk_map FOREIGN KEY (map_id) REFERENCES kz_maps(id) ON DELETE CASCADE,
  CONSTRAINT fk_server FOREIGN KEY (server_id) REFERENCES kz_servers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Statistics table for aggregated data (speeds up common queries)
CREATE TABLE IF NOT EXISTS kz_map_statistics (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  map_id INT UNSIGNED NOT NULL,
  mode VARCHAR(32) NOT NULL,
  stage TINYINT UNSIGNED NOT NULL DEFAULT 0,
  
  total_records INT UNSIGNED NOT NULL DEFAULT 0,
  unique_players INT UNSIGNED NOT NULL DEFAULT 0,
  world_record_time DECIMAL(10,3),
  world_record_player_id INT UNSIGNED,
  avg_time DECIMAL(10,3),
  median_time DECIMAL(10,3),
  
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  UNIQUE KEY unique_map_mode_stage (map_id, mode, stage),
  FOREIGN KEY (map_id) REFERENCES kz_maps(id) ON DELETE CASCADE,
  INDEX idx_mode (mode)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS kz_worldrecords_cache (
  map_id INT UNSIGNED NOT NULL,
  mode VARCHAR(32) NOT NULL,
  stage INT NOT NULL,
  teleports INT NOT NULL,
  player_id VARCHAR(20) NOT NULL,
  time FLOAT NOT NULL,
  points INT NOT NULL DEFAULT 0,
  server_id INT UNSIGNED NOT NULL,
  created_on DATETIME NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  PRIMARY KEY (map_id, mode, stage, teleports),
  INDEX idx_player_records (player_id, created_on DESC),
  
  CONSTRAINT fk_wr_map FOREIGN KEY (map_id) REFERENCES kz_maps(id) ON DELETE CASCADE,
  CONSTRAINT fk_wr_player FOREIGN KEY (player_id) REFERENCES kz_players(steamid64) ON DELETE CASCADE,
  CONSTRAINT fk_wr_server FOREIGN KEY (server_id) REFERENCES kz_servers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Player statistics
CREATE TABLE IF NOT EXISTS kz_player_statistics (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  player_id INT UNSIGNED NOT NULL,
  
  total_records INT UNSIGNED NOT NULL DEFAULT 0,
  total_maps INT UNSIGNED NOT NULL DEFAULT 0,
  total_playtime DECIMAL(12,3) NOT NULL DEFAULT 0, -- Sum of all times
  avg_teleports DECIMAL(6,2) NOT NULL DEFAULT 0,
  world_records INT UNSIGNED NOT NULL DEFAULT 0,
  
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  UNIQUE KEY unique_player (player_id),
  FOREIGN KEY (player_id) REFERENCES kz_players(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS kz_bans (
  id INT PRIMARY KEY,
  ban_type VARCHAR(50) NOT NULL,
  expires_on DATETIME NULL,
  ip VARCHAR(45) NULL,
  steamid64 VARCHAR(20) NULL,
  player_name VARCHAR(255) NULL,
  steam_id VARCHAR(32) NULL,
  notes TEXT NULL,
  stats TEXT NULL,
  server_id INT UNSIGNED NULL,
  updated_by_id VARCHAR(20) NULL,
  created_on DATETIME NULL,
  updated_on DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  INDEX idx_steamid64 (steamid64),
  INDEX idx_ban_lookup (ban_type, expires_on, created_on DESC),
  INDEX idx_server_bans (server_id, created_on DESC),
  
  CONSTRAINT fk_ban_player FOREIGN KEY (steamid64) REFERENCES kz_players(steamid64) ON DELETE CASCADE,
  CONSTRAINT fk_ban_server FOREIGN KEY (server_id) REFERENCES kz_servers(id) ON DELETE SET NULL,
  CONSTRAINT fk_ban_updater FOREIGN KEY (updated_by_id) REFERENCES kz_players(steamid64) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS kz_jumpstats (
  id INT PRIMARY KEY,
  server_id INT UNSIGNED NULL,
  steamid64 VARCHAR(20) NULL,
  player_name VARCHAR(255) NULL,
  steam_id VARCHAR(32) NULL,
  jump_type INT NOT NULL,
  distance FLOAT NOT NULL,
  tickrate INT NULL,
  msl_count INT NULL,
  strafe_count INT NULL,
  is_crouch_bind SMALLINT NOT NULL DEFAULT 0,
  is_forward_bind SMALLINT NOT NULL DEFAULT 0,
  is_crouch_boost SMALLINT NOT NULL DEFAULT 0,
  updated_by_id VARCHAR(20) NULL,
  created_on DATETIME NULL,
  updated_on DATETIME NULL,
  
  INDEX idx_leaderboard (jump_type, is_crouch_bind, is_forward_bind, is_crouch_boost, distance DESC),
  INDEX idx_player_jumps (steamid64, jump_type, created_on DESC),
  INDEX idx_server_jumps (server_id, created_on DESC),
  
  CONSTRAINT fk_jump_player FOREIGN KEY (steamid64) REFERENCES kz_players(steamid64) ON DELETE CASCADE,
  CONSTRAINT fk_jump_server FOREIGN KEY (server_id) REFERENCES kz_servers(id) ON DELETE SET NULL,
  CONSTRAINT fk_jump_updater FOREIGN KEY (updated_by_id) REFERENCES kz_players(steamid64) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS kz_record_filters (
  id INT PRIMARY KEY,
  map_id INT UNSIGNED NOT NULL,
  stage TINYINT NOT NULL DEFAULT 0,
  mode_id INT NOT NULL,
  tickrate SMALLINT NOT NULL,
  has_teleports BOOLEAN NOT NULL DEFAULT FALSE,
  created_on DATETIME,
  updated_on DATETIME,
  updated_by_id VARCHAR(20),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE KEY unique_filter (map_id, stage, mode_id, tickrate, has_teleports),
  INDEX idx_mode_filters (mode_id, tickrate, has_teleports),
  
  CONSTRAINT fk_filter_map FOREIGN KEY (map_id) REFERENCES kz_maps(id) ON DELETE CASCADE,
  CONSTRAINT fk_filter_mode FOREIGN KEY (mode_id) REFERENCES kz_modes(id) ON DELETE CASCADE,
  CONSTRAINT fk_filter_updater FOREIGN KEY (updated_by_id) REFERENCES kz_players(steamid64) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create kz_modes table
-- This table stores the three KZ modes: kz_timer, kz_simple, kz_vanilla
CREATE TABLE IF NOT EXISTS kz_modes (
  id INT PRIMARY KEY,
  name VARCHAR(50) NOT NULL UNIQUE,
  description TEXT,
  latest_version INT,
  latest_version_description VARCHAR(50),
  website VARCHAR(255),
  repo VARCHAR(255),
  contact_steamid64 VARCHAR(20),
  supported_tickrates TEXT,
  created_on DATETIME,
  updated_on DATETIME,
  updated_by_id VARCHAR(20),
  
  CONSTRAINT fk_mode_contact FOREIGN KEY (contact_steamid64) REFERENCES kz_players(steamid64) ON DELETE SET NULL,
  CONSTRAINT fk_mode_updater FOREIGN KEY (updated_by_id) REFERENCES kz_players(steamid64) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELIMITER $$
CREATE PROCEDURE refresh_worldrecords_cache()
BEGIN
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
  -- Rollback on error
  ROLLBACK;
  RESIGNAL;
  END;

  START TRANSACTION;

  -- Use REPLACE INTO instead of TRUNCATE+INSERT to handle duplicates
  -- This avoids race conditions when multiple processes call the procedure
  REPLACE INTO kz_worldrecords_cache (map_id, mode, stage, teleports, player_id, time, points, server_id, created_on)
  SELECT 
  r.map_id,
  r.mode,
  r.stage,
  CASE WHEN r.teleports = 0 THEN 0 ELSE 1 END as teleports,
  r.player_id,
  r.time,
  r.points,
  r.server_id,
  r.created_on
  FROM kz_records r
  INNER JOIN (
  SELECT 
    map_id, 
    mode, 
    stage,
    CASE WHEN teleports = 0 THEN 0 ELSE 1 END as tp_group,
    MIN(time) as best_time
  FROM kz_records
  WHERE player_id IS NOT NULL
  GROUP BY map_id, mode, stage, tp_group
  ) best ON r.map_id = best.map_id 
  AND r.mode = best.mode 
  AND r.stage = best.stage
  AND CASE WHEN r.teleports = 0 THEN 0 ELSE 1 END = best.tp_group
  AND r.time = best.best_time
  -- Exclude banned players
  WHERE NOT EXISTS (
  SELECT 1 FROM kz_players p 
  WHERE p.steamid64 = r.player_id 
  AND p.is_banned = TRUE
  );

  COMMIT;
END$$
DELIMITER ;
