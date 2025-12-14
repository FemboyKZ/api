-- Migration: Add quarantine tables for suspicious jumpstats
-- This migration creates tables to store jumpstats that have been flagged
-- by the cleanup service, preserving the original data along with filter metadata

-------------------------------------------------------------------
-- CS2 Jumpstats Quarantine Table
-- Matches the structure of the Jumpstats table in CS2 KZ database
-------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS Jumpstats_Quarantine (
  -- Original jumpstat data
  ID CHAR(36) NOT NULL PRIMARY KEY,
  SteamID64 BIGINT NOT NULL,
  JumpType TINYINT NOT NULL,
  Mode TINYINT NOT NULL,
  Distance FLOAT NOT NULL,
  IsBlockJump BOOLEAN NOT NULL DEFAULT FALSE,
  Block SMALLINT NOT NULL DEFAULT 0,
  Strafes TINYINT NOT NULL DEFAULT 0,
  Sync FLOAT NOT NULL DEFAULT 0,
  Pre FLOAT NOT NULL DEFAULT 0,
  Max FLOAT NOT NULL DEFAULT 0,
  Airtime FLOAT NOT NULL DEFAULT 0,
  Created DATETIME NOT NULL,
  
  -- Quarantine metadata
  filter_id VARCHAR(100) NOT NULL COMMENT 'ID of the filter that matched this record',
  filter_name VARCHAR(255) NOT NULL COMMENT 'Human-readable name of the filter',
  filter_conditions JSON COMMENT 'JSON snapshot of the filter conditions used',
  quarantined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT 'When this record was quarantined',
  quarantined_by VARCHAR(50) DEFAULT 'system' COMMENT 'Who initiated the quarantine (system or admin steamid)',
  notes TEXT COMMENT 'Optional notes about why this was quarantined',
  
  -- Indexes for searching quarantined records
  INDEX idx_quarantine_steamid (SteamID64),
  INDEX idx_quarantine_filter (filter_id),
  INDEX idx_quarantine_date (quarantined_at),
  INDEX idx_quarantine_jump_type (JumpType)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-------------------------------------------------------------------
-- CSGO Jumpstats Quarantine Table
-- Matches the structure of the Jumpstats table in CSGO KZ database
-- Note: CSGO uses same schema as CS2 but with SteamID32 instead of SteamID64
-------------------------------------------------------------------

-- For CSGO, we use the same Jumpstats_Quarantine table structure
-- since both games share the same Jumpstats schema (PascalCase)
-- The table is created per-database (CS2, CSGO128, CSGO64)

-- If you need a separate CSGO quarantine table, use this:
-- (Run this in each CSGO database: csgo_fkz_128 and csgo_fkz_64)

/*
CREATE TABLE IF NOT EXISTS Jumpstats_Quarantine (
  -- Original jumpstat data (matches Jumpstats table)
  JumpID INT(10) UNSIGNED NOT NULL PRIMARY KEY,
  SteamID32 INT(10) UNSIGNED NOT NULL,
  JumpType TINYINT(3) UNSIGNED NOT NULL,
  Mode TINYINT(3) UNSIGNED NOT NULL,
  Distance INT(10) UNSIGNED NOT NULL,
  IsBlockJump TINYINT(3) UNSIGNED NOT NULL DEFAULT 0,
  Block SMALLINT(5) UNSIGNED NOT NULL DEFAULT 0,
  Strafes INT(10) UNSIGNED NOT NULL DEFAULT 0,
  Sync INT(10) UNSIGNED NOT NULL DEFAULT 0,
  Pre INT(10) UNSIGNED NOT NULL DEFAULT 0,
  Max INT(10) UNSIGNED NOT NULL DEFAULT 0,
  Airtime INT(10) UNSIGNED NOT NULL DEFAULT 0,
  Created TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  -- Quarantine metadata
  filter_id VARCHAR(100) NOT NULL COMMENT 'ID of the filter that matched this record',
  filter_name VARCHAR(255) NOT NULL COMMENT 'Human-readable name of the filter',
  filter_conditions JSON COMMENT 'JSON snapshot of the filter conditions used',
  quarantined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT 'When this record was quarantined',
  quarantined_by VARCHAR(50) DEFAULT 'system' COMMENT 'Who initiated the quarantine (system or admin steamid)',
  notes TEXT COMMENT 'Optional notes about why this was quarantined',
  
  -- Indexes for searching quarantined records
  INDEX idx_quarantine_steamid (SteamID32),
  INDEX idx_quarantine_filter (filter_id),
  INDEX idx_quarantine_date (quarantined_at),
  INDEX idx_quarantine_jump_type (JumpType)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
*/

-------------------------------------------------------------------
-- Quarantine log table for tracking cleanup operations
-------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS jumpstat_cleanup_log (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  game ENUM('cs2', 'csgo') NOT NULL,
  filter_id VARCHAR(100) NOT NULL,
  filter_name VARCHAR(255) NOT NULL,
  records_matched INT UNSIGNED NOT NULL DEFAULT 0,
  records_quarantined INT UNSIGNED NOT NULL DEFAULT 0,
  dry_run BOOLEAN NOT NULL DEFAULT FALSE,
  executed_by VARCHAR(50) DEFAULT 'system',
  executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  error_message TEXT NULL,
  
  INDEX idx_log_game (game),
  INDEX idx_log_filter (filter_id),
  INDEX idx_log_date (executed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
