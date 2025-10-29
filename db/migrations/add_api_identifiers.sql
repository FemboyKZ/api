-- Add apiId (CS2), kztId (CS:GO), and tickrate (CS:GO) to servers table
-- These fields are used to identify servers in external APIs:
-- - apiId: CS2KZ API server identifier (for CS2 servers)
-- - kztId: GlobalKZ API server identifier (for CS:GO servers)
-- - tickrate: Server tickrate (mainly for CS:GO 64 vs 128 tick distinction)

-- Add new columns
ALTER TABLE servers 
ADD COLUMN api_id INT DEFAULT NULL COMMENT 'CS2KZ API server ID (for CS2 servers)',
ADD COLUMN kzt_id INT DEFAULT NULL COMMENT 'GlobalKZ API server ID (for CS:GO servers)',
ADD COLUMN tickrate INT DEFAULT NULL COMMENT 'Server tickrate (64, 128, etc.)';

-- Add indexes for efficient lookups
ALTER TABLE servers
ADD INDEX idx_api_id (api_id),
ADD INDEX idx_kzt_id (kzt_id);
