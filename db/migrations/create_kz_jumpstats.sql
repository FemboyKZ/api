-- Migration: Create kz_jumpstats table for storing jump statistics from GlobalKZ API

CREATE TABLE IF NOT EXISTS kz_jumpstats (
  id INT PRIMARY KEY,
  server_id INT NULL,
  steamid64 VARCHAR(20) NULL,
  player_name VARCHAR(255) NULL,
  steam_id VARCHAR(32) NULL,
  jump_type INT NOT NULL,
  distance FLOAT NOT NULL,
  tickrate INT NULL,
  msl_count INT NULL,
  strafe_count INT NULL,
  is_crouch_bind SMALLINT NOT NULL DEFAULT 0,
  is_forward_bind SMALLINT NOT NULL DEFAULT 0,
  is_crouch_boost SMALLINT NOT NULL DEFAULT 0,
  updated_by_id VARCHAR(20) NULL,
  created_on DATETIME NULL,
  updated_on DATETIME NULL,
  INDEX idx_steamid64 (steamid64),
  INDEX idx_jump_type (jump_type),
  INDEX idx_server_id (server_id),
  INDEX idx_is_crouch_bind (is_crouch_bind),
  INDEX idx_is_forward_bind (is_forward_bind),
  INDEX idx_is_crouch_boost (is_crouch_boost),
  INDEX idx_created_on (created_on)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- Note: This table stores jump statistics for players from GlobalKZ API
