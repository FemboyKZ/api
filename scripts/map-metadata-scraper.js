#!/usr/bin/env node
/**
 * Standalone Map Metadata Scraper
 * 
 * Fetches missing map metadata from GlobalKZ API and populates kz_maps table.
 * Runs once to backfill existing maps, then can be run periodically for updates.
 * 
 * Usage:
 *   node scripts/map-metadata-scraper.js [options]
 * 
 * Options:
 *   --batch-size N     Number of maps to process per batch (default: 10)
 *   --delay N          Delay between batches in ms (default: 1000)
 *   --force            Update all maps even if metadata exists
 *   --map-id N         Process specific map_id only
 *   --dry-run          Show what would be done without making changes
 */

require('dotenv').config();
const mysql = require('mysql2/promise');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

// Configuration
const CONFIG = {
  db: {
    host: process.env.KZ_DB_HOST || "localhost",
    port: parseInt(process.env.KZ_DB_PORT) || 3308,
    user: process.env.KZ_DB_USER || "root",
    password: process.env.KZ_DB_PASSWORD || "",
    database: process.env.KZ_DB_NAME || "kz_records",
    charset: 'utf8mb4',
  },
  gokzApiUrl: process.env.GOKZ_API_URL || 'https://kztimerglobal.com/api/v2',
  batchSize: 10,
  delayBetweenBatches: 1000, // 1 second
  requestTimeout: 10000,
  retryAttempts: 3,
  retryDelay: 2000,
  dryRun: false,
  force: false,
  specificMapId: null,
};

// Stats
const stats = {
  startTime: Date.now(),
  mapsProcessed: 0,
  mapsUpdated: 0,
  mapsSkipped: 0,
  mapsNotFound: 0,
  errors: 0,
};

// Database connection
let pool;

// ============================================================================
// LOGGING
// ============================================================================

function log(level, message) {
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${timestamp}] [${level.toUpperCase()}] ${message}`);
}

// ============================================================================
// DATABASE
// ============================================================================

async function initDatabase() {
  log('info', 'Connecting to database...');
  pool = mysql.createPool({
    ...CONFIG.db,
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
  });

  // Test connection
  const connection = await pool.getConnection();
  log('info', `Connected to database: ${CONFIG.db.database}`);
  connection.release();
}

async function getMapsNeedingMetadata() {
  const whereClause = CONFIG.force
    ? '1=1' // All maps
    : 'filesize IS NULL OR validated IS NULL OR difficulty IS NULL'; // Only missing data

  const query = CONFIG.specificMapId
    ? `SELECT id, map_id, map_name FROM kz_maps WHERE map_id = ? LIMIT 1`
    : `SELECT id, map_id, map_name FROM kz_maps WHERE ${whereClause} ORDER BY map_id ASC`;

  const params = CONFIG.specificMapId ? [CONFIG.specificMapId] : [];

  const [rows] = await pool.query(query, params);
  return rows;
}

async function updateMapMetadata(mapDbId, metadata) {
  if (CONFIG.dryRun) {
    log('info', `[DRY RUN] Would update map ID ${mapDbId} with metadata`);
    return;
  }

  const query = `
    UPDATE kz_maps 
    SET 
      filesize = ?,
      validated = ?,
      difficulty = ?,
      approved_by_steamid64 = ?,
      workshop_url = ?,
      download_url = ?,
      global_created_on = ?,
      global_updated_on = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `;

  await pool.query(query, [
    metadata.filesize || null,
    metadata.validated !== undefined ? metadata.validated : null,
    metadata.difficulty || null,
    metadata.approved_by_steamid64 || null,
    metadata.workshop_url || null,
    metadata.download_url || null,
    metadata.created_on || null,
    metadata.updated_on || null,
    mapDbId,
  ]);
}

// ============================================================================
// API FETCHING
// ============================================================================

async function fetchMapMetadata(mapId, attempt = 1) {
  try {
    const url = `${CONFIG.gokzApiUrl}/maps/${mapId}`;
    log('debug', `Fetching map metadata: ${url}`);

    const response = await axios.get(url, {
      timeout: CONFIG.requestTimeout,
    });

    return response.data;
  } catch (error) {
    if (error.response?.status === 404) {
      log('debug', `Map ${mapId} not found in GlobalKZ API (404)`);
      return null;
    }

    if (error.response?.status === 429) {
      log('warn', `Rate limited on map ${mapId}, waiting 60s...`);
      await new Promise(resolve => setTimeout(resolve, 60000));
      if (attempt < CONFIG.retryAttempts) {
        return fetchMapMetadata(mapId, attempt + 1);
      }
      return null;
    }

    // Network errors - retry with backoff
    if (attempt < CONFIG.retryAttempts) {
      const delay = CONFIG.retryDelay * Math.pow(2, attempt - 1);
      log('warn', `Error fetching map ${mapId}, retry ${attempt}/${CONFIG.retryAttempts} in ${delay}ms`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return fetchMapMetadata(mapId, attempt + 1);
    }

    throw error;
  }
}

// ============================================================================
// PROCESSING
// ============================================================================

async function processMap(map) {
  stats.mapsProcessed++;

  try {
    log('info', `Processing map: ${map.map_name} (ID: ${map.map_id})`);

    const metadata = await fetchMapMetadata(map.map_id);

    if (!metadata) {
      log('warn', `No metadata found for map ${map.map_name} (ID: ${map.map_id})`);
      stats.mapsNotFound++;
      return;
    }

    await updateMapMetadata(map.id, metadata);

    log('info', `✓ Updated ${map.map_name}: difficulty=${metadata.difficulty}, validated=${metadata.validated}, size=${metadata.filesize} bytes`);
    stats.mapsUpdated++;
  } catch (error) {
    log('error', `Failed to process map ${map.map_name}: ${error.message}`);
    stats.errors++;
  }
}

async function processBatch(maps) {
  log('info', `Processing batch of ${maps.length} maps...`);

  for (const map of maps) {
    await processMap(map);
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--batch-size' && args[i + 1]) {
      CONFIG.batchSize = parseInt(args[i + 1]);
      i++;
    } else if (args[i] === '--delay' && args[i + 1]) {
      CONFIG.delayBetweenBatches = parseInt(args[i + 1]);
      i++;
    } else if (args[i] === '--force') {
      CONFIG.force = true;
    } else if (args[i] === '--map-id' && args[i + 1]) {
      CONFIG.specificMapId = parseInt(args[i + 1]);
      i++;
    } else if (args[i] === '--dry-run') {
      CONFIG.dryRun = true;
    } else if (args[i] === '--help') {
      console.log(`
Usage: node scripts/map-metadata-scraper.js [options]

Options:
  --batch-size N     Number of maps to process per batch (default: 10)
  --delay N          Delay between batches in ms (default: 1000)
  --force            Update all maps even if metadata exists
  --map-id N         Process specific map_id only
  --dry-run          Show what would be done without making changes
  --help             Show this help message
      `);
      process.exit(0);
    }
  }

  log('info', '======================================================================');
  log('info', 'Map Metadata Scraper');
  log('info', '======================================================================');
  log('info', `Configuration:`);
  log('info', `  Database: ${CONFIG.db.host}:${CONFIG.db.port}/${CONFIG.db.database}`);
  log('info', `  API: ${CONFIG.gokzApiUrl}`);
  log('info', `  Batch size: ${CONFIG.batchSize}`);
  log('info', `  Delay: ${CONFIG.delayBetweenBatches}ms`);
  log('info', `  Mode: ${CONFIG.dryRun ? 'DRY RUN' : 'LIVE'}`);
  log('info', `  Force update: ${CONFIG.force ? 'Yes' : 'No'}`);
  if (CONFIG.specificMapId) {
    log('info', `  Target: Map ID ${CONFIG.specificMapId} only`);
  }
  log('info', '======================================================================');

  try {
    // Initialize
    await initDatabase();

    // Get maps needing metadata
    log('info', 'Fetching maps needing metadata...');
    const maps = await getMapsNeedingMetadata();
    log('info', `Found ${maps.length} map(s) to process`);

    if (maps.length === 0) {
      log('info', 'No maps need updating. Use --force to update all maps.');
      return;
    }

    // Process in batches
    for (let i = 0; i < maps.length; i += CONFIG.batchSize) {
      const batch = maps.slice(i, i + CONFIG.batchSize);
      await processBatch(batch);

      // Delay between batches (except last batch)
      if (i + CONFIG.batchSize < maps.length) {
        log('debug', `Waiting ${CONFIG.delayBetweenBatches}ms before next batch...`);
        await new Promise(resolve => setTimeout(resolve, CONFIG.delayBetweenBatches));
      }
    }

    // Final stats
    const elapsed = ((Date.now() - stats.startTime) / 1000).toFixed(2);
    log('info', '======================================================================');
    log('info', 'Scraper completed!');
    log('info', `  Total processed: ${stats.mapsProcessed}`);
    log('info', `  Updated: ${stats.mapsUpdated}`);
    log('info', `  Skipped: ${stats.mapsSkipped}`);
    log('info', `  Not found: ${stats.mapsNotFound}`);
    log('info', `  Errors: ${stats.errors}`);
    log('info', `  Time elapsed: ${elapsed}s`);
    log('info', `  Rate: ${(stats.mapsProcessed / elapsed).toFixed(2)} maps/s`);
    log('info', '======================================================================');
  } catch (error) {
    log('error', `Fatal error: ${error.message}`);
    log('error', error.stack);
    process.exit(1);
  } finally {
    if (pool) {
      await pool.end();
      log('info', 'Database connection closed');
    }
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  log('info', '\nReceived SIGINT, shutting down gracefully...');
  if (pool) await pool.end();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  log('info', '\nReceived SIGTERM, shutting down gracefully...');
  if (pool) await pool.end();
  process.exit(0);
});

// Run
main().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
