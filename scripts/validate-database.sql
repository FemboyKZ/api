-- ============================================================================
-- KZ Records Database Validation Script
-- ============================================================================
-- This script checks data integrity in the kz_records database
-- Run with: mysql -h localhost -P 3308 -u user -p kz_records < validate-database.sql
-- Or execute sections individually for detailed analysis
-- ============================================================================

-- Set session variables for better output
SET @total_records = 0;
SET @valid_records = 0;
SET @invalid_records = 0;

-- ============================================================================
-- SUMMARY STATISTICS
-- ============================================================================

SELECT '============================================================' AS '';
SELECT 'DATABASE VALIDATION SUMMARY' AS '';
SELECT '============================================================' AS '';

-- Total records count
SELECT 
  COUNT(*) AS total_records,
  MIN(id) AS min_record_id,
  MAX(id) AS max_record_id,
  MAX(id) - MIN(id) + 1 AS expected_range,
  COUNT(DISTINCT id) AS unique_record_ids,
  COUNT(*) - COUNT(DISTINCT id) AS duplicate_record_ids,
  ROUND((COUNT(DISTINCT id) / (MAX(id) - MIN(id) + 1)) * 100, 2) AS coverage_percentage
FROM kz_records;

SELECT '------------------------------------------------------------' AS '';

-- Unique entities
SELECT 'UNIQUE ENTITIES:' AS '';
SELECT COUNT(DISTINCT player_id) AS unique_players FROM kz_records;
SELECT COUNT(DISTINCT map_id) AS unique_maps FROM kz_records;
SELECT COUNT(DISTINCT server_id) AS unique_servers FROM kz_records;
SELECT COUNT(DISTINCT mode) AS unique_modes FROM kz_records;

SELECT '------------------------------------------------------------' AS '';

-- ============================================================================
-- MISSING REQUIRED FIELDS
-- ============================================================================

SELECT '============================================================' AS '';
SELECT 'MISSING REQUIRED FIELDS' AS '';
SELECT '============================================================' AS '';

-- Missing player_id
SELECT 'Missing player_id:' AS error_type, COUNT(*) AS count
FROM kz_records 
WHERE player_id IS NULL;

-- Missing map_id
SELECT 'Missing map_id:' AS error_type, COUNT(*) AS count
FROM kz_records 
WHERE map_id IS NULL;

-- Missing server_id
SELECT 'Missing server_id:' AS error_type, COUNT(*) AS count
FROM kz_records 
WHERE server_id IS NULL;

-- Missing mode
SELECT 'Missing mode:' AS error_type, COUNT(*) AS count
FROM kz_records 
WHERE mode IS NULL;

-- Missing time
SELECT 'Missing time (NULL):' AS error_type, COUNT(*) AS count
FROM kz_records 
WHERE time IS NULL;

-- Missing teleports
SELECT 'Missing teleports (NULL):' AS error_type, COUNT(*) AS count
FROM kz_records 
WHERE teleports IS NULL;

-- Missing created_on
SELECT 'Missing created_on:' AS error_type, COUNT(*) AS count
FROM kz_records 
WHERE created_on IS NULL;

SELECT '------------------------------------------------------------' AS '';

-- ============================================================================
-- PLACEHOLDER/REPLACER VALUES (Used by Scrapers/Importer)
-- ============================================================================

SELECT '============================================================' AS '';
SELECT 'PLACEHOLDER/REPLACER VALUES (Data Quality Issues)' AS '';
SELECT '============================================================' AS '';

-- Players with "Unknown" in name
SELECT 'Players with "Unknown" name:' AS error_type, COUNT(*) AS count
FROM kz_players
WHERE player_name LIKE '%Unknown%';

-- Players with placeholder SteamID64 pattern (INVALID_STEAMID_*)
SELECT 'Players with INVALID_STEAMID placeholder:' AS error_type, COUNT(*) AS count
FROM kz_players
WHERE steamid64 LIKE 'INVALID_STEAMID_%';

-- Maps with "unknown_map" name
SELECT 'Maps with "unknown_map" name:' AS error_type, COUNT(*) AS count
FROM kz_maps
WHERE map_name = 'unknown_map' OR map_name LIKE 'unknown_%';

-- Servers with -1 server_id (placeholder for missing server)
SELECT 'Servers with placeholder ID (-1):' AS error_type, COUNT(*) AS count
FROM kz_servers
WHERE server_id = -1;

-- Servers with "Unknown Server" in name
SELECT 'Servers with "Unknown Server" name:' AS error_type, COUNT(*) AS count
FROM kz_servers
WHERE server_name LIKE '%Unknown Server%';

-- Records referencing placeholder player IDs
SELECT 'Records with placeholder players:' AS error_type, COUNT(*) AS count
FROM kz_records r
JOIN kz_players p ON r.player_id = p.id
WHERE p.player_name LIKE '%Unknown%' OR p.steamid64 LIKE 'INVALID_STEAMID_%';

-- Records referencing placeholder map IDs
SELECT 'Records with placeholder maps:' AS error_type, COUNT(*) AS count
FROM kz_records r
JOIN kz_maps m ON r.map_id = m.id
WHERE m.map_name = 'unknown_map' OR m.map_name LIKE 'unknown_%';

-- Records referencing placeholder server IDs
SELECT 'Records with placeholder servers:' AS error_type, COUNT(*) AS count
FROM kz_records r
JOIN kz_servers s ON r.server_id = s.id
WHERE s.server_id = -1 OR s.server_name LIKE '%Unknown Server%';

SELECT '------------------------------------------------------------' AS '';

-- ============================================================================
-- INVALID DATA VALUES
-- ============================================================================

SELECT '============================================================' AS '';
SELECT 'INVALID DATA VALUES' AS '';
SELECT '============================================================' AS '';

-- Invalid time (negative values)
SELECT 'Invalid time (negative):' AS error_type, COUNT(*) AS count
FROM kz_records 
WHERE time < 0;

-- Invalid time (zero)
SELECT 'Invalid time (zero):' AS error_type, COUNT(*) AS count
FROM kz_records 
WHERE time = 0;

-- Invalid teleports (negative values)
SELECT 'Invalid teleports (negative):' AS error_type, COUNT(*) AS count
FROM kz_records 
WHERE teleports < 0;

-- Invalid points (negative values)
SELECT 'Invalid points (negative):' AS error_type, COUNT(*) AS count
FROM kz_records 
WHERE points < 0;

-- Invalid record_filter_id (negative values)
SELECT 'Invalid record_filter_id:' AS error_type, COUNT(*) AS count
FROM kz_records 
WHERE record_filter_id < 0;

SELECT '------------------------------------------------------------' AS '';

-- ============================================================================
-- ORPHANED RECORDS (Foreign Key Validation)
-- ============================================================================

SELECT '============================================================' AS '';
SELECT 'ORPHANED RECORDS (Missing Foreign Key References)' AS '';
SELECT '============================================================' AS '';

-- Records with player_id not in kz_players
SELECT 'Orphaned player_id:' AS error_type, COUNT(*) AS count
FROM kz_records r
LEFT JOIN kz_players p ON r.player_id = p.id
WHERE r.player_id IS NOT NULL AND p.id IS NULL;

-- Records with map_id not in kz_maps
SELECT 'Orphaned map_id:' AS error_type, COUNT(*) AS count
FROM kz_records r
LEFT JOIN kz_maps m ON r.map_id = m.id
WHERE r.map_id IS NOT NULL AND m.id IS NULL;

-- Records with server_id not in kz_servers
SELECT 'Orphaned server_id:' AS error_type, COUNT(*) AS count
FROM kz_records r
LEFT JOIN kz_servers s ON r.server_id = s.id
WHERE r.server_id IS NOT NULL AND s.id IS NULL;

-- Records with mode not in kz_modes
SELECT 'Orphaned mode:' AS error_type, COUNT(*) AS count
FROM kz_records r
LEFT JOIN kz_modes mo ON r.mode = mo.name
WHERE r.mode IS NOT NULL AND mo.name IS NULL;

SELECT '------------------------------------------------------------' AS '';

-- ============================================================================
-- DUPLICATE RECORD IDS
-- ============================================================================

SELECT '============================================================' AS '';
SELECT 'DUPLICATE RECORD IDS (Top 20)' AS '';
SELECT '============================================================' AS '';

SELECT 
  id AS duplicate_record_id,
  COUNT(*) AS occurrences
FROM kz_records
GROUP BY id
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC, id ASC
LIMIT 20;

SELECT '------------------------------------------------------------' AS '';

-- ============================================================================
-- DUPLICATE PLAYER IDS
-- ============================================================================

SELECT '============================================================' AS '';
SELECT 'DUPLICATE PLAYER IDS (Top 20)' AS '';
SELECT '============================================================' AS '';

SELECT 
  id AS duplicate_player_id,
  COUNT(*) AS occurrences
FROM kz_players
GROUP BY id
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC, id ASC
LIMIT 20;

SELECT '------------------------------------------------------------' AS '';

-- ============================================================================
-- MISSING PLAYER/MAP/SERVER METADATA
-- ============================================================================

SELECT '============================================================' AS '';
SELECT 'MISSING ENTITY METADATA' AS '';
SELECT '============================================================' AS '';

-- Players with missing steamid64
SELECT 'Players missing steamid64:' AS metadata_issue, COUNT(*) AS count
FROM kz_players
WHERE steamid64 IS NULL OR steamid64 = '';

-- Maps with missing map_name
SELECT 'Maps missing map_name:' AS metadata_issue, COUNT(*) AS count
FROM kz_maps
WHERE map_name IS NULL OR map_name = '';

-- Servers with missing server_name
SELECT 'Servers missing server_name:' AS metadata_issue, COUNT(*) AS count
FROM kz_servers
WHERE server_name IS NULL OR server_name = '';

-- Servers with missing IP/port metadata
SELECT 'Servers missing IP:' AS metadata_issue, COUNT(*) AS count
FROM kz_servers
WHERE ip IS NULL OR ip = '';

SELECT 'Servers missing port:' AS metadata_issue, COUNT(*) AS count
FROM kz_servers
WHERE port IS NULL;

SELECT '------------------------------------------------------------' AS '';

-- ============================================================================
-- DETAILED ERROR EXAMPLES (First 10 of each type)
-- ============================================================================

SELECT '============================================================' AS '';
SELECT 'DETAILED ERROR EXAMPLES' AS '';
SELECT '============================================================' AS '';

-- Missing player_id examples
SELECT 'Missing player_id (first 10):' AS '';
SELECT 
  r.id AS record_id,
  r.player_id,
  r.map_id,
  r.server_id,
  r.time,
  r.created_on
FROM kz_records r
WHERE r.player_id IS NULL
LIMIT 10;

-- Invalid time examples (negative)
SELECT 'Invalid time - negative (first 10):' AS '';
SELECT 
  r.id AS record_id,
  r.player_id,
  r.map_id,
  r.time,
  r.teleports,
  r.created_on
FROM kz_records r
WHERE r.time < 0
LIMIT 10;

-- Orphaned player_id examples
SELECT 'Orphaned player_id (first 10):' AS '';
SELECT 
  r.id AS record_id,
  r.player_id AS missing_player_id,
  r.map_id,
  r.server_id,
  r.time,
  r.created_on
FROM kz_records r
LEFT JOIN kz_players p ON r.player_id = p.id
WHERE r.player_id IS NOT NULL AND p.id IS NULL
LIMIT 10;

-- Duplicate record IDs with details
SELECT 'Duplicate record IDs (first 10):' AS '';
SELECT 
  r.id AS duplicate_record_id,
  COUNT(*) AS occurrences,
  GROUP_CONCAT(r.player_id ORDER BY r.created_on SEPARATOR ', ') AS player_ids,
  MIN(r.created_on) AS first_created,
  MAX(r.created_on) AS last_created
FROM kz_records r
GROUP BY r.id
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC
LIMIT 10;

SELECT '------------------------------------------------------------' AS '';

-- ============================================================================
-- DATA QUALITY SCORE
-- ============================================================================

SELECT '============================================================' AS '';
SELECT 'DATA QUALITY SCORE' AS '';
SELECT '============================================================' AS '';

SELECT 
  COUNT(*) AS total_records,
  SUM(CASE 
    WHEN player_id IS NULL OR map_id IS NULL OR server_id IS NULL OR mode IS NULL
         OR time IS NULL OR time < 0 
         OR teleports IS NULL OR teleports < 0
         OR created_on IS NULL
    THEN 1 ELSE 0 
  END) AS invalid_records,
  COUNT(*) - SUM(CASE 
    WHEN player_id IS NULL OR map_id IS NULL OR server_id IS NULL OR mode IS NULL
         OR time IS NULL OR time < 0 
         OR teleports IS NULL OR teleports < 0
         OR created_on IS NULL
    THEN 1 ELSE 0 
  END) AS valid_records,
  ROUND((1 - (SUM(CASE 
    WHEN player_id IS NULL OR map_id IS NULL OR server_id IS NULL OR mode IS NULL
         OR time IS NULL OR time < 0 
         OR teleports IS NULL OR teleports < 0
         OR created_on IS NULL
    THEN 1 ELSE 0 
  END) / COUNT(*))) * 100, 2) AS quality_percentage
FROM kz_records;

SELECT '============================================================' AS '';
SELECT 'VALIDATION COMPLETE' AS '';
SELECT '============================================================' AS '';
