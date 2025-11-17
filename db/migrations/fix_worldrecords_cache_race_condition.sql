-- Fix race condition in world records cache refresh
-- Replace TRUNCATE+INSERT with REPLACE INTO to handle concurrent refreshes safely

DROP PROCEDURE IF EXISTS refresh_worldrecords_cache;

DELIMITER $$
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
  REPLACE INTO kz_worldrecords_cache (map_id, mode, stage, teleports, player_id, time, points, server_id, created_on)
  SELECT 
    r.map_id,
    r.mode,
    r.stage,
    CASE WHEN r.teleports = 0 THEN 0 ELSE 1 END as teleports,
    r.player_id,
    r.time,
    r.points,
    r.server_id,
    r.created_on
  FROM kz_records r
  INNER JOIN (
    SELECT 
      map_id, 
      mode, 
      stage,
      CASE WHEN teleports = 0 THEN 0 ELSE 1 END as tp_group,
      MIN(time) as best_time
    FROM kz_records
    WHERE player_id IS NOT NULL
    GROUP BY map_id, mode, stage, tp_group
  ) best ON r.map_id = best.map_id 
    AND r.mode = best.mode 
    AND r.stage = best.stage
    AND CASE WHEN r.teleports = 0 THEN 0 ELSE 1 END = best.tp_group
    AND r.time = best.best_time
  -- Exclude banned players
  WHERE NOT EXISTS (
    SELECT 1 FROM kz_players p 
    WHERE p.steamid64 = r.player_id 
    AND p.is_banned = TRUE
  );

  COMMIT;
END$$
DELIMITER ;
