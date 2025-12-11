-- Migration: Exclude banned players from all statistics and WR cache
-- Date: 2024-12-11
-- Description: Updates stored procedures to exclude banned players from:
--   - kz_player_statistics (don't calculate stats for banned players)
--   - kz_server_statistics (don't count banned player records)
--   - kz_worldrecords_cache (already done, just ensuring consistency)

DELIMITER $$

-- ============================================================================
-- PLAYER STATISTICS - Exclude banned players from statistics
-- ============================================================================

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

  -- Update world records count (WR cache already excludes banned players)
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
    -- Update or insert statistics for non-banned players
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

-- ============================================================================
-- SERVER STATISTICS - Exclude banned player records from server stats
-- ============================================================================

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
    -- Insert batch of server statistics (excluding banned player records)
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

-- ============================================================================
-- WORLD RECORDS CACHE - Improved banned player exclusion
-- ============================================================================

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

-- ============================================================================
-- Clean up existing data from banned players
-- ============================================================================

-- Remove statistics for currently banned players
DELETE ps FROM kz_player_statistics ps
INNER JOIN kz_players p ON ps.player_id = p.id
WHERE p.is_banned = TRUE;

-- Force refresh of map and server statistics (they need recalculating without banned records)
-- Reset updated_at to force refresh on next cycle
UPDATE kz_map_statistics SET updated_at = DATE_SUB(NOW(), INTERVAL 2 DAY);
UPDATE kz_server_statistics SET updated_at = DATE_SUB(NOW(), INTERVAL 2 DAY);

-- Refresh worldrecords cache to ensure banned players are excluded
CALL refresh_worldrecords_cache();

SELECT 'Migration complete. Statistics procedures updated to exclude banned players.' AS result;
SELECT 'Run CALL refresh_all_player_statistics(); CALL refresh_all_map_statistics(); CALL refresh_all_server_statistics(); to rebuild all stats.' AS next_steps;
