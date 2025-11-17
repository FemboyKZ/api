CREATE INDEX idx_records_mode_stage_teleports ON kz_records(mode, stage, teleports);
CREATE INDEX idx_records_created_on ON kz_records(created_on DESC);
CREATE INDEX idx_records_map_id_mode_stage_time ON kz_records(map_id, mode, stage, time);
CREATE INDEX idx_records_player_id ON kz_records(player_id);
CREATE INDEX idx_players_steamid64 ON kz_players(steamid64);
CREATE INDEX idx_players_is_banned ON kz_players(is_banned);
CREATE INDEX idx_maps_id ON kz_maps(id);
CREATE INDEX idx_servers_id ON kz_servers(id);

-- Composite index for world records query
CREATE INDEX idx_records_composite ON kz_records(mode, stage, teleports, time);

-- Create a table to store world records (refreshed periodically)
CREATE TABLE kz_worldrecords_cache (
  map_id INT,
  mode VARCHAR(32),
  stage INT,
  teleports INT,
  player_id BIGINT,
  time FLOAT,
  points INT,
  server_id INT,
  created_on DATETIME,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (map_id, mode, stage, teleports),
  INDEX idx_mode_stage_teleports (mode, stage, teleports)
);

-- Create a stored procedure to refresh the cache
DELIMITER $$
CREATE PROCEDURE refresh_worldrecords_cache()
BEGIN
  TRUNCATE TABLE kz_worldrecords_cache;
  
  INSERT INTO kz_worldrecords_cache (map_id, mode, stage, teleports, player_id, time, points, server_id, created_on)
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
    GROUP BY map_id, mode, stage, tp_group
  ) best ON r.map_id = best.map_id 
    AND r.mode = best.mode 
    AND r.stage = best.stage
    AND CASE WHEN r.teleports = 0 THEN 0 ELSE 1 END = best.tp_group
    AND r.time = best.best_time;
END$$
DELIMITER ;
