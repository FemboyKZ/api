-- KZ Records Performance Optimization - Additional Indexes
-- Run this migration AFTER add_important_indexes.sql
-- These indexes target specific query patterns identified in performance analysis

-- ============================================================================
-- CRITICAL: World Records Query Optimization
-- ============================================================================

-- Covering index for world records lookup (mode, stage, teleports filter)
-- Includes time in index to enable index-only scans
CREATE INDEX IF NOT EXISTS idx_records_wr_lookup 
ON kz_records(mode, stage, teleports, map_id, time);

-- Alternative composite for banned player filtering in world records
CREATE INDEX IF NOT EXISTS idx_records_wr_with_player 
ON kz_records(mode, stage, map_id, player_id, time, teleports);

-- ============================================================================
-- Map Leaderboard Optimization
-- ============================================================================

-- Covering index for map leaderboards (most frequent query after world records)
CREATE INDEX IF NOT EXISTS idx_records_map_leaderboard 
ON kz_records(map_id, mode, stage, teleports, player_id, time);

-- For player best time lookup in leaderboards
CREATE INDEX IF NOT EXISTS idx_records_player_best 
ON kz_records(player_id, map_id, mode, stage, time);

-- ============================================================================
-- Recent Records Query Optimization
-- ============================================================================

-- Index for recent records with mode filtering
CREATE INDEX IF NOT EXISTS idx_records_recent_mode 
ON kz_records(created_on DESC, mode, stage);

-- For recent records by map
CREATE INDEX IF NOT EXISTS idx_records_recent_map 
ON kz_records(created_on DESC, map_id, mode);

-- ============================================================================
-- Player Profile Queries
-- ============================================================================

-- Player records lookup with mode filtering
CREATE INDEX IF NOT EXISTS idx_records_player_mode 
ON kz_records(player_id, mode, stage, created_on DESC);

-- Player statistics aggregation
CREATE INDEX IF NOT EXISTS idx_records_player_stats 
ON kz_records(player_id, mode, time, points);

-- ============================================================================
-- Banned Player Filtering Optimization
-- ============================================================================

-- Composite index for efficient banned player lookups in JOINs
CREATE INDEX IF NOT EXISTS idx_players_ban_lookup 
ON kz_players(steamid64, is_banned);

-- For filtering banned players by name
CREATE INDEX IF NOT EXISTS idx_players_name_ban 
ON kz_players(player_name(50), is_banned);

-- ============================================================================
-- Server Statistics
-- ============================================================================

-- Server records count and statistics
CREATE INDEX IF NOT EXISTS idx_records_server_stats 
ON kz_records(server_id, created_on DESC, mode);

-- ============================================================================
-- Map Statistics
-- ============================================================================

-- Map difficulty and validation lookups
CREATE INDEX IF NOT EXISTS idx_maps_stats 
ON kz_maps(validated, difficulty, map_name(50));

-- ============================================================================
-- Covering Indexes for Complex Queries
-- ============================================================================

-- Ultra-wide covering index for player+map combination queries
-- This avoids table lookups for the most common query pattern
CREATE INDEX IF NOT EXISTS idx_records_player_map_covering 
ON kz_records(player_id, map_id, mode, stage, time, teleports, points, created_on);

-- Covering index for world records with all needed fields
CREATE INDEX IF NOT EXISTS idx_records_wr_covering 
ON kz_records(mode, stage, teleports, map_id, time, player_id, points, server_id, created_on);

-- ============================================================================
-- Analyze Tables for Query Optimizer
-- ============================================================================

ANALYZE TABLE kz_records;
ANALYZE TABLE kz_players;
ANALYZE TABLE kz_maps;
ANALYZE TABLE kz_servers;

-- ============================================================================
-- Optional: Drop Redundant Indexes
-- ============================================================================

-- Check for duplicate/redundant indexes before running these:
-- DROP INDEX IF EXISTS idx_records_mode_time ON kz_records;  -- Covered by idx_records_wr_lookup
-- DROP INDEX IF EXISTS idx_records_map_time ON kz_records;   -- Covered by idx_records_map_leaderboard

-- ============================================================================
-- Verification Queries
-- ============================================================================

-- Check index usage (run after migration)
-- SELECT 
--   TABLE_NAME,
--   INDEX_NAME,
--   CARDINALITY,
--   INDEX_TYPE
-- FROM information_schema.STATISTICS
-- WHERE TABLE_SCHEMA = 'kz_records'
--   AND TABLE_NAME IN ('kz_records', 'kz_players', 'kz_maps', 'kz_servers')
-- ORDER BY TABLE_NAME, INDEX_NAME;

-- Verify index sizes
-- SELECT 
--   TABLE_NAME,
--   INDEX_NAME,
--   ROUND(STAT_VALUE * @@innodb_page_size / 1024 / 1024, 2) as size_mb
-- FROM mysql.innodb_index_stats
-- WHERE DATABASE_NAME = 'kz_records'
--   AND TABLE_NAME IN ('kz_records', 'kz_players', 'kz_maps')
--   AND STAT_NAME = 'size'
-- ORDER BY size_mb DESC;
