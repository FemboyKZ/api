-- Clean up existing maps with workshop paths in their names
-- This migration sanitizes map names that contain workshop paths or URL encoding

-- First, let's see what we're dealing with (comment out for actual migration)
-- SELECT DISTINCT name FROM maps WHERE name LIKE '%/%' OR name LIKE '%\\%' OR name LIKE '%workshop%';

-- For CS:GO maps
UPDATE maps 
SET name = CASE
    -- Handle URL-encoded paths (workshop%2F...)
    WHEN name LIKE '%workshop%2F%' THEN 
        REGEXP_REPLACE(
            REPLACE(REPLACE(name, '%2F', '/'), '%5C', '\\'),
            '.*[/\\\\]([a-zA-Z0-9_-]+)$',
            '\\1'
        )
    -- Handle regular workshop paths (workshop/...)
    WHEN name LIKE 'workshop/%' OR name LIKE 'workshop\\%' THEN 
        REGEXP_REPLACE(name, '.*[/\\\\]([a-zA-Z0-9_-]+)$', '\\1')
    -- Handle maps/ folder paths
    WHEN name LIKE 'maps/%' OR name LIKE 'maps\\%' THEN 
        REGEXP_REPLACE(name, '.*[/\\\\]([a-zA-Z0-9_-]+)$', '\\1')
    -- Handle any other path-like structure
    WHEN name LIKE '%/%' OR name LIKE '%\\%' THEN 
        REGEXP_REPLACE(name, '.*[/\\\\]([a-zA-Z0-9_-]+)$', '\\1')
    ELSE name
END
WHERE game = 'csgo' 
  AND (name LIKE '%/%' OR name LIKE '%\\%' OR name LIKE '%workshop%');

-- For CS2 maps
UPDATE maps 
SET name = CASE
    -- Handle URL-encoded paths (workshop%2F...)
    WHEN name LIKE '%workshop%2F%' THEN 
        REGEXP_REPLACE(
            REPLACE(REPLACE(name, '%2F', '/'), '%5C', '\\'),
            '.*[/\\\\]([a-zA-Z0-9_-]+)$',
            '\\1'
        )
    -- Handle regular workshop paths (workshop/...)
    WHEN name LIKE 'workshop/%' OR name LIKE 'workshop\\%' THEN 
        REGEXP_REPLACE(name, '.*[/\\\\]([a-zA-Z0-9_-]+)$', '\\1')
    -- Handle maps/ folder paths
    WHEN name LIKE 'maps/%' OR name LIKE 'maps\\%' THEN 
        REGEXP_REPLACE(name, '.*[/\\\\]([a-zA-Z0-9_-]+)$', '\\1')
    -- Handle any other path-like structure
    WHEN name LIKE '%/%' OR name LIKE '%\\%' THEN 
        REGEXP_REPLACE(name, '.*[/\\\\]([a-zA-Z0-9_-]+)$', '\\1')
    ELSE name
END
WHERE game = 'counterstrike2' 
  AND (name LIKE '%/%' OR name LIKE '%\\%' OR name LIKE '%workshop%');

-- Note: This may create duplicate map entries if the same map had different paths.
-- After running this migration, you may want to consolidate duplicates:
-- 
-- For each game, find duplicates and merge their playtime:
-- SELECT name, game, SUM(playtime) as total_playtime, MAX(last_played) as last_played
-- FROM maps
-- GROUP BY name, game
-- HAVING COUNT(*) > 1;
--
-- Then delete duplicates and update playtime accordingly.
