-- Add GlobalKZ server metadata columns to kz_servers table
-- Run this migration before using the server metadata scraper

ALTER TABLE kz_servers
  ADD COLUMN api_key VARCHAR(50) NULL AFTER server_id,
  ADD COLUMN port INT NULL AFTER api_key,
  ADD COLUMN ip VARCHAR(45) NULL AFTER port,
  ADD COLUMN owner_steamid64 VARCHAR(20) NULL AFTER server_name,
  ADD COLUMN created_on DATETIME NULL AFTER owner_steamid64,
  ADD COLUMN updated_on DATETIME NULL AFTER created_on,
  ADD COLUMN approval_status INT NULL AFTER updated_on,
  ADD COLUMN approved_by_steamid64 VARCHAR(20) NULL AFTER approval_status;

-- Add indexes for common lookups
CREATE INDEX idx_ip_port ON kz_servers(ip, port);
CREATE INDEX idx_owner ON kz_servers(owner_steamid64);

-- Note: server_id is the GlobalKZ API server ID (e.g., 1279)
-- This is already unique in the existing schema
