-- Add globalInfo JSON column to maps table for storing GOKZ/CS2KZ API data

ALTER TABLE maps
ADD COLUMN globalInfo JSON DEFAULT NULL COMMENT 'GOKZ/CS2KZ API data: workshop_url, difficulty, filesize',
ADD COLUMN globalInfo_updated_at TIMESTAMP NULL DEFAULT NULL COMMENT 'Last time globalInfo was fetched from GOKZ/CS2KZ API',
ADD INDEX idx_globalInfo_updated (globalInfo_updated_at);
