-- Migration: drop the unused player avatar cache
--
-- The Steam avatar sync job that kept these columns fresh was never started,
-- so the stored values are stale. Avatars are resolved by the site instead, and
-- the API no longer returns an `avatar` field.
--
-- Idempotent on MariaDB via DROP COLUMN IF EXISTS.
--
-- Apply: mysql -u user -p database < db/migrations/drop_player_avatar.sql

ALTER TABLE players
  DROP COLUMN IF EXISTS avatar,
  DROP COLUMN IF EXISTS avatar_updated_at;
