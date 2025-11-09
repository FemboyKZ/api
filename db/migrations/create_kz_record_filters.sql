-- Create kz_record_filters table
-- Record filters define unique combinations of map, mode, stage, tickrate, and teleport status

CREATE TABLE IF NOT EXISTS kz_record_filters (
  id INT PRIMARY KEY,
  map_id INT NOT NULL,
  stage TINYINT NOT NULL DEFAULT 0,
  mode_id INT NOT NULL,
  tickrate SMALLINT NOT NULL,
  has_teleports BOOLEAN NOT NULL DEFAULT FALSE,
  created_on DATETIME,
  updated_on DATETIME,
  updated_by_id VARCHAR(20),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_map_mode (map_id, mode_id),
  INDEX idx_mode (mode_id),
  INDEX idx_stage (stage),
  INDEX idx_tickrate (tickrate),
  INDEX idx_teleports (has_teleports),
  UNIQUE KEY unique_filter (map_id, stage, mode_id, tickrate, has_teleports)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Note: This table links to kz_maps and kz_modes tables
-- Each record filter represents a specific competitive category
-- For example: kz_bhop_easy, stage 0, kz_timer mode, 128 tick, no teleports
