-- Server API Database Schema
-- MySQL/MariaDB DDL

-- Create database (optional - run manually if needed)
-- CREATE DATABASE IF NOT EXISTS server_api;
-- USE server_api;

-- Servers table: tracks game server status
CREATE TABLE IF NOT EXISTS servers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ip VARCHAR(45) NOT NULL,
    port INT NOT NULL,
    game VARCHAR(50) NOT NULL,
    status TINYINT NOT NULL DEFAULT 0,
    map VARCHAR(100) DEFAULT '',
    player_count INT DEFAULT 0,
    maxplayers INT DEFAULT 0,
    players_list JSON DEFAULT NULL COMMENT 'JSON array of current players on server',
    version VARCHAR(50) DEFAULT '',
    hostname VARCHAR(255) DEFAULT NULL COMMENT 'Server hostname from RCON',
    os VARCHAR(100) DEFAULT NULL COMMENT 'Server OS/type from RCON',
    secure TINYINT DEFAULT NULL COMMENT 'VAC secure status: 1=secure, 0=insecure',
    bot_count INT DEFAULT 0 COMMENT 'Number of bots on server',
    last_update TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_server (ip, port),
    INDEX idx_status (status),
    INDEX idx_last_update (last_update)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Players table: tracks player activity and playtime
CREATE TABLE IF NOT EXISTS players (
    id INT AUTO_INCREMENT PRIMARY KEY,
    steamid VARCHAR(20) NOT NULL,
    name VARCHAR(100) DEFAULT '' COMMENT 'Deprecated: use latest_name instead',
    latest_name VARCHAR(255) DEFAULT NULL COMMENT 'Most recent name seen',
    game VARCHAR(50) NOT NULL COMMENT 'Game type: csgo, counterstrike2, etc.',
    playtime INT DEFAULT 0 COMMENT 'Playtime in seconds',
    server_ip VARCHAR(45),
    server_port INT,
    latest_ip VARCHAR(45) DEFAULT NULL COMMENT 'Most recent IP address seen (private)',
    last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_player_game (steamid, game),
    INDEX idx_steamid (steamid),
    INDEX idx_game (game),
    INDEX idx_server (server_ip, server_port),
    INDEX idx_last_seen (last_seen)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Player names history: tracks all names a player has used
CREATE TABLE IF NOT EXISTS player_names (
    id INT AUTO_INCREMENT PRIMARY KEY,
    steamid VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    use_count INT DEFAULT 1 COMMENT 'Number of times this name was seen',
    INDEX idx_steamid (steamid),
    INDEX idx_name (name),
    INDEX idx_last_seen (last_seen),
    UNIQUE KEY unique_steamid_name (steamid, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Player IPs history: tracks all IP addresses a player has used (PRIVATE - not exposed via API)
CREATE TABLE IF NOT EXISTS player_ips (
    id INT AUTO_INCREMENT PRIMARY KEY,
    steamid VARCHAR(255) NOT NULL,
    ip VARCHAR(45) NOT NULL,
    first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    use_count INT DEFAULT 1 COMMENT 'Number of times this IP was seen',
    INDEX idx_steamid (steamid),
    INDEX idx_ip (ip),
    INDEX idx_last_seen (last_seen),
    UNIQUE KEY unique_steamid_ip (steamid, ip)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Maps table: tracks map playtime statistics
CREATE TABLE IF NOT EXISTS maps (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    game VARCHAR(50) NOT NULL COMMENT 'Game type: csgo, counterstrike2, etc.',
    playtime INT DEFAULT 0 COMMENT 'Total playtime in seconds',
    server_ip VARCHAR(45),
    server_port INT,
    last_played TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_map_game (name, game),
    INDEX idx_name (name),
    INDEX idx_game (game),
    INDEX idx_server (server_ip, server_port),
    INDEX idx_playtime (playtime DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Server history: snapshots of server status over time
CREATE TABLE IF NOT EXISTS server_history (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    server_ip VARCHAR(45) NOT NULL,
    server_port INT NOT NULL,
    game VARCHAR(50) NOT NULL,
    status TINYINT NOT NULL,
    map VARCHAR(100) DEFAULT '',
    player_count INT DEFAULT 0,
    maxplayers INT DEFAULT 0,
    version VARCHAR(50) DEFAULT '',
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_server (server_ip, server_port),
    INDEX idx_recorded_at (recorded_at),
    INDEX idx_server_time (server_ip, server_port, recorded_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Player session history: tracks when players join/leave servers
CREATE TABLE IF NOT EXISTS player_sessions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    steamid VARCHAR(20) NOT NULL,
    name VARCHAR(100) DEFAULT '',
    server_ip VARCHAR(45) NOT NULL,
    server_port INT NOT NULL,
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    left_at TIMESTAMP NULL DEFAULT NULL,
    duration INT DEFAULT 0 COMMENT 'Session duration in seconds',
    INDEX idx_steamid (steamid),
    INDEX idx_server (server_ip, server_port),
    INDEX idx_joined_at (joined_at),
    INDEX idx_session (steamid, server_ip, server_port, joined_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Map rotation history: tracks map changes on servers
CREATE TABLE IF NOT EXISTS map_history (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    server_ip VARCHAR(45) NOT NULL,
    server_port INT NOT NULL,
    map_name VARCHAR(100) NOT NULL,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMP NULL DEFAULT NULL,
    duration INT DEFAULT 0 COMMENT 'Map duration in seconds',
    player_count_avg INT DEFAULT 0,
    player_count_peak INT DEFAULT 0,
    INDEX idx_server (server_ip, server_port),
    INDEX idx_map (map_name),
    INDEX idx_started_at (started_at),
    INDEX idx_server_time (server_ip, server_port, started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Daily aggregations: pre-computed statistics for faster queries
CREATE TABLE IF NOT EXISTS daily_stats (
    id INT AUTO_INCREMENT PRIMARY KEY,
    stat_date DATE NOT NULL,
    server_ip VARCHAR(45) NOT NULL,
    server_port INT NOT NULL,
    total_players INT DEFAULT 0,
    unique_players INT DEFAULT 0,
    peak_players INT DEFAULT 0,
    avg_players DECIMAL(5,2) DEFAULT 0,
    uptime_minutes INT DEFAULT 0,
    total_maps_played INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_daily_stat (stat_date, server_ip, server_port),
    INDEX idx_date (stat_date),
    INDEX idx_server (server_ip, server_port)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
