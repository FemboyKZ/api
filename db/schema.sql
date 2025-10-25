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
    players_list JSON DEFAULT NULL COMMENT 'JSON array of current players on server',
    version VARCHAR(50) DEFAULT '',
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
    name VARCHAR(100) DEFAULT '',
    playtime INT DEFAULT 0 COMMENT 'Playtime in seconds',
    server_ip VARCHAR(45),
    server_port INT,
    last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_steamid (steamid),
    INDEX idx_server (server_ip, server_port),
    INDEX idx_last_seen (last_seen)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Maps table: tracks map playtime statistics
CREATE TABLE IF NOT EXISTS maps (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    playtime INT DEFAULT 0 COMMENT 'Total playtime in seconds',
    server_ip VARCHAR(45),
    server_port INT,
    last_played TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_name (name),
    INDEX idx_server (server_ip, server_port),
    INDEX idx_playtime (playtime DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
