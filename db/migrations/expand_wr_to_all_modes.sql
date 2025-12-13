-- Migration: Expand world record columns to support all 3 modes and both pro/overall
-- Date: 2024-12-13

-- Rename existing WR columns to be kz_timer pro-specific
ALTER TABLE kz_map_statistics
  CHANGE COLUMN world_record_time wr_kz_timer_pro_time DECIMAL(10,3) NULL,
  CHANGE COLUMN world_record_steamid64 wr_kz_timer_pro_steamid64 VARCHAR(20) NULL,
  CHANGE COLUMN world_record_player_name wr_kz_timer_pro_player_name VARCHAR(64) NULL,
  CHANGE COLUMN world_record_id wr_kz_timer_pro_record_id INT UNSIGNED NULL;

-- Add kz_timer overall (best time with or without TPs)
ALTER TABLE kz_map_statistics
  ADD COLUMN wr_kz_timer_overall_time DECIMAL(10,3) NULL AFTER wr_kz_timer_pro_record_id,
  ADD COLUMN wr_kz_timer_overall_teleports INT UNSIGNED NULL AFTER wr_kz_timer_overall_time,
  ADD COLUMN wr_kz_timer_overall_steamid64 VARCHAR(20) NULL AFTER wr_kz_timer_overall_teleports,
  ADD COLUMN wr_kz_timer_overall_player_name VARCHAR(64) NULL AFTER wr_kz_timer_overall_steamid64,
  ADD COLUMN wr_kz_timer_overall_record_id INT UNSIGNED NULL AFTER wr_kz_timer_overall_player_name;

-- Add kz_simple pro
ALTER TABLE kz_map_statistics
  ADD COLUMN wr_kz_simple_pro_time DECIMAL(10,3) NULL AFTER wr_kz_timer_overall_record_id,
  ADD COLUMN wr_kz_simple_pro_steamid64 VARCHAR(20) NULL AFTER wr_kz_simple_pro_time,
  ADD COLUMN wr_kz_simple_pro_player_name VARCHAR(64) NULL AFTER wr_kz_simple_pro_steamid64,
  ADD COLUMN wr_kz_simple_pro_record_id INT UNSIGNED NULL AFTER wr_kz_simple_pro_player_name;

-- Add kz_simple overall
ALTER TABLE kz_map_statistics
  ADD COLUMN wr_kz_simple_overall_time DECIMAL(10,3) NULL AFTER wr_kz_simple_pro_record_id,
  ADD COLUMN wr_kz_simple_overall_teleports INT UNSIGNED NULL AFTER wr_kz_simple_overall_time,
  ADD COLUMN wr_kz_simple_overall_steamid64 VARCHAR(20) NULL AFTER wr_kz_simple_overall_teleports,
  ADD COLUMN wr_kz_simple_overall_player_name VARCHAR(64) NULL AFTER wr_kz_simple_overall_steamid64,
  ADD COLUMN wr_kz_simple_overall_record_id INT UNSIGNED NULL AFTER wr_kz_simple_overall_player_name;

-- Add kz_vanilla pro
ALTER TABLE kz_map_statistics
  ADD COLUMN wr_kz_vanilla_pro_time DECIMAL(10,3) NULL AFTER wr_kz_simple_overall_record_id,
  ADD COLUMN wr_kz_vanilla_pro_steamid64 VARCHAR(20) NULL AFTER wr_kz_vanilla_pro_time,
  ADD COLUMN wr_kz_vanilla_pro_player_name VARCHAR(64) NULL AFTER wr_kz_vanilla_pro_steamid64,
  ADD COLUMN wr_kz_vanilla_pro_record_id INT UNSIGNED NULL AFTER wr_kz_vanilla_pro_player_name;

-- Add kz_vanilla overall
ALTER TABLE kz_map_statistics
  ADD COLUMN wr_kz_vanilla_overall_time DECIMAL(10,3) NULL AFTER wr_kz_vanilla_pro_record_id,
  ADD COLUMN wr_kz_vanilla_overall_teleports INT UNSIGNED NULL AFTER wr_kz_vanilla_overall_time,
  ADD COLUMN wr_kz_vanilla_overall_steamid64 VARCHAR(20) NULL AFTER wr_kz_vanilla_overall_teleports,
  ADD COLUMN wr_kz_vanilla_overall_player_name VARCHAR(64) NULL AFTER wr_kz_vanilla_overall_steamid64,
  ADD COLUMN wr_kz_vanilla_overall_record_id INT UNSIGNED NULL AFTER wr_kz_vanilla_overall_player_name;

-- Add indexes for WR columns
CREATE INDEX idx_wr_kz_timer_pro ON kz_map_statistics(wr_kz_timer_pro_time);
CREATE INDEX idx_wr_kz_timer_overall ON kz_map_statistics(wr_kz_timer_overall_time);
CREATE INDEX idx_wr_kz_simple_pro ON kz_map_statistics(wr_kz_simple_pro_time);
CREATE INDEX idx_wr_kz_simple_overall ON kz_map_statistics(wr_kz_simple_overall_time);
CREATE INDEX idx_wr_kz_vanilla_pro ON kz_map_statistics(wr_kz_vanilla_pro_time);
CREATE INDEX idx_wr_kz_vanilla_overall ON kz_map_statistics(wr_kz_vanilla_overall_time);

-- Reset sync timestamp to force re-sync of all maps with new structure
UPDATE kz_map_statistics SET world_records_synced_at = NULL;
