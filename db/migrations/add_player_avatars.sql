-- Add Steam avatar URLs to players table
-- These will be fetched from Steam Web API and cached in the database

ALTER TABLE players
ADD COLUMN avatar_small VARCHAR(255) DEFAULT NULL COMMENT 'Steam avatar 32x32',
ADD COLUMN avatar_medium VARCHAR(255) DEFAULT NULL COMMENT 'Steam avatar 64x64',
ADD COLUMN avatar_full VARCHAR(255) DEFAULT NULL COMMENT 'Steam avatar 184x184',
ADD COLUMN avatar_updated_at TIMESTAMP NULL DEFAULT NULL COMMENT 'Last time avatar was fetched from Steam',
ADD INDEX idx_avatar_updated (avatar_updated_at);
