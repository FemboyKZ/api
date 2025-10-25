-- Historical data tables for trends and analytics

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Historical snapshots of server status';

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Player session tracking for detailed analytics';

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Map rotation and playtime history';

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Daily aggregated statistics for trends';
