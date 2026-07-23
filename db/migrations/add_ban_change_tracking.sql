-- Ban change tracking
-- Run: mysql -u user -p kz_database < db/migrations/add_ban_change_tracking.sql
--
-- Problem this fixes:
--   1. Both ban scrapers forced `updated_at = CURRENT_TIMESTAMP` on every upsert,
--      so updated_at meant "last scrape touched this row", not "this ban changed".
--   2. The GlobalAPI `updated_since` filter is recognized but always returns an
--      empty array, so upstream cannot tell us which bans changed.
--
-- After this migration:
--   updated_at    last time a tracked field actually changed (set explicitly by the scraper)
--   last_seen_at  last time a scrape saw the row at all
--   updated_on    upstream GlobalAPI value, unchanged meaning
--   kz_ban_changes  per-field audit rows, the feed used to answer "recent unbans"

-- ---------------------------------------------------------------------------
-- kz_bans column changes
-- ---------------------------------------------------------------------------

-- Drop ON UPDATE CURRENT_TIMESTAMP. The scraper now sets updated_at itself, and
-- keeping ON UPDATE would re-bump it every time last_seen_at is written.
ALTER TABLE kz_bans
  MODIFY COLUMN updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE kz_bans
  ADD COLUMN last_seen_at TIMESTAMP NULL DEFAULT NULL AFTER updated_at;

ALTER TABLE kz_bans
  ADD INDEX idx_ban_updated_at (updated_at);

-- Existing updated_at values are scrape-touch times and carry no change info.
-- Upstream updated_on is the best available "last changed" baseline.
UPDATE kz_bans
SET last_seen_at = updated_at,
    updated_at = COALESCE(updated_on, created_on, created_at);

-- ---------------------------------------------------------------------------
-- kz_ban_changes
-- ---------------------------------------------------------------------------

-- No FK to kz_bans: this is an audit log and must survive a ban row going away.
CREATE TABLE IF NOT EXISTS kz_ban_changes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ban_id INT NOT NULL,
  steamid64 VARCHAR(20) NULL,
  player_name VARCHAR(255) NULL,
  -- unban | reban | expiry_change | edit
  change_type VARCHAR(24) NOT NULL,
  field VARCHAR(32) NOT NULL,
  old_value TEXT NULL,
  new_value TEXT NULL,
  api_updated_on DATETIME NULL,
  detected_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  INDEX idx_change_detected (detected_at),
  INDEX idx_change_type (change_type, detected_at),
  INDEX idx_change_ban (ban_id, detected_at),
  INDEX idx_change_steamid (steamid64, detected_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
