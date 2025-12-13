-- Migration: Add player personal bests cache table
-- This table caches player PBs per map for fast profile loading and map completion filtering

-- Player personal bests table - caches best time per player/map/mode/stage combination
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
  
  -- Foreign keys
  FOREIGN KEY (player_id) REFERENCES kz_players(id) ON DELETE CASCADE,
  FOREIGN KEY (map_id) REFERENCES kz_maps(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT = 'Cached player personal bests per map for fast profile and completion queries';

-- Add index for player completion status queries
CREATE INDEX IF NOT EXISTS idx_player_completion_status 
ON kz_player_map_pbs(player_id, mode, stage, map_difficulty, pro_time, tp_time);

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
  END IF;
END$$

-- Procedure to refresh PBs for all players in batches
DROP PROCEDURE IF EXISTS refresh_all_player_pbs_batched$$
CREATE PROCEDURE refresh_all_player_pbs_batched(
  IN p_batch_size INT,
  IN p_max_batches INT
)
BEGIN
  DECLARE v_batch_count INT DEFAULT 0;
  DECLARE v_last_id INT DEFAULT 0;
  DECLARE v_more_rows INT DEFAULT 1;
  DECLARE v_processed INT DEFAULT 0;
  
  IF p_batch_size IS NULL OR p_batch_size <= 0 THEN
    SET p_batch_size = 100;
  END IF;
  
  IF p_max_batches IS NULL THEN
    SET p_max_batches = 0;
  END IF;
  
  WHILE v_more_rows = 1 DO
    IF p_max_batches > 0 AND v_batch_count >= p_max_batches THEN
      SET v_more_rows = 0;
    ELSE
      -- Get batch of player IDs that have records
      DROP TEMPORARY TABLE IF EXISTS tmp_batch_players;
      CREATE TEMPORARY TABLE tmp_batch_players AS
      SELECT DISTINCT p.id as player_id
      FROM kz_players p
      INNER JOIN kz_records_partitioned r ON p.id = r.player_id
      WHERE p.id > v_last_id
        AND (p.is_banned IS NULL OR p.is_banned = FALSE)
      ORDER BY p.id
      LIMIT p_batch_size;
      
      SELECT COUNT(*) INTO @batch_count FROM tmp_batch_players;
      
      IF @batch_count = 0 THEN
        SET v_more_rows = 0;
      ELSE
        -- Process each player in batch
        BEGIN
          DECLARE done INT DEFAULT FALSE;
          DECLARE cur_player_id INT;
          DECLARE player_cursor CURSOR FOR SELECT player_id FROM tmp_batch_players;
          DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;
          
          OPEN player_cursor;
          
          player_loop: LOOP
            FETCH player_cursor INTO cur_player_id;
            IF done THEN
              LEAVE player_loop;
            END IF;
            
            CALL refresh_player_pbs(cur_player_id);
            SET v_last_id = cur_player_id;
            SET v_processed = v_processed + 1;
          END LOOP;
          
          CLOSE player_cursor;
        END;
        
        SET v_batch_count = v_batch_count + 1;
        COMMIT;
      END IF;
      
      DROP TEMPORARY TABLE IF EXISTS tmp_batch_players;
    END IF;
  END WHILE;
  
  SELECT CONCAT('Processed ', v_processed, ' players in ', v_batch_count, ' batches') AS result;
END$$

DELIMITER ;
