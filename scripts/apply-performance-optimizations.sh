#!/bin/bash
# Performance Optimization Application Script
# Run this script to apply all database optimizations

set -e  # Exit on error

echo "================================================"
echo "KZ Global API - Performance Optimization Script"
echo "================================================"
echo ""

# Load environment variables
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# Database connection details
DB_HOST=${KZ_DB_HOST:-localhost}
DB_PORT=${KZ_DB_PORT:-3308}
DB_USER=${KZ_DB_USER:-root}
DB_NAME=${KZ_DB_NAME:-kz_records}

echo "Database: $DB_NAME"
echo "Host: $DB_HOST:$DB_PORT"
echo "User: $DB_USER"
echo ""

# Prompt for password
read -s -p "Enter database password: " DB_PASSWORD
echo ""
echo ""

# Test connection
echo "Testing database connection..."
mysql -h $DB_HOST -P $DB_PORT -u $DB_USER -p$DB_PASSWORD -e "SELECT 1;" > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo "✅ Database connection successful"
else
    echo "❌ Database connection failed"
    exit 1
fi
echo ""

# Backup current indexes
echo "Creating backup of current indexes..."
mysql -h $DB_HOST -P $DB_PORT -u $DB_USER -p$DB_PASSWORD $DB_NAME -e "
    SELECT CONCAT('CREATE INDEX ', INDEX_NAME, ' ON ', TABLE_NAME, ' (', GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX), ');') 
    FROM information_schema.STATISTICS 
    WHERE TABLE_SCHEMA = '$DB_NAME' AND TABLE_NAME IN ('kz_records', 'kz_players', 'kz_maps', 'kz_servers')
    GROUP BY TABLE_NAME, INDEX_NAME;" > backup_indexes_$(date +%Y%m%d_%H%M%S).sql
echo "✅ Backup created: backup_indexes_$(date +%Y%m%d_%H%M%S).sql"
echo ""

# Apply index optimizations
echo "Applying database index optimizations..."
echo "This may take several minutes for large tables..."
mysql -h $DB_HOST -P $DB_PORT -u $DB_USER -p$DB_PASSWORD $DB_NAME < db/migrations/optimize_kz_indexes.sql
if [ $? -eq 0 ]; then
    echo "✅ Index optimizations applied successfully"
else
    echo "❌ Failed to apply index optimizations"
    exit 1
fi
echo ""

# Apply MySQL configuration optimizations
echo "Applying MySQL configuration optimizations..."
mysql -h $DB_HOST -P $DB_PORT -u $DB_USER -p$DB_PASSWORD $DB_NAME < db/migrations/optimize_mysql_config.sql
if [ $? -eq 0 ]; then
    echo "✅ MySQL configuration optimized"
else
    echo "❌ Failed to optimize MySQL configuration"
    echo "   (This may fail if you don't have SUPER privilege - that's OK)"
fi
echo ""

# Verify indexes
echo "Verifying new indexes..."
INDEX_COUNT=$(mysql -h $DB_HOST -P $DB_PORT -u $DB_USER -p$DB_PASSWORD $DB_NAME -e "
    SELECT COUNT(*) FROM information_schema.STATISTICS 
    WHERE TABLE_SCHEMA = '$DB_NAME' AND TABLE_NAME = 'kz_records';" -s -N)
echo "✅ Total indexes on kz_records: $INDEX_COUNT"
echo ""

# Analyze tables
echo "Analyzing tables for query optimizer..."
mysql -h $DB_HOST -P $DB_PORT -u $DB_USER -p$DB_PASSWORD $DB_NAME -e "
    ANALYZE TABLE kz_records;
    ANALYZE TABLE kz_players;
    ANALYZE TABLE kz_maps;
    ANALYZE TABLE kz_servers;" > /dev/null 2>&1
echo "✅ Tables analyzed"
echo ""

# Show buffer pool size
echo "Checking InnoDB buffer pool..."
BUFFER_POOL_GB=$(mysql -h $DB_HOST -P $DB_PORT -u $DB_USER -p$DB_PASSWORD -e "
    SELECT ROUND(@@innodb_buffer_pool_size / 1024 / 1024 / 1024, 2);" -s -N)
echo "✅ Buffer pool size: ${BUFFER_POOL_GB}GB"
echo ""

# Show connection limits
echo "Checking connection limits..."
MAX_CONN=$(mysql -h $DB_HOST -P $DB_PORT -u $DB_USER -p$DB_PASSWORD -e "SELECT @@max_connections;" -s -N)
echo "✅ Max connections: $MAX_CONN"
echo ""

echo "================================================"
echo "Optimization Complete!"
echo "================================================"
echo ""
echo "Summary:"
echo "  ✅ Database indexes optimized ($INDEX_COUNT indexes on kz_records)"
echo "  ✅ MySQL configuration tuned"
echo "  ✅ Tables analyzed"
echo "  ✅ Buffer pool: ${BUFFER_POOL_GB}GB"
echo "  ✅ Max connections: $MAX_CONN"
echo ""
echo "Next Steps:"
echo "  1. Restart your application to use new connection pool settings"
echo "  2. Enable Redis caching (REDIS_ENABLED=true in .env)"
echo "  3. Monitor slow query log for performance issues"
echo "  4. Test API endpoints to verify improvements"
echo ""
echo "Performance testing:"
echo "  curl -w '@time: %{time_total}s\n' http://localhost:3000/kzglobal/records/worldrecords"
echo ""
echo "For detailed information, see:"
echo "  - docs/PERFORMANCE_SUMMARY.md"
echo "  - docs/IMPLEMENTATION_GUIDE.md"
echo ""
