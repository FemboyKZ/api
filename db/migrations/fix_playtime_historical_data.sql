-- Fix historical playtime data
-- The playtime was being incremented by 1 second per update instead of 30 seconds
-- This multiplies all existing playtime values by 30 to correct the historical data

-- Backup note: It's recommended to backup your database before running this migration
-- mysqldump -u root -p csmonitor > backup_before_playtime_fix.sql

-- Fix player playtime (multiply by 30)
UPDATE players 
SET playtime = playtime * 30
WHERE playtime > 0;

-- Fix map playtime (multiply by 30)
UPDATE maps 
SET playtime = playtime * 30
WHERE playtime > 0;

-- Verify the changes
SELECT 
  'Players' as table_name,
  COUNT(*) as total_records,
  SUM(playtime) as total_playtime_seconds,
  ROUND(SUM(playtime) / 3600, 2) as total_playtime_hours
FROM players
UNION ALL
SELECT 
  'Maps' as table_name,
  COUNT(*) as total_records,
  SUM(playtime) as total_playtime_seconds,
  ROUND(SUM(playtime) / 3600, 2) as total_playtime_hours
FROM maps;
