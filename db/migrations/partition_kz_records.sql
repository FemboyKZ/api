-- Create table with yearly partitions
CREATE TABLE IF NOT EXISTS kz_records_partitioned (
  id BIGINT UNSIGNED AUTO_INCREMENT,
  original_id BIGINT UNSIGNED NULL,
  
  -- Store IDs without foreign keys
  player_id INT UNSIGNED NOT NULL,
  steamid64 VARCHAR(20) NULL,
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
  KEY idx_player_steamid64 (steamid64),
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

-- Procedure to maintain yearly partitions
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

-- Procedure to analyze partition distribution by year
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

-- Improved migration procedure with better error handling
DROP PROCEDURE IF EXISTS migrate_to_yearly_partitions$$
CREATE PROCEDURE migrate_to_yearly_partitions()
BEGIN
  DECLARE v_batch_size INT DEFAULT 100000;
  DECLARE v_last_id BIGINT DEFAULT 0;
  DECLARE v_max_id BIGINT;
  DECLARE v_min_id BIGINT;
  DECLARE v_rows_copied BIGINT DEFAULT 0;
  DECLARE v_total_rows BIGINT DEFAULT 0;
  DECLARE v_start_time DATETIME;
  DECLARE v_batch_num INT DEFAULT 0;
  DECLARE v_error_count INT DEFAULT 0;
  DECLARE v_continue BOOLEAN DEFAULT TRUE;
  
  -- Error handling
  DECLARE CONTINUE HANDLER FOR SQLEXCEPTION
  BEGIN
    SET v_error_count = v_error_count + 1;
    IF v_error_count > 5 THEN
      SET v_continue = FALSE;
    END IF;
  END;
  
  SET v_start_time = NOW();
  
  -- Get ID range
  SELECT MIN(id), MAX(id), COUNT(*) 
  INTO v_min_id, v_max_id, v_total_rows 
  FROM kz_records;
  
  SET v_last_id = COALESCE(v_min_id - 1, 0);
  
  SELECT CONCAT('Starting migration of ', FORMAT(v_total_rows, 0), ' records') AS status;
  SELECT CONCAT('ID range: ', v_min_id, ' to ', v_max_id) AS info;
  
  -- Disable keys for faster insertion
  ALTER TABLE kz_records_partitioned DISABLE KEYS;
  
  migration_loop: WHILE v_last_id < v_max_id AND v_continue DO
    SET v_batch_num = v_batch_num + 1;
    
    -- Copy batch
    INSERT IGNORE INTO kz_records_partitioned (
      id, original_id, player_id, steamid64, map_id, server_id,
      mode, stage, time, teleports, points, tickrate,
      record_filter_id, replay_id, updated_by,
      created_on, updated_on, inserted_at
    )
    SELECT 
      id, original_id, player_id, steamid64, map_id, server_id,
      mode, stage, time, teleports, points, tickrate,
      record_filter_id, replay_id, updated_by,
      CONVERT(created_on, DATETIME),
      CONVERT(updated_on, DATETIME),
      inserted_at
    FROM kz_records 
    WHERE id > v_last_id 
    ORDER BY id 
    LIMIT v_batch_size;
    
    SET v_rows_copied = v_rows_copied + ROW_COUNT();
    
    -- Update last_id
    SELECT COALESCE(MAX(id), v_last_id) INTO v_last_id 
    FROM (
      SELECT id FROM kz_records 
      WHERE id > v_last_id 
      ORDER BY id 
      LIMIT v_batch_size
    ) t;
    
    -- Progress report every 10 batches
    IF v_batch_num MOD 10 = 0 THEN
      SELECT CONCAT(
        'Progress: ', FORMAT(v_rows_copied, 0), ' / ', FORMAT(v_total_rows, 0), 
        ' (', ROUND(v_rows_copied * 100.0 / v_total_rows, 2), '%) - ',
        'Time: ', TIMESTAMPDIFF(MINUTE, v_start_time, NOW()), ' min - ',
        'Rate: ', ROUND(v_rows_copied / TIMESTAMPDIFF(SECOND, v_start_time, NOW())), ' rows/sec'
      ) AS status;
      
      -- Commit to free up transaction log
      COMMIT;
    END IF;
    
    -- Prevent runaway loop
    IF v_batch_num > 10000 THEN
      SET v_continue = FALSE;
      SELECT 'Safety limit reached - stopping migration' AS warning;
    END IF;
    
  END WHILE migration_loop;
  
  -- Final commit
  COMMIT;
  
  -- Re-enable keys
  SELECT 'Re-enabling keys (this may take several minutes)...' AS status;
  ALTER TABLE kz_records_partitioned ENABLE KEYS;
  
  -- Final statistics
  SELECT 
    CONCAT('Migration complete in ', TIMESTAMPDIFF(MINUTE, v_start_time, NOW()), ' minutes') AS status,
    FORMAT(v_rows_copied, 0) AS rows_copied,
    FORMAT(v_total_rows, 0) AS original_rows,
    v_error_count AS errors_encountered;
  
  -- Verify partition distribution
  CALL analyze_yearly_partitions();
END$$

-- Scheduled event to maintain partitions automatically (runs monthly)
DROP EVENT IF EXISTS maintain_partitions_event$$
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

-- Create a log table for partition maintenance
CREATE TABLE IF NOT EXISTS partition_maintenance_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  executed_at DATETIME NOT NULL,
  status VARCHAR(255),
  INDEX idx_executed (executed_at DESC)
) ENGINE=InnoDB;

-- Helper view to see records per year
CREATE OR REPLACE VIEW kz_records_by_year AS
SELECT 
  YEAR(created_on) as year,
  COUNT(*) as record_count,
  COUNT(DISTINCT player_id) as unique_players,
  COUNT(DISTINCT map_id) as unique_maps,
  MIN(created_on) as first_record,
  MAX(created_on) as last_record
FROM kz_records_partitioned
GROUP BY YEAR(created_on)
ORDER BY year DESC;

-- Run initial partition maintenance to ensure future years exist
CALL maintain_yearly_partitions();

-- Analyze initial partition setup
CALL analyze_yearly_partitions();
