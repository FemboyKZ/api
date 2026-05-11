-- Migration: add player_meta table
-- Stores per-player Discord ID and permissions/roles
-- Apply: mysql -u user -p database < db/migrations/add_player_meta.sql

CREATE TABLE IF NOT EXISTS player_meta (
    id INT AUTO_INCREMENT PRIMARY KEY,
    steamid VARCHAR(20) NOT NULL,
    discord_id VARCHAR(30) DEFAULT NULL COMMENT 'Discord user ID (snowflake)',
    permissions JSON DEFAULT NULL COMMENT 'Null if no permissions, else {roles:[], customRole:str|null, customTag:str|null}',
    whitelisted BOOLEAN DEFAULT FALSE COMMENT 'Whether the player is whitelisted',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_steamid (steamid),
    INDEX idx_steamid (steamid),
    INDEX idx_discord_id (discord_id),
    INDEX idx_whitelisted (whitelisted)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
