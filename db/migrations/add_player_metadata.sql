-- Add missing columns to kz_players table
-- These columns come from the GlobalKZ /players API endpoint

ALTER TABLE kz_players
  ADD COLUMN is_banned BOOLEAN DEFAULT FALSE AFTER player_name,
  ADD COLUMN total_records INT DEFAULT 0 AFTER is_banned;

-- Add indexes for new columns
CREATE INDEX idx_is_banned ON kz_players(is_banned);
CREATE INDEX idx_total_records ON kz_players(total_records);

-- Note: This migration is idempotent - if columns already exist, it will fail safely
-- To make it truly idempotent, you can check first:
-- SELECT * FROM information_schema.columns 
-- WHERE table_name = 'kz_players' AND column_name = 'is_banned';
