-- Add original_id column to kz_records table
-- This preserves the original ID from the source API data

ALTER TABLE kz_records 
ADD COLUMN original_id BIGINT UNSIGNED NULL AFTER id,
ADD INDEX idx_original_id (original_id);

-- Note: Run this migration with:
-- docker exec -i kz-records-mariadb mariadb -u root -p<password> fkz_kz_records < db/migrations/add_original_id_to_kz_records.sql
