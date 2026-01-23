-- Migration: Add table for storing banned players' records
-- This table stores records from permanently banned players
-- Records are moved here when a permanent ban is detected

-- Charset and collation settings
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SET collation_connection = 'utf8mb4_unicode_ci';

-------------------------------------------------------------------
-- Banned Records Archive Table
-- Structure mirrors kz_records_partitioned for easy data migration
-- Records here are excluded from leaderboards but preserved for auditing
-------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS kz_banned_records (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  original_record_id BIGINT UNSIGNED NULL COMMENT 'Original ID from kz_records_partitioned',
  original_id BIGINT UNSIGNED NULL COMMENT 'Original ID from source API data',
  
  -- Player info (stored directly since player may be deleted)
  player_id INT UNSIGNED NOT NULL,
  steamid64 VARCHAR(20) NOT NULL,
  
  -- Map and server info
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
  
  -- Original timestamps from the record
  record_created_on DATETIME NOT NULL COMMENT 'When the record was originally created',
  record_updated_on DATETIME NOT NULL COMMENT 'When the record was last updated',
  
  -- Archive metadata
  ban_id INT NULL COMMENT 'Reference to the ban that caused this archive',
  archived_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT 'When the record was archived',
  archived_reason VARCHAR(100) DEFAULT 'permanent_ban' COMMENT 'Reason for archiving',
  
  -- Indexes for querying archived records
  INDEX idx_steamid64 (steamid64),
  INDEX idx_player_id (player_id),
  INDEX idx_map_id (map_id),
  INDEX idx_archived_at (archived_at DESC),
  INDEX idx_ban_id (ban_id),
  INDEX idx_original_record_id (original_record_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-------------------------------------------------------------------
-- Stored Procedure: Archive records for a banned player
-- Moves records from kz_records_partitioned to kz_banned_records
-- Only for permanent bans (expires_on IS NULL)
-------------------------------------------------------------------

DELIMITER $$

DROP PROCEDURE IF EXISTS archive_banned_player_records$$
CREATE PROCEDURE archive_banned_player_records(
  IN p_steamid64 VARCHAR(20),
  IN p_ban_id INT
)
BEGIN
  DECLARE v_records_archived INT DEFAULT 0;
  DECLARE v_already_archived INT DEFAULT 0;
  
  -- Check how many records are already archived for this player
  SELECT COUNT(*) INTO v_already_archived
  FROM kz_banned_records
  WHERE steamid64 = p_steamid64;
  
  -- Only archive if there are records to archive
  IF v_already_archived = 0 THEN
    -- Insert records into archive table
    INSERT INTO kz_banned_records (
      original_record_id,
      original_id,
      player_id,
      steamid64,
      map_id,
      server_id,
      mode,
      stage,
      time,
      teleports,
      points,
      tickrate,
      record_filter_id,
      replay_id,
      updated_by,
      record_created_on,
      record_updated_on,
      ban_id,
      archived_reason
    )
    SELECT 
      r.id,
      r.original_id,
      r.player_id,
      r.steamid64,
      r.map_id,
      r.server_id,
      r.mode,
      r.stage,
      r.time,
      r.teleports,
      r.points,
      r.tickrate,
      r.record_filter_id,
      r.replay_id,
      r.updated_by,
      r.created_on,
      r.updated_on,
      p_ban_id,
      'permanent_ban'
    FROM kz_records_partitioned r
    WHERE r.steamid64 = p_steamid64;
    
    SET v_records_archived = ROW_COUNT();
    
    -- Delete records from main table
    IF v_records_archived > 0 THEN
      DELETE FROM kz_records_partitioned
      WHERE steamid64 = p_steamid64;
      
      -- Also delete from non-partitioned table if it exists
      DELETE FROM kz_records
      WHERE steamid64 = p_steamid64;
    END IF;
  END IF;
  
  SELECT v_records_archived AS records_archived, v_already_archived AS already_archived;
END$$

-------------------------------------------------------------------
-- Stored Procedure: Restore records for an unbanned player
-- Moves records back from kz_banned_records to kz_records_partitioned
-- Used when a permanent ban is lifted
-------------------------------------------------------------------

DROP PROCEDURE IF EXISTS restore_unbanned_player_records$$
CREATE PROCEDURE restore_unbanned_player_records(
  IN p_steamid64 VARCHAR(20)
)
BEGIN
  DECLARE v_records_restored INT DEFAULT 0;
  
  -- Insert archived records back into main table
  INSERT INTO kz_records_partitioned (
    original_id,
    player_id,
    steamid64,
    map_id,
    server_id,
    mode,
    stage,
    time,
    teleports,
    points,
    tickrate,
    record_filter_id,
    replay_id,
    updated_by,
    created_on,
    updated_on
  )
  SELECT 
    original_id,
    player_id,
    steamid64,
    map_id,
    server_id,
    mode,
    stage,
    time,
    teleports,
    points,
    tickrate,
    record_filter_id,
    replay_id,
    updated_by,
    record_created_on,
    record_updated_on
  FROM kz_banned_records
  WHERE steamid64 = p_steamid64;
  
  SET v_records_restored = ROW_COUNT();
  
  -- Delete from archive table
  IF v_records_restored > 0 THEN
    DELETE FROM kz_banned_records
    WHERE steamid64 = p_steamid64;
  END IF;
  
  SELECT v_records_restored AS records_restored;
END$$

-------------------------------------------------------------------
-- Stored Procedure: Batch archive records for multiple banned players
-- More efficient for processing many bans at once
-------------------------------------------------------------------

DROP PROCEDURE IF EXISTS batch_archive_banned_records$$
CREATE PROCEDURE batch_archive_banned_records()
BEGIN
  DECLARE v_total_archived INT DEFAULT 0;
  DECLARE v_players_processed INT DEFAULT 0;
  
  -- Create temp table with permanently banned players who have records
  DROP TEMPORARY TABLE IF EXISTS tmp_to_archive;
  CREATE TEMPORARY TABLE tmp_to_archive AS
  SELECT DISTINCT 
    p.steamid64,
    b.id AS ban_id
  FROM kz_players p
  INNER JOIN kz_bans b ON p.steamid64 = b.steamid64
  WHERE p.is_banned = TRUE
    AND b.expires_on = '9999-12-31 23:59:59'  -- Only permanent bans
    AND NOT EXISTS (
      SELECT 1 FROM kz_banned_records br 
      WHERE br.steamid64 = p.steamid64
      LIMIT 1
    )
    AND EXISTS (
      SELECT 1 FROM kz_records_partitioned r 
      WHERE r.steamid64 = p.steamid64
      LIMIT 1
    );
  
  SELECT COUNT(*) INTO v_players_processed FROM tmp_to_archive;
  
  IF v_players_processed > 0 THEN
    -- Archive all records for these players
    INSERT INTO kz_banned_records (
      original_record_id,
      original_id,
      player_id,
      steamid64,
      map_id,
      server_id,
      mode,
      stage,
      time,
      teleports,
      points,
      tickrate,
      record_filter_id,
      replay_id,
      updated_by,
      record_created_on,
      record_updated_on,
      ban_id,
      archived_reason
    )
    SELECT 
      r.id,
      r.original_id,
      r.player_id,
      r.steamid64,
      r.map_id,
      r.server_id,
      r.mode,
      r.stage,
      r.time,
      r.teleports,
      r.points,
      r.tickrate,
      r.record_filter_id,
      r.replay_id,
      r.updated_by,
      r.created_on,
      r.updated_on,
      ta.ban_id,
      'permanent_ban'
    FROM kz_records_partitioned r
    INNER JOIN tmp_to_archive ta ON r.steamid64 = ta.steamid64;
    
    SET v_total_archived = ROW_COUNT();
    
    -- Delete archived records from main table
    DELETE r FROM kz_records_partitioned r
    INNER JOIN tmp_to_archive ta ON r.steamid64 = ta.steamid64;
    
    -- Also delete from non-partitioned table
    DELETE r FROM kz_records r
    INNER JOIN tmp_to_archive ta ON r.steamid64 = ta.steamid64;
  END IF;
  
  DROP TEMPORARY TABLE IF EXISTS tmp_to_archive;
  
  SELECT v_total_archived AS records_archived, v_players_processed AS players_processed;
END$$

DELIMITER ;

-------------------------------------------------------------------
-- View: Statistics for banned records archive
-------------------------------------------------------------------

CREATE OR REPLACE VIEW v_banned_records_stats AS
SELECT 
  COUNT(*) AS total_records,
  COUNT(DISTINCT steamid64) AS unique_players,
  COUNT(DISTINCT map_id) AS unique_maps,
  MIN(archived_at) AS first_archive,
  MAX(archived_at) AS last_archive
FROM kz_banned_records;
