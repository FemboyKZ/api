-- Migration: Make original_id UNIQUE to enable efficient INSERT IGNORE
-- This allows the scraper to use INSERT IGNORE for duplicate detection
-- without needing a separate SELECT query

-- Drop existing index
ALTER TABLE kz_records DROP INDEX idx_original_id;

-- Add unique index (allows NULL values, but each non-NULL value must be unique)
ALTER TABLE kz_records ADD UNIQUE INDEX idx_original_id_unique (original_id);
