-- Add region and domain columns to servers table
ALTER TABLE servers 
ADD COLUMN region VARCHAR(10) DEFAULT NULL COMMENT 'Server region: eu, na, as, au, sa, za',
ADD COLUMN domain VARCHAR(100) DEFAULT NULL COMMENT 'Server domain name',
ADD INDEX idx_region (region);
