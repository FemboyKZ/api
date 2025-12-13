-- Migration: Add world record holder info to kz_map_statistics
-- This allows us to return WR holder info without needing to hit external APIs

-- Add columns for world record holder
ALTER TABLE kz_map_statistics
ADD COLUMN IF NOT EXISTS world_record_steamid64 VARCHAR(20) NULL AFTER world_record_time,
ADD COLUMN IF NOT EXISTS world_record_player_name VARCHAR(64) NULL AFTER world_record_steamid64,
ADD COLUMN IF NOT EXISTS world_record_id INT UNSIGNED NULL AFTER world_record_player_name,
ADD COLUMN IF NOT EXISTS world_records_synced_at TIMESTAMP NULL AFTER last_record_date;

-- Add index for sync timestamp
CREATE INDEX IF NOT EXISTS idx_wr_synced ON kz_map_statistics(world_records_synced_at);

-- Update procedure to populate world record holder info
DROP PROCEDURE IF EXISTS refresh_map_statistics;

DELIMITER $$

CREATE PROCEDURE refresh_map_statistics()
BEGIN
  -- Refresh all map statistics with world record holder info
  INSERT INTO kz_map_statistics (
    map_id,
    total_records,
    unique_players,
    total_completions,
    pro_records,
    tp_records,
    world_record_time,
    world_record_steamid64,
    world_record_player_name,
    world_record_id,
    avg_time,
    first_record_date,
    last_record_date
  )
  SELECT 
    r.map_id,
    COUNT(*) as total_records,
    COUNT(DISTINCT r.player_id) as unique_players,
    COUNT(*) as total_completions,
    SUM(CASE WHEN r.teleports = 0 THEN 1 ELSE 0 END) as pro_records,
    SUM(CASE WHEN r.teleports > 0 THEN 1 ELSE 0 END) as tp_records,
    wr.time as world_record_time,
    wr.steamid64 as world_record_steamid64,
    wr.player_name as world_record_player_name,
    wr.id as world_record_id,
    AVG(r.time) as avg_time,
    MIN(r.created_on) as first_record_date,
    MAX(r.created_on) as last_record_date
  FROM kz_records_partitioned r
  LEFT JOIN (
    -- Get world record for each map (KZT mode, stage 0, pro)
    SELECT 
      r2.map_id,
      r2.time,
      p.steamid64,
      p.player_name,
      r2.id
    FROM kz_records_partitioned r2
    INNER JOIN kz_players p ON r2.player_id = p.id
    WHERE r2.mode = 'kz_timer'
      AND r2.stage = 0
      AND r2.teleports = 0
      AND (p.is_banned IS NULL OR p.is_banned = FALSE)
      AND r2.time = (
        SELECT MIN(r3.time)
        FROM kz_records_partitioned r3
        INNER JOIN kz_players p2 ON r3.player_id = p2.id
        WHERE r3.map_id = r2.map_id
          AND r3.mode = 'kz_timer'
          AND r3.stage = 0
          AND r3.teleports = 0
          AND (p2.is_banned IS NULL OR p2.is_banned = FALSE)
      )
    GROUP BY r2.map_id
  ) wr ON r.map_id = wr.map_id
  GROUP BY r.map_id
  ON DUPLICATE KEY UPDATE
    total_records = VALUES(total_records),
    unique_players = VALUES(unique_players),
    total_completions = VALUES(total_completions),
    pro_records = VALUES(pro_records),
    tp_records = VALUES(tp_records),
    world_record_time = VALUES(world_record_time),
    world_record_steamid64 = VALUES(world_record_steamid64),
    world_record_player_name = VALUES(world_record_player_name),
    world_record_id = VALUES(world_record_id),
    avg_time = VALUES(avg_time),
    first_record_date = VALUES(first_record_date),
    last_record_date = VALUES(last_record_date),
    updated_at = CURRENT_TIMESTAMP;
END$$

DELIMITER ;
