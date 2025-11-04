-- Simplify avatar storage by keeping only one avatar URL
-- All three sizes (small, medium, full) are the same image with different size suffixes
-- We only need to store the base URL and can construct the others if needed

-- Remove redundant avatar columns and rename avatar_small to avatar
ALTER TABLE players 
  DROP COLUMN avatar_medium,
  DROP COLUMN avatar_full,
  CHANGE COLUMN avatar_small avatar VARCHAR(255) DEFAULT NULL COMMENT 'Steam avatar URL (32x32, can append _medium.jpg or _full.jpg for larger sizes)';

-- Note: After running this migration, you may want to update existing avatar URLs
-- to remove the .jpg extension for easier manipulation, but it's not required.
-- The current URLs like 'https://avatars.steamstatic.com/hash.jpg' will still work.
