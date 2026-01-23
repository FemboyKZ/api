-- Migration: Fix collation mismatch in banned records stored procedures
-- Issue: Stored procedure parameters defaulting to server collation (utf8mb4_uca1400_ai_ci)
-- while table columns use utf8mb4_unicode_ci
-- Solution: Use COLLATE in comparisons to ensure consistent collation

DELIMITER $$

-------------------------------------------------------------------
-- Recreate: archive_banned_player_records with collation fix
-------------------------------------------------------------------

DROP PROCEDURE IF EXISTS archive_banned_player_records$$
CREATE PROCEDURE archive_banned_player_records(
  IN p_steamid64 VARCHAR(20) CHARSET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_ban_id INT
)
BEGIN
  DECLARE v_records_archived INT DEFAULT 0;
  DECLARE v_already_archived INT DEFAULT 0;
  
  -- Check how many records are already archived for this player
  SELECT COUNT(*) INTO v_already_archived
  FROM kz_banned_records
  WHERE steamid64 = p_steamid64 COLLATE utf8mb4_unicode_ci;
  
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
    WHERE r.steamid64 = p_steamid64 COLLATE utf8mb4_unicode_ci;
    
    SET v_records_archived = ROW_COUNT();
    
    -- Delete records from main table
    IF v_records_archived > 0 THEN
      DELETE FROM kz_records_partitioned
      WHERE steamid64 = p_steamid64 COLLATE utf8mb4_unicode_ci;
      
      -- Also delete from non-partitioned table if it exists
      DELETE FROM kz_records
      WHERE steamid64 = p_steamid64 COLLATE utf8mb4_unicode_ci;
    END IF;
  END IF;
  
  SELECT v_records_archived AS records_archived, v_already_archived AS already_archived;
END$$

-------------------------------------------------------------------
-- Recreate: restore_unbanned_player_records with collation fix
-------------------------------------------------------------------

DROP PROCEDURE IF EXISTS restore_unbanned_player_records$$
CREATE PROCEDURE restore_unbanned_player_records(
  IN p_steamid64 VARCHAR(20) CHARSET utf8mb4 COLLATE utf8mb4_unicode_ci
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
  WHERE steamid64 = p_steamid64 COLLATE utf8mb4_unicode_ci;
  
  SET v_records_restored = ROW_COUNT();
  
  -- Delete from archive table
  IF v_records_restored > 0 THEN
    DELETE FROM kz_banned_records
    WHERE steamid64 = p_steamid64 COLLATE utf8mb4_unicode_ci;
  END IF;
  
  SELECT v_records_restored AS records_restored;
END$$

-------------------------------------------------------------------
-- Recreate: batch_archive_banned_records with collation fix
-------------------------------------------------------------------

DROP PROCEDURE IF EXISTS batch_archive_banned_records$$
CREATE PROCEDURE batch_archive_banned_records()
BEGIN
  DECLARE v_total_archived INT DEFAULT 0;
  DECLARE v_players_processed INT DEFAULT 0;
  
  -- Create temp table with permanently banned players who have records
  -- Use explicit collation for temp table
  DROP TEMPORARY TABLE IF EXISTS tmp_to_archive;
  CREATE TEMPORARY TABLE tmp_to_archive (
    steamid64 VARCHAR(20) CHARSET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
    ban_id INT,
    PRIMARY KEY (steamid64)
  );
  
  INSERT INTO tmp_to_archive (steamid64, ban_id)
  SELECT DISTINCT 
    p.steamid64,
    b.id AS ban_id
  FROM kz_players p
  INNER JOIN kz_bans b ON p.steamid64 = b.steamid64 COLLATE utf8mb4_unicode_ci
  WHERE p.is_banned = TRUE
    AND b.expires_on = '9999-12-31 23:59:59'  -- Only permanent bans
    AND NOT EXISTS (
      SELECT 1 FROM kz_banned_records br 
      WHERE br.steamid64 = p.steamid64 COLLATE utf8mb4_unicode_ci
      LIMIT 1
    )
    AND EXISTS (
      SELECT 1 FROM kz_records_partitioned r 
      WHERE r.steamid64 = p.steamid64 COLLATE utf8mb4_unicode_ci
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
    INNER JOIN tmp_to_archive ta ON r.steamid64 = ta.steamid64 COLLATE utf8mb4_unicode_ci;
    
    SET v_total_archived = ROW_COUNT();
    
    -- Delete archived records from main table
    DELETE r FROM kz_records_partitioned r
    INNER JOIN tmp_to_archive ta ON r.steamid64 = ta.steamid64 COLLATE utf8mb4_unicode_ci;
    
    -- Also delete from non-partitioned table
    DELETE r FROM kz_records r
    INNER JOIN tmp_to_archive ta ON r.steamid64 = ta.steamid64 COLLATE utf8mb4_unicode_ci;
  END IF;
  
  DROP TEMPORARY TABLE IF EXISTS tmp_to_archive;
  
  SELECT v_total_archived AS records_archived, v_players_processed AS players_processed;
END$$

DELIMITER ;
