-- Migration: Add map metadata columns from GlobalKZ API
-- Adds detailed map information for kz_maps table

-- Add new columns for map metadata
ALTER TABLE kz_maps
ADD COLUMN filesize INT NULL COMMENT 'Map file size in bytes',
ADD COLUMN validated BOOLEAN NULL COMMENT 'Whether map is validated by KZ team',
ADD COLUMN difficulty TINYINT NULL COMMENT 'Map difficulty (1-7)',
ADD COLUMN approved_by_steamid64 VARCHAR(20) NULL COMMENT 'SteamID64 of approver',
ADD COLUMN workshop_url VARCHAR(500) NULL COMMENT 'Steam Workshop URL',
ADD COLUMN download_url VARCHAR(500) NULL COMMENT 'Direct download URL',
ADD COLUMN global_created_on DATETIME NULL COMMENT 'Creation timestamp from GlobalKZ',
ADD COLUMN global_updated_on DATETIME NULL COMMENT 'Last update timestamp from GlobalKZ';

-- Add indexes for common queries
ALTER TABLE kz_maps
ADD INDEX idx_validated (validated),
ADD INDEX idx_difficulty (difficulty);

-- Optional: Add comment to table
ALTER TABLE kz_maps COMMENT = 'Normalized map data with GlobalKZ metadata';
