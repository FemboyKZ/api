-- Add original_id column to kz_records table
-- This preserves the original ID from the source API data

ALTER TABLE kz_records 
ADD COLUMN original_id BIGINT UNSIGNED NULL AFTER id,
ADD INDEX idx_original_id (original_id);
