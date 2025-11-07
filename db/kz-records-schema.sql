-- KZ Records Database Schema
-- Optimized for 25+ million records with proper indexing

-- Players table - normalized player data
CREATE TABLE IF NOT EXISTS kz_players (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    steamid64 VARCHAR(20) NOT NULL UNIQUE,
    steam_id VARCHAR(32) NOT NULL,
    player_name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_steam_id (steam_id),
    INDEX idx_player_name (player_name(20))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Maps table - normalized map data
CREATE TABLE IF NOT EXISTS kz_maps (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    map_id INT NOT NULL, -- Original map_id from source (-1 for null)
    map_name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY unique_map_id_name (map_id, map_name),
    INDEX idx_map_name (map_name(50))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Servers table - normalized server data
CREATE TABLE IF NOT EXISTS kz_servers (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    server_id INT NOT NULL UNIQUE,
    server_name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_server_name (server_name(50))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Records table - main table for 25M+ records
-- Note: Foreign keys not supported with partitioning, enforced at application level
CREATE TABLE IF NOT EXISTS kz_records (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    original_id BIGINT UNSIGNED NULL, -- Original ID from source API data
    
    -- Foreign keys (referenced but not enforced by DB due to partitioning)
    player_id INT UNSIGNED NOT NULL,
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
    
    -- Indexes for common queries
    INDEX idx_original_id (original_id),
    INDEX idx_player_id (player_id),
    INDEX idx_map_id (map_id),
    INDEX idx_server_id (server_id),
    INDEX idx_player_time (player_id, time),
    INDEX idx_map_time (map_id, time),
    INDEX idx_mode_time (mode, time),
    INDEX idx_created_on (created_on),
    INDEX idx_compound_player_map (player_id, map_id, mode, stage),
    INDEX idx_compound_map_mode (map_id, mode, time),
    INDEX idx_leaderboard (map_id, mode, stage, teleports, time)
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
