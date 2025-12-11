-- KZ Records Database Schema

-- Charset and collation settings
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SET collation_connection = 'utf8mb4_unicode_ci';

-------------------------------------------------------------------

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

DELIMITER $$

-- Procedure for initial population of statistics table
DROP PROCEDURE IF EXISTS populate_player_statistics$$
CREATE PROCEDURE populate_player_statistics()
BEGIN
  DECLARE v_total_players INT;
  DECLARE v_processed INT DEFAULT 0;
  DECLARE v_batch_size INT DEFAULT 500;
  DECLARE v_offset INT DEFAULT 0;
  
  -- Get total player count (excluding banned players)
  SELECT COUNT(DISTINCT p.id) INTO v_total_players
  FROM kz_players p
  INNER JOIN kz_records_partitioned r ON p.steamid64 COLLATE utf8mb4_unicode_ci = r.player_id COLLATE utf8mb4_unicode_ci
  WHERE (p.is_banned IS NULL OR p.is_banned = FALSE);
  
  SELECT CONCAT('Starting to populate statistics for ', v_total_players, ' non-banned players') AS status;
  
  -- Process in batches to avoid memory issues
  WHILE v_offset < v_total_players DO
    -- Insert batch of player statistics (only non-banned players)
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
      p.steamid64,
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
      WHERE (p2.is_banned IS NULL OR p2.is_banned = FALSE)
      AND EXISTS (
        SELECT 1 FROM kz_records_partitioned r2 
        WHERE r2.player_id COLLATE utf8mb4_unicode_ci = p2.steamid64 COLLATE utf8mb4_unicode_ci
      )
      ORDER BY id
      LIMIT v_batch_size OFFSET v_offset
    ) p
    INNER JOIN kz_records_partitioned r ON p.steamid64 COLLATE utf8mb4_unicode_ci = r.player_id COLLATE utf8mb4_unicode_ci
    GROUP BY p.id, p.steamid64;
    
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
    INNER JOIN kz_players p ON wrc.player_id COLLATE utf8mb4_unicode_ci = p.steamid64 COLLATE utf8mb4_unicode_ci
    WHERE p.id = ps.player_id
  )
  WHERE world_records = 0;
  
  SELECT CONCAT('Population complete. Processed ', v_processed, ' non-banned players') AS result;
END$$

-- Procedure to refresh statistics for a single player (skip if banned)
DROP PROCEDURE IF EXISTS refresh_player_statistics$$
CREATE PROCEDURE refresh_player_statistics(IN p_player_id INT)
BEGIN
  DECLARE v_steamid64 VARCHAR(20);
  DECLARE v_is_banned BOOLEAN DEFAULT FALSE;
  
  -- Get steamid64 and ban status for the player
  SELECT steamid64, COALESCE(is_banned, FALSE) INTO v_steamid64, v_is_banned
  FROM kz_players 
  WHERE id = p_player_id;
  
  -- Skip banned players - delete their stats if they exist
  IF v_is_banned THEN
    DELETE FROM kz_player_statistics WHERE player_id = p_player_id;
  ELSE
  
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
    v_steamid64,
    COUNT(DISTINCT r.id),
    COUNT(DISTINCT r.map_id),
    COALESCE(SUM(r.points), 0),
    COALESCE(SUM(r.time), 0),
    COALESCE(AVG(r.teleports), 0),
    (SELECT COUNT(*) FROM kz_worldrecords_cache WHERE player_id COLLATE utf8mb4_unicode_ci = v_steamid64 COLLATE utf8mb4_unicode_ci),
    SUM(CASE WHEN r.teleports = 0 THEN 1 ELSE 0 END),
    SUM(CASE WHEN r.teleports > 0 THEN 1 ELSE 0 END),
    MIN(r.time),
    MIN(r.created_on),
    MAX(r.created_on)
  FROM kz_records_partitioned r
  WHERE r.player_id COLLATE utf8mb4_unicode_ci = v_steamid64 COLLATE utf8mb4_unicode_ci
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
  END IF;
END$$

-- Procedure to batch refresh all player statistics (skip banned players)
DROP PROCEDURE IF EXISTS refresh_all_player_statistics$$
CREATE PROCEDURE refresh_all_player_statistics()
BEGIN
  DECLARE done INT DEFAULT 0;
  DECLARE v_player_id INT;
  DECLARE v_count INT DEFAULT 0;
  DECLARE cur CURSOR FOR 
    SELECT DISTINCT p.id 
    FROM kz_players p
    INNER JOIN kz_records_partitioned r ON p.steamid64 COLLATE utf8mb4_unicode_ci = r.player_id COLLATE utf8mb4_unicode_ci
    WHERE (p.is_banned IS NULL OR p.is_banned = FALSE)
    AND NOT EXISTS (
      SELECT 1 FROM kz_player_statistics ps 
      WHERE ps.player_id = p.id 
      AND ps.updated_at > DATE_SUB(NOW(), INTERVAL 1 DAY)
    )
    LIMIT 1000;  -- Process in batches
    
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = 1;
  
  -- First, clean up any statistics for newly banned players
  DELETE ps FROM kz_player_statistics ps
  INNER JOIN kz_players p ON ps.player_id = p.id
  WHERE p.is_banned = TRUE;
  
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
  
  SELECT CONCAT('Completed refreshing ', v_count, ' non-banned player statistics') AS result;
END$$

-- Statistics events are now handled by Node.js kzStatistics service
-- See: src/services/kzStatistics.js
-- To remove existing events, run: db/migrations/remove_statistics_events.sql

DELIMITER ;

-------------------------------------------------------------------

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

-- Map statistics table
CREATE TABLE IF NOT EXISTS kz_map_statistics (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  map_id INT UNSIGNED NOT NULL,
  
  total_records INT UNSIGNED NOT NULL DEFAULT 0,
  unique_players INT UNSIGNED NOT NULL DEFAULT 0,
  total_completions INT UNSIGNED NOT NULL DEFAULT 0,
  
  -- Record stats by type
  pro_records INT UNSIGNED NOT NULL DEFAULT 0,
  tp_records INT UNSIGNED NOT NULL DEFAULT 0,
  
  -- Time statistics
  world_record_time DECIMAL(10,3) NULL,
  avg_time DECIMAL(10,3) NULL,
  median_time DECIMAL(10,3) NULL,
  
  -- First and last records
  first_record_date DATETIME NULL,
  last_record_date DATETIME NULL,
  
  -- Timestamps
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  UNIQUE KEY unique_map (map_id),
  KEY idx_total_records (total_records DESC),
  KEY idx_unique_players (unique_players DESC),
  KEY idx_world_record_time (world_record_time ASC),
  KEY idx_updated (updated_at),
  
  FOREIGN KEY (map_id) REFERENCES kz_maps(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT = 'Pre-calculated statistics for maps to improve query performance';

DELIMITER $$

-- Procedure for initial population of map statistics
DROP PROCEDURE IF EXISTS populate_map_statistics$$
CREATE PROCEDURE populate_map_statistics()
BEGIN
  DECLARE v_total_maps INT;
  DECLARE v_processed INT DEFAULT 0;
  DECLARE v_batch_size INT DEFAULT 100;
  DECLARE v_offset INT DEFAULT 0;
  
  -- Get total map count with records
  SELECT COUNT(DISTINCT m.id) INTO v_total_maps
  FROM kz_maps m
  INNER JOIN kz_records_partitioned r ON m.id = r.map_id;
  
  SELECT CONCAT('Starting to populate statistics for ', v_total_maps, ' maps') AS status;
  
  -- Process in batches to avoid memory issues
  WHILE v_offset < v_total_maps DO
    -- Insert batch of map statistics
    INSERT IGNORE INTO kz_map_statistics (
      map_id,
      total_records,
      unique_players,
      total_completions,
      pro_records,
      tp_records,
      world_record_time,
      avg_time,
      first_record_date,
      last_record_date
    )
    SELECT 
      m.id,
      COUNT(DISTINCT r.id),
      COUNT(DISTINCT r.player_id),
      COUNT(*),
      SUM(CASE WHEN r.teleports = 0 THEN 1 ELSE 0 END),
      SUM(CASE WHEN r.teleports > 0 THEN 1 ELSE 0 END),
      MIN(r.time),
      AVG(r.time),
      MIN(r.created_on),
      MAX(r.created_on)
    FROM (
      SELECT id
      FROM kz_maps m2
      WHERE EXISTS (
        SELECT 1 FROM kz_records_partitioned r2 
        WHERE r2.map_id = m2.id
      )
      ORDER BY id
      LIMIT v_batch_size OFFSET v_offset
    ) m
    INNER JOIN kz_records_partitioned r ON m.id = r.map_id
    INNER JOIN kz_players p ON r.player_id = p.id
    WHERE (p.is_banned IS NULL OR p.is_banned = FALSE)
    GROUP BY m.id;
    
    SET v_processed = v_processed + ROW_COUNT();
    SET v_offset = v_offset + v_batch_size;
    
    SELECT CONCAT('Processed ', v_processed, ' / ', v_total_maps, ' maps') AS progress;
    
    -- Commit to free up resources
    COMMIT;
    
    -- Small delay
    DO SLEEP(0.5);
  END WHILE;
  
  SELECT CONCAT('Population complete. Processed ', v_processed, ' maps') AS result;
END$$

-- Procedure to batch refresh all map statistics
DROP PROCEDURE IF EXISTS refresh_all_map_statistics$$
CREATE PROCEDURE refresh_all_map_statistics()
BEGIN
  DECLARE done INT DEFAULT 0;
  DECLARE v_map_id INT;
  DECLARE v_count INT DEFAULT 0;
  DECLARE cur CURSOR FOR 
    SELECT DISTINCT m.id 
    FROM kz_maps m
    INNER JOIN kz_records_partitioned r ON m.id = r.map_id
    WHERE NOT EXISTS (
      SELECT 1 FROM kz_map_statistics ms 
      WHERE ms.map_id = m.id 
      AND ms.updated_at > DATE_SUB(NOW(), INTERVAL 1 DAY)
    )
    LIMIT 1000;  -- Process in batches
    
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = 1;
  
  OPEN cur;
  
  read_loop: LOOP
    FETCH cur INTO v_map_id;
    IF done THEN
      LEAVE read_loop;
    END IF;
    
    CALL refresh_map_statistics(v_map_id);
    SET v_count = v_count + 1;
    
    -- Log progress every 50 maps
    IF v_count MOD 50 = 0 THEN
      SELECT CONCAT('Processed ', v_count, ' maps...') AS progress;
    END IF;
    
    -- Small delay to prevent overwhelming the server
    DO SLEEP(0.01);
  END LOOP;
  
  CLOSE cur;
  
  SELECT CONCAT('Completed refreshing ', v_count, ' map statistics') AS result;
END$$

-- Procedure to refresh statistics for a single map
DROP PROCEDURE IF EXISTS refresh_map_statistics$$
CREATE PROCEDURE refresh_map_statistics(IN p_map_id INT)
BEGIN
  -- Update or insert statistics
  INSERT INTO kz_map_statistics (
    map_id,
    total_records,
    unique_players,
    total_completions,
    pro_records,
    tp_records,
    world_record_time,
    avg_time,
    first_record_date,
    last_record_date
  )
  SELECT 
    p_map_id,
    COUNT(DISTINCT r.id),
    COUNT(DISTINCT r.player_id),
    COUNT(*),
    SUM(CASE WHEN r.teleports = 0 THEN 1 ELSE 0 END),
    SUM(CASE WHEN r.teleports > 0 THEN 1 ELSE 0 END),
    MIN(r.time),
    AVG(r.time),
    MIN(r.created_on),
    MAX(r.created_on)
  FROM kz_records_partitioned r
  INNER JOIN kz_players p ON r.player_id = p.id
  WHERE r.map_id = p_map_id
    AND (p.is_banned IS NULL OR p.is_banned = FALSE)
  ON DUPLICATE KEY UPDATE
    total_records = VALUES(total_records),
    unique_players = VALUES(unique_players),
    total_completions = VALUES(total_completions),
    pro_records = VALUES(pro_records),
    tp_records = VALUES(tp_records),
    world_record_time = VALUES(world_record_time),
    avg_time = VALUES(avg_time),
    first_record_date = VALUES(first_record_date),
    last_record_date = VALUES(last_record_date),
    updated_at = CURRENT_TIMESTAMP;
END$$

-- Map statistics event now handled by Node.js kzStatistics service

DELIMITER ;

CREATE OR REPLACE VIEW kz_map_leaderboard AS
SELECT 
  ms.*,
  m.difficulty,
  m.validated,
  m.workshop_url
FROM kz_map_statistics ms
INNER JOIN kz_maps m ON ms.map_id = m.id
ORDER BY ms.total_records DESC;

-------------------------------------------------------------------

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

-- Server statistics table
CREATE TABLE IF NOT EXISTS kz_server_statistics (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  server_id INT UNSIGNED NOT NULL,
  
  total_records INT UNSIGNED NOT NULL DEFAULT 0,
  unique_players INT UNSIGNED NOT NULL DEFAULT 0,
  unique_maps INT UNSIGNED NOT NULL DEFAULT 0,
  
  -- Record stats by type
  pro_records INT UNSIGNED NOT NULL DEFAULT 0,
  tp_records INT UNSIGNED NOT NULL DEFAULT 0,
  
  -- Activity metrics
  first_record_date DATETIME NULL,
  last_record_date DATETIME NULL,
  avg_records_per_day DECIMAL(10,2) NULL,
  
  -- World records hosted
  world_records_hosted INT UNSIGNED NOT NULL DEFAULT 0,
  
  -- Timestamps
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  UNIQUE KEY unique_server (server_id),
  KEY idx_total_records (total_records DESC),
  KEY idx_unique_players (unique_players DESC),
  KEY idx_unique_maps (unique_maps DESC),
  KEY idx_world_records (world_records_hosted DESC),
  KEY idx_updated (updated_at),
  
  FOREIGN KEY (server_id) REFERENCES kz_servers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT = 'Pre-calculated statistics for servers to improve query performance';

DELIMITER $$

-- Procedure for initial population of server statistics
DROP PROCEDURE IF EXISTS populate_server_statistics$$
CREATE PROCEDURE populate_server_statistics()
BEGIN
  DECLARE v_total_servers INT;
  DECLARE v_processed INT DEFAULT 0;
  DECLARE v_batch_size INT DEFAULT 50;
  DECLARE v_offset INT DEFAULT 0;
  
  -- Get total server count with records
  SELECT COUNT(DISTINCT s.id) INTO v_total_servers
  FROM kz_servers s
  INNER JOIN kz_records_partitioned r ON s.id = r.server_id;
  
  SELECT CONCAT('Starting to populate statistics for ', v_total_servers, ' servers') AS status;
  
  -- Process in batches to avoid memory issues
  WHILE v_offset < v_total_servers DO
    -- Insert batch of server statistics
    INSERT IGNORE INTO kz_server_statistics (
      server_id,
      total_records,
      unique_players,
      unique_maps,
      pro_records,
      tp_records,
      first_record_date,
      last_record_date,
      avg_records_per_day,
      world_records_hosted
    )
    SELECT 
      s.id,
      COUNT(DISTINCT r.id),
      COUNT(DISTINCT r.player_id),
      COUNT(DISTINCT r.map_id),
      SUM(CASE WHEN r.teleports = 0 THEN 1 ELSE 0 END),
      SUM(CASE WHEN r.teleports > 0 THEN 1 ELSE 0 END),
      MIN(r.created_on),
      MAX(r.created_on),
      CASE 
        WHEN DATEDIFF(MAX(r.created_on), MIN(r.created_on)) > 0 
        THEN COUNT(*) / GREATEST(1, DATEDIFF(MAX(r.created_on), MIN(r.created_on)))
        ELSE 0 
      END,
      (
        SELECT COUNT(*) 
        FROM kz_worldrecords_cache wrc
        WHERE wrc.server_id = s.id
      )
    FROM (
      SELECT id
      FROM kz_servers s2
      WHERE EXISTS (
        SELECT 1 FROM kz_records_partitioned r2 
        WHERE r2.server_id = s2.id
      )
      ORDER BY id
      LIMIT v_batch_size OFFSET v_offset
    ) s
    INNER JOIN kz_records_partitioned r ON s.id = r.server_id
    INNER JOIN kz_players p ON r.player_id = p.id
    WHERE (p.is_banned IS NULL OR p.is_banned = FALSE)
    GROUP BY s.id;
    
    SET v_processed = v_processed + ROW_COUNT();
    SET v_offset = v_offset + v_batch_size;
    
    SELECT CONCAT('Processed ', v_processed, ' / ', v_total_servers, ' servers') AS progress;
    
    -- Commit to free up resources
    COMMIT;
    
    -- Small delay
    DO SLEEP(0.5);
  END WHILE;
  
  SELECT CONCAT('Population complete. Processed ', v_processed, ' servers') AS result;
END$$

-- Procedure to batch refresh all server statistics
DROP PROCEDURE IF EXISTS refresh_all_server_statistics$$
CREATE PROCEDURE refresh_all_server_statistics()
BEGIN
  DECLARE done INT DEFAULT 0;
  DECLARE v_server_id INT;
  DECLARE v_count INT DEFAULT 0;
  DECLARE cur CURSOR FOR 
    SELECT DISTINCT s.id 
    FROM kz_servers s
    INNER JOIN kz_records_partitioned r ON s.id = r.server_id
    WHERE NOT EXISTS (
      SELECT 1 FROM kz_server_statistics ss 
      WHERE ss.server_id = s.id 
      AND ss.updated_at > DATE_SUB(NOW(), INTERVAL 1 DAY)
    )
    LIMIT 1000;  -- Process in batches
    
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = 1;
  
  OPEN cur;
  
  read_loop: LOOP
    FETCH cur INTO v_server_id;
    IF done THEN
      LEAVE read_loop;
    END IF;
    
    CALL refresh_server_statistics(v_server_id);
    SET v_count = v_count + 1;
    
    -- Log progress every 20 servers
    IF v_count MOD 20 = 0 THEN
      SELECT CONCAT('Processed ', v_count, ' servers...') AS progress;
    END IF;
    
    -- Small delay to prevent overwhelming the server
    DO SLEEP(0.01);
  END LOOP;
  
  CLOSE cur;
  
  SELECT CONCAT('Completed refreshing ', v_count, ' server statistics') AS result;
END$$

-- Procedure to refresh statistics for a single server (exclude banned player records)
DROP PROCEDURE IF EXISTS refresh_server_statistics$$
CREATE PROCEDURE refresh_server_statistics(IN p_server_id INT)
BEGIN
  DECLARE v_days_active INT;
  
  -- Calculate days active (only from non-banned player records)
  SELECT GREATEST(1, DATEDIFF(MAX(r.created_on), MIN(r.created_on))) INTO v_days_active
  FROM kz_records_partitioned r
  INNER JOIN kz_players p ON r.player_id = p.id
  WHERE r.server_id = p_server_id
    AND (p.is_banned IS NULL OR p.is_banned = FALSE);
  
  -- Update or insert statistics (excluding banned player records)
  INSERT INTO kz_server_statistics (
    server_id,
    total_records,
    unique_players,
    unique_maps,
    pro_records,
    tp_records,
    first_record_date,
    last_record_date,
    avg_records_per_day,
    world_records_hosted
  )
  SELECT 
    p_server_id,
    COUNT(DISTINCT r.id),
    COUNT(DISTINCT r.player_id),
    COUNT(DISTINCT r.map_id),
    SUM(CASE WHEN r.teleports = 0 THEN 1 ELSE 0 END),
    SUM(CASE WHEN r.teleports > 0 THEN 1 ELSE 0 END),
    MIN(r.created_on),
    MAX(r.created_on),
    CASE WHEN v_days_active > 0 THEN COUNT(*) / v_days_active ELSE 0 END,
    (
      SELECT COUNT(*) 
      FROM kz_worldrecords_cache wrc
      WHERE wrc.server_id = p_server_id
    )
  FROM kz_records_partitioned r
  INNER JOIN kz_players p ON r.player_id = p.id
  WHERE r.server_id = p_server_id
    AND (p.is_banned IS NULL OR p.is_banned = FALSE)
  ON DUPLICATE KEY UPDATE
    total_records = VALUES(total_records),
    unique_players = VALUES(unique_players),
    unique_maps = VALUES(unique_maps),
    pro_records = VALUES(pro_records),
    tp_records = VALUES(tp_records),
    first_record_date = VALUES(first_record_date),
    last_record_date = VALUES(last_record_date),
    avg_records_per_day = VALUES(avg_records_per_day),
    world_records_hosted = VALUES(world_records_hosted),
    updated_at = CURRENT_TIMESTAMP;
END$$

-- Server statistics event now handled by Node.js kzStatistics service

DELIMITER ;

CREATE OR REPLACE VIEW kz_server_leaderboard AS
SELECT 
  ss.*,
  s.ip,
  s.port,
  s.owner_steamid64,
  s.approval_status
FROM kz_server_statistics ss
INNER JOIN kz_servers s ON ss.server_id = s.id
ORDER BY ss.total_records DESC;

-------------------------------------------------------------------

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
  INDEX idx_player_map_mode (player_id, map_id, mode, stage, time),
  INDEX idx_leaderboard (player_id, map_id, mode, stage, teleports, time),
  INDEX idx_recent_records (created_on DESC, mode, map_id),
  INDEX idx_server_records (server_id, created_on DESC),
  INDEX idx_mode_stage (mode, stage, teleports, time),
  INDEX idx_original_id (original_id),
  INDEX idx_steamid64 (steamid64),
  
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
  KEY idx_player_map_mode (player_id, map_id, mode, stage, time),
  KEY idx_leaderboard (map_id, mode, stage, teleports, time),
  KEY idx_recent_records (created_on DESC, mode, map_id),
  KEY idx_server_records (server_id, created_on DESC),
  KEY idx_mode_stage (mode, stage, teleports, time),
  KEY idx_player_id (player_id),
  KEY idx_steamid64 (steamid64),
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

DELIMITER $$

DROP PROCEDURE IF EXISTS maintain_yearly_partitions$$
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

DROP PROCEDURE IF EXISTS analyze_yearly_partitions$$
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

-------------------------------------------------------------------

-- Create a log table for partition maintenance
CREATE TABLE IF NOT EXISTS partition_maintenance_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  executed_at DATETIME NOT NULL,
  status VARCHAR(255),
  INDEX idx_executed (executed_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS kz_worldrecords_cache (
  map_id INT UNSIGNED NOT NULL,
  mode VARCHAR(32) NOT NULL,
  stage INT NOT NULL,
  teleports INT NOT NULL,
  player_id INT UNSIGNED NOT NULL,
  steamid64 VARCHAR(20) NOT NULL,
  time DECIMAL(10,3) NOT NULL,
  points INT NOT NULL DEFAULT 0,
  server_id INT UNSIGNED NOT NULL,
  created_on DATETIME NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  PRIMARY KEY (map_id, mode, stage, teleports),
  INDEX idx_player_records (player_id, created_on DESC),
  
  CONSTRAINT fk_wr_map FOREIGN KEY (map_id) REFERENCES kz_maps(id) ON DELETE CASCADE,
  CONSTRAINT fk_wr_player FOREIGN KEY (player_id) REFERENCES kz_players(id) ON DELETE CASCADE,
  CONSTRAINT fk_wr_server FOREIGN KEY (server_id) REFERENCES kz_servers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELIMITER $$

DROP PROCEDURE IF EXISTS refresh_worldrecords_cache$$
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
  -- Find best time from non-banned players only
  REPLACE INTO kz_worldrecords_cache (map_id, mode, stage, teleports, player_id, steamid64, time, points, server_id, created_on)
  SELECT 
  r.map_id,
  r.mode,
  r.stage,
  CASE WHEN r.teleports = 0 THEN 0 ELSE 1 END as teleports,
  r.player_id,
  r.steamid64,
  r.time,
  r.points,
  r.server_id,
  r.created_on
  FROM kz_records_partitioned r
  INNER JOIN kz_players p ON r.player_id = p.id
  INNER JOIN (
  -- Only consider records from non-banned players when finding best times
  SELECT 
    rp.map_id, 
    rp.mode, 
    rp.stage,
    CASE WHEN rp.teleports = 0 THEN 0 ELSE 1 END as tp_group,
    MIN(rp.time) as best_time
  FROM kz_records_partitioned rp
  INNER JOIN kz_players pl ON rp.player_id = pl.id
  WHERE rp.player_id IS NOT NULL
    AND (pl.is_banned IS NULL OR pl.is_banned = FALSE)
  GROUP BY rp.map_id, rp.mode, rp.stage, tp_group
  ) best ON r.map_id = best.map_id 
  AND r.mode = best.mode 
  AND r.stage = best.stage
  AND CASE WHEN r.teleports = 0 THEN 0 ELSE 1 END = best.tp_group
  AND r.time = best.best_time
  -- Ensure the record holder is not banned
  WHERE (p.is_banned IS NULL OR p.is_banned = FALSE);

  COMMIT;
END$$

DELIMITER ;

-------------------------------------------------------------------

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

-------------------------------------------------------------------

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

-------------------------------------------------------------------

-- Create kz_modes table (must be before kz_record_filters due to FK)
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

-------------------------------------------------------------------
