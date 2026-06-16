-- Migration: cache Discord display name on player_meta
--
-- Only needed if you already applied add_kofi_vip_system.sql (which now also
-- includes this column for fresh installs). Idempotent on MariaDB via
-- ADD COLUMN IF NOT EXISTS.
--
-- Apply: mysql -u user -p database < db/migrations/add_discord_username.sql

ALTER TABLE player_meta
  ADD COLUMN IF NOT EXISTS discord_username VARCHAR(64) DEFAULT NULL
    COMMENT 'Discord display name (cached for UI)' AFTER discord_id;
