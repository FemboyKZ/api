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

-- Records table - main table for 25M+ records (Use partitioned version)
CREATE TABLE IF NOT EXISTS kz_records (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  original_id BIGINT UNSIGNED NULL UNIQUE, -- Original ID from source API data
  
  -- Foreign keys
  player_id INT UNSIGNED NOT NULL,
  steamid64 VARCHAR(20) NULL,
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
  INDEX idx_player_map_mode (steamid64, map_id, mode, stage, time),
  INDEX idx_leaderboard (steamid64, map_id, mode, stage, teleports, time),
  INDEX idx_recent_records (created_on DESC, mode, map_id),
  INDEX idx_server_records (server_id, created_on DESC),
  INDEX idx_mode_stage (mode, stage, teleports, time),
  INDEX idx_original_id (original_id),
  
  -- Foreign key constraints
  CONSTRAINT fk_player FOREIGN KEY (player_id) REFERENCES kz_players(id) ON DELETE CASCADE,
  CONSTRAINT fk_map FOREIGN KEY (map_id) REFERENCES kz_maps(id) ON DELETE CASCADE,
  CONSTRAINT fk_server FOREIGN KEY (server_id) REFERENCES kz_servers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Partitioned Records table - main table for 25M+ records
CREATE TABLE IF NOT EXISTS kz_records_partitioned (
  id BIGINT UNSIGNED AUTO_INCREMENT,
  original_id BIGINT UNSIGNED NULL,
  
  -- Store IDs without foreign keys
  player_id INT UNSIGNED NOT NULL,
  steamid64 VARCHAR(20) NOT NULL,
  map_id INT UNSIGNED NOT NULL,
  server_id INT UNSIGNED NOT NULL,
  
  -- Record details
  mode VARCHAR(32) NOT NULL,
  stage TINYINT UNSIGNED NOT NULL DEFAULT 0,
  time DECIMAL(10,3) NOT NULL,
  teleports SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  points INT NOT NULL DEFAULT 0,
  tickrate SMALLINT UNSIGNED NOT NULL DEFAULT 128,
  
  -- Additional metadata
  record_filter_id INT NOT NULL DEFAULT 0,
  replay_id INT UNSIGNED NOT NULL DEFAULT 0,
  updated_by INT NOT NULL DEFAULT 0,
  
  -- Timestamps - using DATETIME for partitioning compatibility
  created_on DATETIME NOT NULL,
  updated_on DATETIME NOT NULL,
  inserted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  PRIMARY KEY (id, created_on),
  UNIQUE KEY idx_original_id (original_id, created_on),
  
  -- Optimized indexes
  KEY idx_player_map_mode (steamid64, map_id, mode, stage, time),
  KEY idx_leaderboard (map_id, mode, stage, teleports, time),
  KEY idx_recent_records (created_on DESC, mode, map_id),
  KEY idx_server_records (server_id, created_on DESC),
  KEY idx_mode_stage (mode, stage, teleports, time),
  KEY idx_player_id (steamid64),
  KEY idx_map_id (map_id),
  KEY idx_server_id (server_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
PARTITION BY RANGE (TO_DAYS(created_on)) (
  PARTITION p_old VALUES LESS THAN (TO_DAYS('2018-01-01')),
  PARTITION p2018 VALUES LESS THAN (TO_DAYS('2019-01-01')),
  PARTITION p2019 VALUES LESS THAN (TO_DAYS('2020-01-01')),
  PARTITION p2020 VALUES LESS THAN (TO_DAYS('2021-01-01')),
  PARTITION p2021 VALUES LESS THAN (TO_DAYS('2022-01-01')),
  PARTITION p2022 VALUES LESS THAN (TO_DAYS('2023-01-01')),
  PARTITION p2023 VALUES LESS THAN (TO_DAYS('2024-01-01')),
  PARTITION p2024 VALUES LESS THAN (TO_DAYS('2025-01-01')),
  PARTITION p2025 VALUES LESS THAN (TO_DAYS('2026-01-01')),
  PARTITION p2026 VALUES LESS THAN (TO_DAYS('2027-01-01')),
  PARTITION p2027 VALUES LESS THAN (TO_DAYS('2028-01-01')),
  PARTITION pfuture VALUES LESS THAN MAXVALUE
);

-- Create player statistics table if it doesn't exist
CREATE TABLE IF NOT EXISTS kz_player_statistics (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  player_id INT UNSIGNED NOT NULL,
  steamid64 VARCHAR(20) NULL,
  
  total_records INT UNSIGNED NOT NULL DEFAULT 0,
  total_maps INT UNSIGNED NOT NULL DEFAULT 0,
  total_points BIGINT UNSIGNED NOT NULL DEFAULT 0,
  total_playtime DECIMAL(12,3) NOT NULL DEFAULT 0,
  avg_teleports DECIMAL(6,2) NOT NULL DEFAULT 0,
  world_records INT UNSIGNED NOT NULL DEFAULT 0,
  
  pro_records INT UNSIGNED NOT NULL DEFAULT 0,
  tp_records INT UNSIGNED NOT NULL DEFAULT 0,
  
  best_time DECIMAL(10,3) NULL,
  first_record_date DATETIME NULL,
  last_record_date DATETIME NULL,
  
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  UNIQUE KEY unique_player (player_id),
  KEY idx_total_records (total_records DESC),
  KEY idx_total_points (total_points DESC),
  KEY idx_world_records (world_records DESC),
  KEY idx_updated (updated_at),
  
  FOREIGN KEY (player_id) REFERENCES kz_players(id) ON DELETE CASCADE
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
  steamid64 VARCHAR(20) NOT NULL,
  time DECIMAL(10,3) NOT NULL,
  points INT NOT NULL DEFAULT 0,
  server_id INT UNSIGNED NOT NULL,
  created_on DATETIME NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  PRIMARY KEY (map_id, mode, stage, teleports),
  INDEX idx_player_records (steamid64, created_on DESC),
  
  CONSTRAINT fk_wr_map FOREIGN KEY (map_id) REFERENCES kz_maps(id) ON DELETE CASCADE,
  CONSTRAINT fk_wr_player FOREIGN KEY (steamid64) REFERENCES kz_players(steamid64) ON DELETE CASCADE,
  CONSTRAINT fk_wr_server FOREIGN KEY (server_id) REFERENCES kz_servers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Player statistics
CREATE TABLE IF NOT EXISTS kz_player_statistics (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  player_id INT UNSIGNED NOT NULL,
  steamid64 VARCHAR(20) NULL,
  
  total_records INT UNSIGNED NOT NULL DEFAULT 0,
  total_maps INT UNSIGNED NOT NULL DEFAULT 0,
  total_points BIGINT UNSIGNED NOT NULL DEFAULT 0,
  total_playtime DECIMAL(12,3) NOT NULL DEFAULT 0,
  avg_teleports DECIMAL(6,2) NOT NULL DEFAULT 0,
  world_records INT UNSIGNED NOT NULL DEFAULT 0,
  
  pro_records INT UNSIGNED NOT NULL DEFAULT 0,
  tp_records INT UNSIGNED NOT NULL DEFAULT 0,
  
  best_time DECIMAL(10,3) NULL,
  first_record_date DATETIME NULL,
  last_record_date DATETIME NULL,
  
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  UNIQUE KEY unique_player (player_id),
  KEY idx_total_records (total_records DESC),
  KEY idx_total_points (total_points DESC),
  KEY idx_world_records (world_records DESC),
  KEY idx_updated (updated_at),
  
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

-- Create a log table for partition maintenance
CREATE TABLE IF NOT EXISTS partition_maintenance_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  executed_at DATETIME NOT NULL,
  status VARCHAR(255),
  INDEX idx_executed (executed_at DESC)
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
  REPLACE INTO kz_worldrecords_cache (map_id, mode, stage, teleports, steamid64, time, points, server_id, created_on)
  SELECT 
  r.map_id,
  r.mode,
  r.stage,
  CASE WHEN r.teleports = 0 THEN 0 ELSE 1 END as teleports,
  r.steamid64,
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
  WHERE p.steamid64 = r.steamid64
  AND p.is_banned = TRUE
  );

  COMMIT;
END$$

-- Procedure to maintain yearly partitions
CREATE PROCEDURE maintain_yearly_partitions()
BEGIN
  DECLARE v_current_year INT;
  DECLARE v_max_partition_year INT;
  DECLARE v_years_ahead INT DEFAULT 2; -- Create partitions 2 years ahead
  DECLARE v_partition_name VARCHAR(50);
  DECLARE v_next_year INT;
  DECLARE v_sql TEXT;
  DECLARE v_partition_exists INT;
  DECLARE i INT;
  
  -- Get current year
  SET v_current_year = YEAR(CURDATE());
  
  -- Find the highest year partition (excluding pfuture)
  SELECT COALESCE(MAX(
    CAST(SUBSTRING(partition_name, 2) AS UNSIGNED)
  ), v_current_year)
  INTO v_max_partition_year
  FROM information_schema.partitions
  WHERE table_schema = DATABASE()
    AND table_name = 'kz_records_partitioned'
    AND partition_name REGEXP '^p[0-9]{4}$';
  
  -- Create partitions for future years
  SET i = 1;
  WHILE i <= v_years_ahead DO
    SET v_next_year = v_current_year + i;
    SET v_partition_name = CONCAT('p', v_next_year);
    
    -- Check if partition already exists
    SELECT COUNT(*) INTO v_partition_exists
    FROM information_schema.partitions
    WHERE table_schema = DATABASE()
      AND table_name = 'kz_records_partitioned'
      AND partition_name = v_partition_name;
    
    IF v_partition_exists = 0 AND v_next_year > v_max_partition_year THEN
      -- Create the new partition by reorganizing pfuture
      SET v_sql = CONCAT(
        'ALTER TABLE kz_records_partitioned ',
        'REORGANIZE PARTITION pfuture INTO (',
        'PARTITION ', v_partition_name, 
        ' VALUES LESS THAN (TO_DAYS(''', v_next_year + 1, '-01-01'')),',
        'PARTITION pfuture VALUES LESS THAN MAXVALUE)'
      );
      
      SET @sql = v_sql;
      PREPARE stmt FROM @sql;
      EXECUTE stmt;
      DEALLOCATE PREPARE stmt;
      
      SELECT CONCAT('Created partition ', v_partition_name, ' for year ', v_next_year) AS status;
    END IF;
    
    SET i = i + 1;
  END WHILE;
  
  SELECT CONCAT('Partition maintenance complete. Partitions exist through year ', 
                v_current_year + v_years_ahead) AS result;
END$$

-- Procedure to analyze partition distribution by year
CREATE PROCEDURE analyze_yearly_partitions()
BEGIN
  SELECT 
    partition_name AS 'Partition',
    table_rows AS 'Estimated Rows',
    ROUND(data_length / 1024 / 1024, 2) AS 'Data Size (MB)',
    ROUND(index_length / 1024 / 1024, 2) AS 'Index Size (MB)',
    ROUND((data_length + index_length) / 1024 / 1024, 2) AS 'Total Size (MB)',
    CASE 
      WHEN partition_name = 'p_old' THEN 'Before 2018'
      WHEN partition_name = 'pfuture' THEN 'Future data'
      WHEN partition_name REGEXP '^p[0-9]{4}$' THEN CONCAT('Year ', SUBSTRING(partition_name, 2))
      ELSE 'Unknown'
    END AS 'Period'
  FROM information_schema.partitions
  WHERE table_schema = DATABASE()
    AND table_name = 'kz_records_partitioned'
    AND partition_name IS NOT NULL
  ORDER BY 
    CASE 
      WHEN partition_name = 'p_old' THEN 0
      WHEN partition_name REGEXP '^p[0-9]{4}$' THEN CAST(SUBSTRING(partition_name, 2) AS UNSIGNED)
      ELSE 9999
    END;
  
  -- Show total statistics
  SELECT 
    'TOTAL' AS 'Summary',
    SUM(table_rows) AS 'Total Rows',
    ROUND(SUM(data_length) / 1024 / 1024 / 1024, 2) AS 'Total Data (GB)',
    ROUND(SUM(index_length) / 1024 / 1024 / 1024, 2) AS 'Total Index (GB)',
    ROUND(SUM(data_length + index_length) / 1024 / 1024 / 1024, 2) AS 'Total Size (GB)',
    COUNT(DISTINCT partition_name) - 1 AS 'Partition Count' -- Exclude NULL
  FROM information_schema.partitions
  WHERE table_schema = DATABASE()
    AND table_name = 'kz_records_partitioned';
END$$

CREATE EVENT IF NOT EXISTS maintain_partitions_event
ON SCHEDULE EVERY 1 MONTH
STARTS DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL 1 MONTH), '%Y-%m-01 00:00:00')
DO
BEGIN
  CALL maintain_yearly_partitions();
  
  -- Log the maintenance
  INSERT INTO partition_maintenance_log (executed_at, status)
  VALUES (NOW(), 'Yearly partition maintenance completed');
END$$

DROP PROCEDURE IF EXISTS refresh_player_statistics$$
CREATE PROCEDURE refresh_player_statistics(IN p_player_id INT)
BEGIN
  DECLARE v_steamid64 VARCHAR(20);
  
  -- Get steamid64 for the player
  SELECT steamid64 INTO v_steamid64 
  FROM kz_players 
  WHERE id = p_player_id;
  
  -- Update or insert statistics
  INSERT INTO kz_player_statistics (
    player_id,
    steamid64,
    total_records,
    total_maps,
    total_points,
    total_playtime,
    avg_teleports,
    world_records,
    pro_records,
    tp_records,
    best_time,
    first_record_date,
    last_record_date
  )
  SELECT 
    p_player_id,
    COUNT(DISTINCT r.id),
    COUNT(DISTINCT r.map_id),
    COALESCE(SUM(r.points), 0),
    COALESCE(SUM(r.time), 0),
    COALESCE(AVG(r.teleports), 0),
    (SELECT COUNT(*) FROM kz_worldrecords_cache WHERE player_id = v_steamid64),
    SUM(CASE WHEN r.teleports = 0 THEN 1 ELSE 0 END),
    SUM(CASE WHEN r.teleports > 0 THEN 1 ELSE 0 END),
    MIN(r.time),
    MIN(r.created_on),
    MAX(r.created_on)
  FROM kz_records_partitioned r
  WHERE r.player_id = v_steamid64
  ON DUPLICATE KEY UPDATE
    total_records = VALUES(total_records),
    total_maps = VALUES(total_maps),
    total_points = VALUES(total_points),
    total_playtime = VALUES(total_playtime),
    avg_teleports = VALUES(avg_teleports),
    world_records = VALUES(world_records),
    pro_records = VALUES(pro_records),
    tp_records = VALUES(tp_records),
    best_time = VALUES(best_time),
    first_record_date = VALUES(first_record_date),
    last_record_date = VALUES(last_record_date),
    updated_at = CURRENT_TIMESTAMP;
END$$

-- Procedure to batch refresh all player statistics
DROP PROCEDURE IF EXISTS refresh_all_player_statistics$$
CREATE PROCEDURE refresh_all_player_statistics()
BEGIN
  DECLARE done INT DEFAULT 0;
  DECLARE v_player_id INT;
  DECLARE v_count INT DEFAULT 0;
  DECLARE cur CURSOR FOR 
    SELECT DISTINCT p.id 
    FROM kz_players p
    INNER JOIN kz_records_partitioned r ON p.steamid64 = r.player_id
    WHERE NOT EXISTS (
      SELECT 1 FROM kz_player_statistics ps 
      WHERE ps.player_id = p.id 
      AND ps.updated_at > DATE_SUB(NOW(), INTERVAL 1 DAY)
    )
    LIMIT 1000;  -- Process in batches
    
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = 1;
  
  OPEN cur;
  
  read_loop: LOOP
    FETCH cur INTO v_player_id;
    IF done THEN
      LEAVE read_loop;
    END IF;
    
    CALL refresh_player_statistics(v_player_id);
    SET v_count = v_count + 1;
    
    -- Log progress every 100 players
    IF v_count MOD 100 = 0 THEN
      SELECT CONCAT('Processed ', v_count, ' players...') AS progress;
    END IF;
    
    -- Small delay to prevent overwhelming the server
    DO SLEEP(0.01);
  END LOOP;
  
  CLOSE cur;
  
  SELECT CONCAT('Completed refreshing ', v_count, ' player statistics') AS result;
END$$

-- Procedure for initial population of statistics table
DROP PROCEDURE IF EXISTS populate_player_statistics$$
CREATE PROCEDURE populate_player_statistics()
BEGIN
  DECLARE v_total_players INT;
  DECLARE v_processed INT DEFAULT 0;
  DECLARE v_batch_size INT DEFAULT 500;
  DECLARE v_offset INT DEFAULT 0;
  
  -- Get total player count
  SELECT COUNT(DISTINCT p.id) INTO v_total_players
  FROM kz_players p
  INNER JOIN kz_records_partitioned r ON p.steamid64 = r.player_id;
  
  SELECT CONCAT('Starting to populate statistics for ', v_total_players, ' players') AS status;
  
  -- Process in batches to avoid memory issues
  WHILE v_offset < v_total_players DO
    -- Insert batch of player statistics
    INSERT IGNORE INTO kz_player_statistics (
      player_id,
      steamid64,
      total_records,
      total_maps,
      total_points,
      total_playtime,
      avg_teleports,
      pro_records,
      tp_records,
      best_time,
      first_record_date,
      last_record_date
    )
    SELECT 
      p.id,
      COUNT(DISTINCT r.id),
      COUNT(DISTINCT r.map_id),
      COALESCE(SUM(r.points), 0),
      COALESCE(SUM(r.time), 0),
      COALESCE(AVG(r.teleports), 0),
      SUM(CASE WHEN r.teleports = 0 THEN 1 ELSE 0 END),
      SUM(CASE WHEN r.teleports > 0 THEN 1 ELSE 0 END),
      MIN(r.time),
      MIN(r.created_on),
      MAX(r.created_on)
    FROM (
      SELECT DISTINCT id, steamid64 
      FROM kz_players p2
      WHERE EXISTS (
        SELECT 1 FROM kz_records_partitioned r2 
        WHERE r2.player_id = p2.steamid64
      )
      ORDER BY id
      LIMIT v_batch_size OFFSET v_offset
    ) p
    INNER JOIN kz_records_partitioned r ON p.steamid64 = r.player_id
    GROUP BY p.id;
    
    SET v_processed = v_processed + ROW_COUNT();
    SET v_offset = v_offset + v_batch_size;
    
    SELECT CONCAT('Processed ', v_processed, ' / ', v_total_players, ' players') AS progress;
    
    -- Commit to free up resources
    COMMIT;
    
    -- Small delay
    DO SLEEP(0.5);
  END WHILE;
  
  -- Update world records count
  UPDATE kz_player_statistics ps
  SET world_records = (
    SELECT COUNT(*) 
    FROM kz_worldrecords_cache wrc
    INNER JOIN kz_players p ON wrc.player_id = p.steamid64
    WHERE p.id = ps.player_id
  )
  WHERE world_records = 0;
  
  SELECT CONCAT('Population complete. Processed ', v_processed, ' players') AS result;
END$$

-- Create an event to refresh statistics daily
DROP EVENT IF EXISTS refresh_player_stats_event$$
CREATE EVENT IF NOT EXISTS refresh_player_stats_event
ON SCHEDULE EVERY 1 DAY
STARTS DATE_ADD(DATE(NOW()), INTERVAL 1 DAY) + INTERVAL 3 HOUR
DO
BEGIN
  CALL refresh_all_player_statistics();
END$$

DELIMITER ;

-- Helper view to see records per year
CREATE OR REPLACE VIEW kz_records_by_year AS
SELECT 
  YEAR(created_on) as year,
  COUNT(*) as record_count,
  COUNT(DISTINCT steamid64) as unique_players,
  COUNT(DISTINCT map_id) as unique_maps,
  MIN(created_on) as first_record,
  MAX(created_on) as last_record
FROM kz_records_partitioned
GROUP BY YEAR(created_on)
ORDER BY year DESC;
