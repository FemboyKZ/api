-- Add players_list column to servers table to store current player list
ALTER TABLE servers 
ADD COLUMN players_list JSON DEFAULT NULL COMMENT 'JSON array of current players on server';
