-- Add columns to players table for latest name and IP tracking
ALTER TABLE players
ADD COLUMN latest_name VARCHAR(255) DEFAULT NULL AFTER name,
ADD COLUMN latest_ip VARCHAR(45) DEFAULT NULL AFTER last_seen;

-- Update existing records to set latest_name and latest_ip from current values
UPDATE players SET latest_name = name WHERE latest_name IS NULL;

-- Create table for tracking all player name history
CREATE TABLE IF NOT EXISTS player_names (
    id INT AUTO_INCREMENT PRIMARY KEY,
    steamid VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    use_count INT DEFAULT 1,
    INDEX idx_steamid (steamid),
    INDEX idx_name (name),
    INDEX idx_last_seen (last_seen),
    UNIQUE KEY unique_steamid_name (steamid, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create table for tracking all player IP history
CREATE TABLE IF NOT EXISTS player_ips (
    id INT AUTO_INCREMENT PRIMARY KEY,
    steamid VARCHAR(255) NOT NULL,
    ip VARCHAR(45) NOT NULL,
    first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    use_count INT DEFAULT 1,
    INDEX idx_steamid (steamid),
    INDEX idx_ip (ip),
    INDEX idx_last_seen (last_seen),
    UNIQUE KEY unique_steamid_ip (steamid, ip)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Migrate existing player data to history tables
INSERT INTO player_names (steamid, name, first_seen, last_seen, use_count)
SELECT steamid, name, last_seen, last_seen, 1
FROM players
WHERE name IS NOT NULL
ON DUPLICATE KEY UPDATE 
    last_seen = VALUES(last_seen);
