-- Migration: Fix avg_teleports column overflow
-- Issue: DECIMAL(6,2) max is 9999.99, some players have higher average teleports
-- Solution: Increase to DECIMAL(10,2) which allows up to 99,999,999.99

ALTER TABLE kz_player_statistics 
MODIFY COLUMN avg_teleports DECIMAL(10,2) NOT NULL DEFAULT 0;
