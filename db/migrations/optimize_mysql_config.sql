-- MySQL/MariaDB Configuration Optimization
-- These are runtime settings that can be set via SQL
-- For permanent changes, add to my.cnf or docker-compose.yml environment variables

-- ============================================================================
-- Query Optimization Settings
-- ============================================================================

-- Increase join buffer for complex JOIN operations
SET GLOBAL join_buffer_size = 8388608;  -- 8MB (default: 256KB)

-- Increase sort buffer for ORDER BY operations
SET GLOBAL sort_buffer_size = 8388608;  -- 8MB (default: 256KB)

-- Increase read buffer for sequential scans
SET GLOBAL read_buffer_size = 4194304;  -- 4MB (default: 128KB)

-- Increase read_rnd_buffer for sorted results
SET GLOBAL read_rnd_buffer_size = 8388608;  -- 8MB (default: 256KB)

-- ============================================================================
-- Connection Settings
-- ============================================================================

-- Increase max connections (adjust based on available RAM)
SET GLOBAL max_connections = 200;  -- Default: 151

-- Increase thread cache to reuse threads
SET GLOBAL thread_cache_size = 50;  -- Default: 9

-- Increase table open cache
SET GLOBAL table_open_cache = 4000;  -- Default: 2000

-- Increase table definition cache
SET GLOBAL table_definition_cache = 2000;  -- Default: 400

-- ============================================================================
-- Temporary Table Settings
-- ============================================================================

-- Increase temp table sizes for in-memory operations
SET GLOBAL tmp_table_size = 268435456;  -- 256MB (default: 16MB)
SET GLOBAL max_heap_table_size = 268435456;  -- 256MB (default: 16MB)

-- ============================================================================
-- Query Cache (MySQL 5.7 and earlier - deprecated in 8.0)
-- ============================================================================

-- For MySQL 5.7 users:
-- SET GLOBAL query_cache_type = 1;  -- 0=OFF, 1=ON, 2=DEMAND
-- SET GLOBAL query_cache_size = 67108864;  -- 64MB

-- For MySQL 8.0+: Query cache is removed, use Redis instead
SET GLOBAL query_cache_type = 0;

-- ============================================================================
-- InnoDB Buffer Pool (MOST IMPORTANT SETTING)
-- ============================================================================

-- This is the single most important MySQL setting for performance
-- Set to 50-70% of available RAM on dedicated database server
-- Cannot be changed at runtime - must be in my.cnf
-- Example for 8GB RAM server:
-- SET GLOBAL innodb_buffer_pool_size = 4294967296;  -- 4GB (requires restart)

-- Check current setting:
SELECT @@innodb_buffer_pool_size / 1024 / 1024 / 1024 as buffer_pool_gb;

-- ============================================================================
-- InnoDB Log Settings
-- ============================================================================

-- Larger log files = better write performance but slower crash recovery
-- Cannot be changed at runtime - must be in my.cnf
-- SET GLOBAL innodb_log_file_size = 536870912;  -- 512MB (requires restart)

-- Write to log every second instead of every transaction
SET GLOBAL innodb_flush_log_at_trx_commit = 2;  -- 0=fast but risky, 1=safe but slow, 2=balanced

-- Number of log files
-- SET GLOBAL innodb_log_files_in_group = 2;  -- Default: 2 (requires restart)

-- ============================================================================
-- InnoDB Performance Settings
-- ============================================================================

-- Increase IO capacity for SSDs
SET GLOBAL innodb_io_capacity = 2000;  -- Default: 200 (HDD), use 2000+ for SSDs
SET GLOBAL innodb_io_capacity_max = 4000;  -- Default: 2000

-- Increase read/write threads for parallel operations
SET GLOBAL innodb_read_io_threads = 8;  -- Default: 4
SET GLOBAL innodb_write_io_threads = 8;  -- Default: 4

-- Increase buffer pool instances for better concurrency (must equal buffer_pool_size/1GB)
-- SET GLOBAL innodb_buffer_pool_instances = 4;  -- Default: 1 (requires restart)

-- Flush method (requires restart)
-- SET GLOBAL innodb_flush_method = 'O_DIRECT';  -- Bypass OS cache on Linux

-- ============================================================================
-- Query Optimizer Settings
-- ============================================================================

-- Increase optimizer search depth for complex queries
SET GLOBAL optimizer_search_depth = 10;  -- Default: 62 (auto)

-- Enable index condition pushdown
SET GLOBAL optimizer_switch = 'index_condition_pushdown=on';

-- Enable batched key access
SET GLOBAL optimizer_switch = 'batched_key_access=on';

-- Enable multi-range read optimization
SET GLOBAL optimizer_switch = 'mrr=on';
SET GLOBAL optimizer_switch = 'mrr_cost_based=on';

-- ============================================================================
-- Slow Query Log (for monitoring)
-- ============================================================================

-- Enable slow query log to identify performance bottlenecks
SET GLOBAL slow_query_log = 'ON';
SET GLOBAL long_query_time = 1;  -- Log queries taking > 1 second
SET GLOBAL log_queries_not_using_indexes = 'ON';  -- Log queries without indexes

-- Set slow query log file location
-- SET GLOBAL slow_query_log_file = '/var/log/mysql/mysql-slow.log';

-- ============================================================================
-- Binary Logging (if replication is enabled)
-- ============================================================================

-- Reduce binary log sync frequency for better performance
-- SET GLOBAL sync_binlog = 0;  -- 0=async (fast), 1=sync (safe)

-- ============================================================================
-- Verification & Monitoring
-- ============================================================================

-- Check current settings
SHOW VARIABLES LIKE 'innodb%';
SHOW VARIABLES LIKE 'join_buffer_size';
SHOW VARIABLES LIKE 'sort_buffer_size';
SHOW VARIABLES LIKE 'max_connections';

-- Monitor buffer pool usage
SELECT 
  (SELECT VARIABLE_VALUE FROM information_schema.GLOBAL_STATUS WHERE VARIABLE_NAME='Innodb_buffer_pool_pages_total') * 16384 / 1024 / 1024 as total_mb,
  (SELECT VARIABLE_VALUE FROM information_schema.GLOBAL_STATUS WHERE VARIABLE_NAME='Innodb_buffer_pool_pages_free') * 16384 / 1024 / 1024 as free_mb,
  (SELECT VARIABLE_VALUE FROM information_schema.GLOBAL_STATUS WHERE VARIABLE_NAME='Innodb_buffer_pool_pages_data') * 16384 / 1024 / 1024 as data_mb;

-- Check for table locks and slow queries
SHOW PROCESSLIST;
SHOW ENGINE INNODB STATUS\G

-- ============================================================================
-- NOTES FOR DOCKER/PRODUCTION DEPLOYMENT
-- ============================================================================

-- For persistent configuration, add to docker-compose.yml:
--
-- mysql:
--   environment:
--     MYSQL_INNODB_BUFFER_POOL_SIZE: 4G
--     MYSQL_MAX_CONNECTIONS: 200
--   command:
--     - --innodb-buffer-pool-size=4G
--     - --max-connections=200
--     - --join-buffer-size=8M
--     - --sort-buffer-size=8M
--     - --tmp-table-size=256M
--     - --max-heap-table-size=256M
--     - --innodb-flush-log-at-trx-commit=2
--     - --innodb-io-capacity=2000
--     - --innodb-io-capacity-max=4000
--     - --slow-query-log=1
--     - --long-query-time=1
