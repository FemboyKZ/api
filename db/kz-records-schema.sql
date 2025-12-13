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
  pbs_synced_at TIMESTAMP NULL COMMENT 'Last time player PBs were synced',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  INDEX idx_steam_id (steam_id),
  INDEX idx_player_name (player_name(50)),
  INDEX idx_total_records (total_records DESC),
  INDEX idx_is_banned (is_banned),
  INDEX idx_pbs_synced (pbs_synced_at)
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
  avg_teleports DECIMAL(10,2) NOT NULL DEFAULT 0,
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

-- =====================================================
-- OPTIMIZED: Batched refresh with commits
-- Processes players in batches to avoid lock timeouts
-- =====================================================
DROP PROCEDURE IF EXISTS refresh_player_statistics_batched$$
CREATE PROCEDURE refresh_player_statistics_batched(
  IN p_batch_size INT,
  IN p_max_batches INT
)
BEGIN
  DECLARE v_batch_count INT DEFAULT 0;
  DECLARE v_total_affected INT DEFAULT 0;
  DECLARE v_batch_affected INT;
  DECLARE v_more_rows INT DEFAULT 1;
  
  -- Default batch size if not specified
  IF p_batch_size IS NULL OR p_batch_size <= 0 THEN
    SET p_batch_size = 5000;
  END IF;
  
  -- Default max batches (0 = unlimited)
  IF p_max_batches IS NULL THEN
    SET p_max_batches = 0;
  END IF;
  
  -- First, clean up any statistics for banned players
  DELETE ps FROM kz_player_statistics ps
  INNER JOIN kz_players p ON ps.player_id = p.id
  WHERE p.is_banned = TRUE;
  
  COMMIT;
  
  -- Process in batches until no more stale players
  WHILE v_more_rows = 1 DO
    -- Check batch limit
    IF p_max_batches > 0 AND v_batch_count >= p_max_batches THEN
      SET v_more_rows = 0;
    ELSE
      -- Create temp table for this batch of player IDs
      DROP TEMPORARY TABLE IF EXISTS tmp_batch_players;
      CREATE TEMPORARY TABLE tmp_batch_players (
        player_id INT UNSIGNED PRIMARY KEY,
        steamid64 VARCHAR(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
        INDEX idx_steamid (steamid64)
      ) ENGINE=MEMORY DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      
      -- Select batch of stale players (no recent stats)
      INSERT INTO tmp_batch_players (player_id, steamid64)
      SELECT p.id, p.steamid64
      FROM kz_players p
      WHERE (p.is_banned IS NULL OR p.is_banned = FALSE)
        AND NOT EXISTS (
          SELECT 1 FROM kz_player_statistics ps 
          WHERE ps.player_id = p.id 
          AND ps.updated_at > DATE_SUB(NOW(), INTERVAL 1 DAY)
        )
        AND EXISTS (
          SELECT 1 FROM kz_records_partitioned r 
          WHERE r.steamid64 = p.steamid64
          LIMIT 1
        )
      LIMIT p_batch_size;
      
      SET v_batch_affected = ROW_COUNT();
      
      IF v_batch_affected = 0 THEN
        SET v_more_rows = 0;
      ELSE
        -- Insert/update statistics for this batch only
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
          bp.player_id,
          bp.steamid64,
          COUNT(DISTINCT r.id) AS total_records,
          COUNT(DISTINCT r.map_id) AS total_maps,
          COALESCE(SUM(r.points), 0) AS total_points,
          COALESCE(SUM(r.time), 0) AS total_playtime,
          COALESCE(AVG(r.teleports), 0) AS avg_teleports,
          COALESCE(wrc.world_record_count, 0) AS world_records,
          SUM(CASE WHEN r.teleports = 0 THEN 1 ELSE 0 END) AS pro_records,
          SUM(CASE WHEN r.teleports > 0 THEN 1 ELSE 0 END) AS tp_records,
          MIN(r.time) AS best_time,
          MIN(r.created_on) AS first_record_date,
          MAX(r.created_on) AS last_record_date
        FROM tmp_batch_players bp
        INNER JOIN kz_records_partitioned r ON bp.steamid64 = r.steamid64
        LEFT JOIN (
          SELECT player_id, COUNT(*) AS world_record_count
          FROM kz_worldrecords_cache
          GROUP BY player_id
        ) wrc ON wrc.player_id = bp.steamid64
        GROUP BY bp.player_id, bp.steamid64, wrc.world_record_count
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
        
        SET v_total_affected = v_total_affected + v_batch_affected;
        SET v_batch_count = v_batch_count + 1;
        
        -- Commit this batch
        COMMIT;
        
        -- Clean up temp table
        DROP TEMPORARY TABLE IF EXISTS tmp_batch_players;
      END IF;
    END IF;
  END WHILE;
  
  SELECT v_total_affected AS players_processed, v_batch_count AS batches;
END$$

-- =====================================================
-- Wrapper procedure with default batch size
-- =====================================================
DROP PROCEDURE IF EXISTS refresh_all_player_statistics$$
CREATE PROCEDURE refresh_all_player_statistics()
BEGIN
  -- Use 5000 players per batch, unlimited batches
  CALL refresh_player_statistics_batched(5000, 0);
END$$

-- =====================================================
-- Populate procedure (also uses batched approach)
-- =====================================================
DROP PROCEDURE IF EXISTS populate_player_statistics$$
CREATE PROCEDURE populate_player_statistics()
BEGIN
  -- Force refresh is essentially populate
  CALL force_refresh_player_statistics_batched(5000, 0);
END$$

-- =====================================================
-- Single player refresh (optimized)
-- =====================================================
DROP PROCEDURE IF EXISTS refresh_player_statistics$$
CREATE PROCEDURE refresh_player_statistics(IN p_player_id INT)
BEGIN
  DECLARE v_steamid64 VARCHAR(20);
  DECLARE v_is_banned BOOLEAN DEFAULT FALSE;
  
  SELECT steamid64, COALESCE(is_banned, FALSE) 
  INTO v_steamid64, v_is_banned
  FROM kz_players 
  WHERE id = p_player_id;
  
  IF v_is_banned THEN
    DELETE FROM kz_player_statistics WHERE player_id = p_player_id;
  ELSE
    INSERT INTO kz_player_statistics (
      player_id, steamid64, total_records, total_maps, total_points,
      total_playtime, avg_teleports, world_records, pro_records, tp_records,
      best_time, first_record_date, last_record_date
    )
    SELECT 
      p_player_id,
      v_steamid64,
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
    WHERE r.steamid64 = v_steamid64
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

-- =====================================================
-- Force refresh (ignores staleness check)
-- =====================================================
DROP PROCEDURE IF EXISTS force_refresh_player_statistics_batched$$
CREATE PROCEDURE force_refresh_player_statistics_batched(
  IN p_batch_size INT,
  IN p_max_batches INT
)
BEGIN
  DECLARE v_batch_count INT DEFAULT 0;
  DECLARE v_total_affected INT DEFAULT 0;
  DECLARE v_batch_affected INT;
  DECLARE v_offset INT DEFAULT 0;
  DECLARE v_total_players INT;
  
  IF p_batch_size IS NULL OR p_batch_size <= 0 THEN
    SET p_batch_size = 5000;
  END IF;
  
  IF p_max_batches IS NULL THEN
    SET p_max_batches = 0;
  END IF;
  
  -- Clean up banned player stats
  DELETE ps FROM kz_player_statistics ps
  INNER JOIN kz_players p ON ps.player_id = p.id
  WHERE p.is_banned = TRUE;
  COMMIT;
  
  -- Count total players to process
  SELECT COUNT(DISTINCT p.id) INTO v_total_players
  FROM kz_players p
  WHERE (p.is_banned IS NULL OR p.is_banned = FALSE)
    AND EXISTS (
      SELECT 1 FROM kz_records_partitioned r 
      WHERE r.steamid64 = p.steamid64
      LIMIT 1
    );
  
  -- Process all players in order by ID
  WHILE v_offset < v_total_players DO
    IF p_max_batches > 0 AND v_batch_count >= p_max_batches THEN
      SET v_offset = v_total_players; -- Exit loop
    ELSE
      DROP TEMPORARY TABLE IF EXISTS tmp_batch_players;
      CREATE TEMPORARY TABLE tmp_batch_players (
        player_id INT UNSIGNED PRIMARY KEY,
        steamid64 VARCHAR(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
        INDEX idx_steamid (steamid64)
      ) ENGINE=MEMORY DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      
      -- Select batch by offset (for force refresh, ignore staleness)
      INSERT INTO tmp_batch_players (player_id, steamid64)
      SELECT p.id, p.steamid64
      FROM kz_players p
      WHERE (p.is_banned IS NULL OR p.is_banned = FALSE)
        AND EXISTS (
          SELECT 1 FROM kz_records_partitioned r 
          WHERE r.steamid64 = p.steamid64
          LIMIT 1
        )
      ORDER BY p.id
      LIMIT p_batch_size OFFSET v_offset;
      
      SET v_batch_affected = ROW_COUNT();
      
      IF v_batch_affected > 0 THEN
        INSERT INTO kz_player_statistics (
          player_id, steamid64, total_records, total_maps, total_points,
          total_playtime, avg_teleports, world_records, pro_records, tp_records,
          best_time, first_record_date, last_record_date
        )
        SELECT 
          bp.player_id,
          bp.steamid64,
          COUNT(DISTINCT r.id),
          COUNT(DISTINCT r.map_id),
          COALESCE(SUM(r.points), 0),
          COALESCE(SUM(r.time), 0),
          COALESCE(AVG(r.teleports), 0),
          COALESCE(wrc.world_record_count, 0),
          SUM(CASE WHEN r.teleports = 0 THEN 1 ELSE 0 END),
          SUM(CASE WHEN r.teleports > 0 THEN 1 ELSE 0 END),
          MIN(r.time),
          MIN(r.created_on),
          MAX(r.created_on)
        FROM tmp_batch_players bp
        INNER JOIN kz_records_partitioned r ON bp.steamid64 = r.steamid64
        LEFT JOIN (
          SELECT player_id, COUNT(*) AS world_record_count
          FROM kz_worldrecords_cache
          GROUP BY player_id
        ) wrc ON wrc.player_id = bp.steamid64
        GROUP BY bp.player_id, bp.steamid64, wrc.world_record_count
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
        
        SET v_total_affected = v_total_affected + v_batch_affected;
        SET v_batch_count = v_batch_count + 1;
        SET v_offset = v_offset + p_batch_size;
        
        COMMIT;
        
        DROP TEMPORARY TABLE IF EXISTS tmp_batch_players;
      ELSE
        SET v_offset = v_total_players; -- Exit loop
      END IF;
    END IF;
  END WHILE;
  
  SELECT v_total_affected AS players_processed, v_batch_count AS batches;
END$$

-- Statistics events are now handled by Node.js kzStatistics service
-- See: src/services/kzStatistics.js

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
  
  -- KZ Timer World Records
  wr_kz_timer_pro_time DECIMAL(10,3) NULL,
  wr_kz_timer_pro_steamid64 VARCHAR(20) NULL,
  wr_kz_timer_pro_player_name VARCHAR(64) NULL,
  wr_kz_timer_pro_record_id INT UNSIGNED NULL,
  wr_kz_timer_overall_time DECIMAL(10,3) NULL,
  wr_kz_timer_overall_teleports INT UNSIGNED NULL,
  wr_kz_timer_overall_steamid64 VARCHAR(20) NULL,
  wr_kz_timer_overall_player_name VARCHAR(64) NULL,
  wr_kz_timer_overall_record_id INT UNSIGNED NULL,
  
  -- KZ Simple World Records
  wr_kz_simple_pro_time DECIMAL(10,3) NULL,
  wr_kz_simple_pro_steamid64 VARCHAR(20) NULL,
  wr_kz_simple_pro_player_name VARCHAR(64) NULL,
  wr_kz_simple_pro_record_id INT UNSIGNED NULL,
  wr_kz_simple_overall_time DECIMAL(10,3) NULL,
  wr_kz_simple_overall_teleports INT UNSIGNED NULL,
  wr_kz_simple_overall_steamid64 VARCHAR(20) NULL,
  wr_kz_simple_overall_player_name VARCHAR(64) NULL,
  wr_kz_simple_overall_record_id INT UNSIGNED NULL,
  
  -- KZ Vanilla World Records
  wr_kz_vanilla_pro_time DECIMAL(10,3) NULL,
  wr_kz_vanilla_pro_steamid64 VARCHAR(20) NULL,
  wr_kz_vanilla_pro_player_name VARCHAR(64) NULL,
  wr_kz_vanilla_pro_record_id INT UNSIGNED NULL,
  wr_kz_vanilla_overall_time DECIMAL(10,3) NULL,
  wr_kz_vanilla_overall_teleports INT UNSIGNED NULL,
  wr_kz_vanilla_overall_steamid64 VARCHAR(20) NULL,
  wr_kz_vanilla_overall_player_name VARCHAR(64) NULL,
  wr_kz_vanilla_overall_record_id INT UNSIGNED NULL,
  
  -- Legacy time statistics (deprecated, use mode-specific WRs)
  avg_time DECIMAL(10,3) NULL,
  median_time DECIMAL(10,3) NULL,
  
  -- First and last records
  first_record_date DATETIME NULL,
  last_record_date DATETIME NULL,
  
  -- Sync tracking
  world_records_synced_at TIMESTAMP NULL COMMENT 'Last time WRs were synced from KZTimer API',
  
  -- Timestamps
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  UNIQUE KEY unique_map (map_id),
  KEY idx_total_records (total_records DESC),
  KEY idx_unique_players (unique_players DESC),
  KEY idx_wr_kz_timer_pro (wr_kz_timer_pro_time),
  KEY idx_wr_kz_timer_overall (wr_kz_timer_overall_time),
  KEY idx_wr_kz_simple_pro (wr_kz_simple_pro_time),
  KEY idx_wr_kz_simple_overall (wr_kz_simple_overall_time),
  KEY idx_wr_kz_vanilla_pro (wr_kz_vanilla_pro_time),
  KEY idx_wr_kz_vanilla_overall (wr_kz_vanilla_overall_time),
  KEY idx_updated (updated_at),
  KEY idx_wr_synced (world_records_synced_at),
  
  FOREIGN KEY (map_id) REFERENCES kz_maps(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT = 'Pre-calculated statistics for maps with world records for all modes';

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

-- Procedure to batch refresh all map statistics (optimized bulk operation)
DROP PROCEDURE IF EXISTS refresh_all_map_statistics$$
CREATE PROCEDURE refresh_all_map_statistics()
BEGIN
  DECLARE v_affected_rows INT;
  
  -- Bulk update only maps with stale statistics (not updated in last day)
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
    m.id AS map_id,
    COUNT(DISTINCT r.id) AS total_records,
    COUNT(DISTINCT r.player_id) AS unique_players,
    COUNT(*) AS total_completions,
    SUM(CASE WHEN r.teleports = 0 THEN 1 ELSE 0 END) AS pro_records,
    SUM(CASE WHEN r.teleports > 0 THEN 1 ELSE 0 END) AS tp_records,
    MIN(r.time) AS world_record_time,
    AVG(r.time) AS avg_time,
    MIN(r.created_on) AS first_record_date,
    MAX(r.created_on) AS last_record_date
  FROM kz_maps m
  INNER JOIN kz_records_partitioned r ON m.id = r.map_id
  INNER JOIN kz_players p ON r.player_id = p.id
  WHERE (p.is_banned IS NULL OR p.is_banned = FALSE)
    AND NOT EXISTS (
      SELECT 1 FROM kz_map_statistics ms 
      WHERE ms.map_id = m.id 
      AND ms.updated_at > DATE_SUB(NOW(), INTERVAL 1 DAY)
    )
  GROUP BY m.id
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
  
  SET v_affected_rows = ROW_COUNT();
  SELECT CONCAT('Completed refreshing ', v_affected_rows, ' map statistics') AS result;
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

-- Player personal bests cache table
-- Caches player PBs per map for fast profile loading and map completion filtering
CREATE TABLE IF NOT EXISTS kz_player_map_pbs (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  player_id INT UNSIGNED NOT NULL,
  steamid64 VARCHAR(20) NOT NULL,
  map_id INT UNSIGNED NOT NULL,
  map_name VARCHAR(255) NOT NULL,
  
  -- PB details per mode
  mode VARCHAR(32) NOT NULL DEFAULT 'kz_timer',
  stage TINYINT UNSIGNED NOT NULL DEFAULT 0,
  
  -- Pro run (no teleports)
  pro_time DECIMAL(10,3) NULL,
  pro_teleports SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  pro_points INT NOT NULL DEFAULT 0,
  pro_record_id BIGINT UNSIGNED NULL,
  pro_created_on DATETIME NULL,
  
  -- TP run (with teleports)
  tp_time DECIMAL(10,3) NULL,
  tp_teleports SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  tp_points INT NOT NULL DEFAULT 0,
  tp_record_id BIGINT UNSIGNED NULL,
  tp_created_on DATETIME NULL,
  
  -- Map metadata for fast filtering
  map_difficulty TINYINT NULL,
  map_validated BOOLEAN NULL,
  
  -- Timestamps
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  -- Unique constraint: one row per player/map/mode/stage
  UNIQUE KEY unique_player_map_mode_stage (player_id, map_id, mode, stage),
  
  -- Indexes for common queries
  KEY idx_player_times (player_id, mode, stage, pro_time),
  KEY idx_steamid64 (steamid64),
  KEY idx_map_id (map_id),
  KEY idx_map_name (map_name(50)),
  KEY idx_map_difficulty (map_difficulty),
  KEY idx_updated (updated_at),
  KEY idx_player_completed (player_id, mode, stage, pro_time, tp_time),
  KEY idx_player_completion_status (player_id, mode, stage, map_difficulty, pro_time, tp_time),
  
  -- Foreign keys
  FOREIGN KEY (player_id) REFERENCES kz_players(id) ON DELETE CASCADE,
  FOREIGN KEY (map_id) REFERENCES kz_maps(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT = 'Cached player personal bests per map for fast profile and completion queries';

DELIMITER $$

-- Procedure to refresh PBs for a specific player
DROP PROCEDURE IF EXISTS refresh_player_pbs$$
CREATE PROCEDURE refresh_player_pbs(IN p_player_id INT UNSIGNED)
BEGIN
  DECLARE v_steamid64 VARCHAR(20);
  
  -- Get player's steamid64
  SELECT steamid64 INTO v_steamid64 FROM kz_players WHERE id = p_player_id;
  
  IF v_steamid64 IS NOT NULL THEN
    -- Delete existing PBs for this player
    DELETE FROM kz_player_map_pbs WHERE player_id = p_player_id;
    
    -- Insert new PBs (one row per map/mode/stage with both pro and tp times)
    INSERT INTO kz_player_map_pbs (
      player_id, steamid64, map_id, map_name, mode, stage,
      pro_time, pro_teleports, pro_points, pro_record_id, pro_created_on,
      tp_time, tp_teleports, tp_points, tp_record_id, tp_created_on,
      map_difficulty, map_validated
    )
    SELECT 
      p_player_id,
      v_steamid64,
      r.map_id,
      m.map_name,
      r.mode,
      r.stage,
      -- Pro run (teleports = 0)
      pro.time as pro_time,
      0 as pro_teleports,
      pro.points as pro_points,
      pro.id as pro_record_id,
      pro.created_on as pro_created_on,
      -- TP run (teleports > 0)
      tp.time as tp_time,
      tp.teleports as tp_teleports,
      tp.points as tp_points,
      tp.id as tp_record_id,
      tp.created_on as tp_created_on,
      -- Map metadata
      m.difficulty as map_difficulty,
      m.validated as map_validated
    FROM (
      -- Get unique map/mode/stage combinations for this player
      SELECT DISTINCT map_id, mode, stage
      FROM kz_records_partitioned
      WHERE player_id = p_player_id
    ) r
    INNER JOIN kz_maps m ON r.map_id = m.id
    LEFT JOIN (
      -- Best pro time per map/mode/stage
      SELECT 
        r1.map_id, r1.mode, r1.stage, 
        r1.time, r1.points, r1.id, r1.created_on
      FROM kz_records_partitioned r1
      INNER JOIN (
        SELECT map_id, mode, stage, MIN(time) as min_time
        FROM kz_records_partitioned
        WHERE player_id = p_player_id AND teleports = 0
        GROUP BY map_id, mode, stage
      ) best ON r1.map_id = best.map_id 
            AND r1.mode = best.mode 
            AND r1.stage = best.stage 
            AND r1.time = best.min_time
      WHERE r1.player_id = p_player_id AND r1.teleports = 0
      GROUP BY r1.map_id, r1.mode, r1.stage
    ) pro ON r.map_id = pro.map_id AND r.mode = pro.mode AND r.stage = pro.stage
    LEFT JOIN (
      -- Best TP time per map/mode/stage
      SELECT 
        r2.map_id, r2.mode, r2.stage, 
        r2.time, r2.teleports, r2.points, r2.id, r2.created_on
      FROM kz_records_partitioned r2
      INNER JOIN (
        SELECT map_id, mode, stage, MIN(time) as min_time
        FROM kz_records_partitioned
        WHERE player_id = p_player_id AND teleports > 0
        GROUP BY map_id, mode, stage
      ) best ON r2.map_id = best.map_id 
            AND r2.mode = best.mode 
            AND r2.stage = best.stage 
            AND r2.time = best.min_time
      WHERE r2.player_id = p_player_id AND r2.teleports > 0
      GROUP BY r2.map_id, r2.mode, r2.stage
    ) tp ON r.map_id = tp.map_id AND r.mode = tp.mode AND r.stage = tp.stage
    WHERE pro.time IS NOT NULL OR tp.time IS NOT NULL;
    
    -- Update player sync timestamp
    UPDATE kz_players SET pbs_synced_at = NOW() WHERE id = p_player_id;
  END IF;
END$$

DELIMITER ;

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

-- Procedure to batch refresh all server statistics (optimized bulk operation)
DROP PROCEDURE IF EXISTS refresh_all_server_statistics$$
CREATE PROCEDURE refresh_all_server_statistics()
BEGIN
  DECLARE v_affected_rows INT;
  
  -- Bulk update only servers with stale statistics (not updated in last day)
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
    s.id AS server_id,
    COUNT(DISTINCT r.id) AS total_records,
    COUNT(DISTINCT r.player_id) AS unique_players,
    COUNT(DISTINCT r.map_id) AS unique_maps,
    SUM(CASE WHEN r.teleports = 0 THEN 1 ELSE 0 END) AS pro_records,
    SUM(CASE WHEN r.teleports > 0 THEN 1 ELSE 0 END) AS tp_records,
    MIN(r.created_on) AS first_record_date,
    MAX(r.created_on) AS last_record_date,
    CASE 
      WHEN DATEDIFF(MAX(r.created_on), MIN(r.created_on)) > 0 
      THEN COUNT(*) / DATEDIFF(MAX(r.created_on), MIN(r.created_on)) 
      ELSE COUNT(*) 
    END AS avg_records_per_day,
    COALESCE(wrc.world_records_count, 0) AS world_records_hosted
  FROM kz_servers s
  INNER JOIN kz_records_partitioned r ON s.id = r.server_id
  INNER JOIN kz_players p ON r.player_id = p.id
  LEFT JOIN (
    -- Pre-aggregate world records count per server
    SELECT server_id, COUNT(*) AS world_records_count
    FROM kz_worldrecords_cache
    GROUP BY server_id
  ) wrc ON wrc.server_id = s.id
  WHERE (p.is_banned IS NULL OR p.is_banned = FALSE)
    AND NOT EXISTS (
      SELECT 1 FROM kz_server_statistics ss 
      WHERE ss.server_id = s.id 
      AND ss.updated_at > DATE_SUB(NOW(), INTERVAL 1 DAY)
    )
  GROUP BY s.id, wrc.world_records_count
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
  
  SET v_affected_rows = ROW_COUNT();
  SELECT CONCAT('Completed refreshing ', v_affected_rows, ' server statistics') AS result;
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
