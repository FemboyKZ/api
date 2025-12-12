-- Migration: Optimize player statistics refresh procedures v2
-- Problem: Single bulk query times out on 3.5M+ players
-- Solution: Batched processing with commits between batches
--
-- Run with extended timeout:
--   mysql -u root -p --connect-timeout=3600 --net-read-timeout=3600 --net-write-timeout=3600 fkz_kz_records < optimize_player_statistics_v2.sql
--
-- Or set session timeout before running:
--   SET SESSION innodb_lock_wait_timeout = 3600;
--   SET SESSION wait_timeout = 28800;
--   SET SESSION net_read_timeout = 3600;

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
  
  SELECT CONCAT('Deleted stats for ', ROW_COUNT(), ' banned players') AS status;
  COMMIT;
  
  -- Process in batches until no more stale players
  WHILE v_more_rows = 1 DO
    -- Check batch limit
    IF p_max_batches > 0 AND v_batch_count >= p_max_batches THEN
      SELECT CONCAT('Reached max batch limit: ', p_max_batches) AS status;
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
        SELECT 'No more stale players to process' AS status;
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
        
        SELECT CONCAT('Batch ', v_batch_count, ': processed ', v_batch_affected, ' players (total: ', v_total_affected, ')') AS progress;
        
        -- Clean up temp table
        DROP TEMPORARY TABLE IF EXISTS tmp_batch_players;
      END IF;
    END IF;
  END WHILE;
  
  SELECT CONCAT('Complete! Processed ', v_total_affected, ' players in ', v_batch_count, ' batches') AS result;
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
  
  SELECT CONCAT('Total players to process: ', v_total_players) AS status;
  
  -- Process all players in order by ID
  WHILE v_offset < v_total_players DO
    IF p_max_batches > 0 AND v_batch_count >= p_max_batches THEN
      SELECT CONCAT('Reached max batch limit: ', p_max_batches) AS status;
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
        
        SELECT CONCAT('Batch ', v_batch_count, ': ', v_total_affected, '/', v_total_players, ' (', 
          ROUND(v_total_affected * 100 / v_total_players, 1), '%)') AS progress;
        
        DROP TEMPORARY TABLE IF EXISTS tmp_batch_players;
      ELSE
        SET v_offset = v_total_players; -- Exit loop
      END IF;
    END IF;
  END WHILE;
  
  SELECT CONCAT('Force refresh complete! Processed ', v_total_affected, ' players in ', v_batch_count, ' batches') AS result;
END$$

DELIMITER ;

-- =====================================================
-- Usage:
-- =====================================================
-- 
-- First, set a longer lock timeout for this session:
-- SET SESSION innodb_lock_wait_timeout = 600;
--
-- Then run incremental refresh (only stale stats):
-- CALL refresh_all_player_statistics();
--
-- Or with custom batch size (2000 per batch):
-- CALL refresh_player_statistics_batched(2000, 0);
--
-- Or force refresh everything (ignores staleness):
-- CALL force_refresh_player_statistics_batched(5000, 0);
--
-- Or process limited batches (e.g., 100 batches of 5000 = 500k players):
-- CALL refresh_player_statistics_batched(5000, 100);
