-- Migration: Fix refresh_all_map_statistics procedure
-- Issue: Old version of refresh_all_map_statistics calls refresh_map_statistics(map_id)
-- but refresh_map_statistics was changed to take 0 arguments in add_wr_holder migration
-- Solution: Redefine refresh_all_map_statistics to be self-contained (no internal procedure calls)
-- Note: Uses only columns that exist in current schema (no world_record_time, uses mode-specific WRs)

DELIMITER $$

-- Recreate refresh_all_map_statistics as a self-contained procedure
-- This version does NOT call refresh_map_statistics internally
-- Only updates basic statistics - WRs are synced separately by wrSync.js
DROP PROCEDURE IF EXISTS refresh_all_map_statistics$$
CREATE PROCEDURE refresh_all_map_statistics()
BEGIN
  DECLARE v_affected_rows INT;
  
  -- Bulk update only maps with stale statistics (not updated in last day)
  -- This is self-contained and does not call refresh_map_statistics
  -- Note: WR columns (wr_kz_timer_*, etc.) are updated separately by wrSync service
  INSERT INTO kz_map_statistics (
    map_id,
    total_records,
    unique_players,
    total_completions,
    pro_records,
    tp_records,
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
    avg_time = VALUES(avg_time),
    first_record_date = VALUES(first_record_date),
    last_record_date = VALUES(last_record_date),
    updated_at = CURRENT_TIMESTAMP;
  
  SET v_affected_rows = ROW_COUNT();
  SELECT CONCAT('Completed refreshing ', v_affected_rows, ' map statistics') AS result;
END$$

-- Also ensure refresh_map_statistics takes a map_id parameter again
-- for any code that might want to refresh a single map
DROP PROCEDURE IF EXISTS refresh_map_statistics$$
CREATE PROCEDURE refresh_map_statistics(IN p_map_id INT)
BEGIN
  -- Update or insert statistics for a single map
  -- Note: WR columns are updated separately by wrSync service
  INSERT INTO kz_map_statistics (
    map_id,
    total_records,
    unique_players,
    total_completions,
    pro_records,
    tp_records,
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
    avg_time = VALUES(avg_time),
    first_record_date = VALUES(first_record_date),
    last_record_date = VALUES(last_record_date),
    updated_at = CURRENT_TIMESTAMP;
END$$

DELIMITER ;
