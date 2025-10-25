-- Add maxplayers column to servers table
ALTER TABLE servers
ADD COLUMN maxplayers INT DEFAULT 0 AFTER player_count;
