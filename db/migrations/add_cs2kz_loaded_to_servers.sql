-- Add cs2kz_loaded column to servers table
-- Run: mysql -u user -p database < db/migrations/add_cs2kz_loaded_to_servers.sql

ALTER TABLE servers
ADD COLUMN cs2kz_loaded TINYINT DEFAULT NULL COMMENT 'Whether CS2KZ plugin is loaded (1=yes, 0=no)'
AFTER gokz_loaded;
