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

-- Procedure to refresh player statistics
DELIMITER $$

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

-- Show that procedures are created
SELECT 'Player statistics table and procedures created successfully!' AS status;
SELECT 'To populate the statistics table, run: CALL populate_player_statistics();' AS next_step;
