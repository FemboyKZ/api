/**
 * KZ Records Scraper Service (Maintenance Mode)
 *
 * Lightweight scraper for keeping records up-to-date after initial bulk import.
 * This runs continuously as part of the API server to catch new records.
 *
 * Features:
 * - Sequential requests with delays to avoid rate limiting
 * - Automatic retry on errors with exponential backoff
 * - Rate limit detection and handling (HTTP 429)
 * - Persistent state tracking (saves last checked ID)
 * - Handles missing data gracefully
 *
 * Configuration (via .env):
 *   KZ_SCRAPER_ENABLED=true           # Enable/disable scraper
 *   KZ_SCRAPER_INTERVAL=3750          # How often to run (ms) - default 3.75s
 *   KZ_SCRAPER_CONCURRENCY=5          # Records per batch - default 5
 *   KZ_SCRAPER_REQUEST_DELAY=100      # Delay between requests (ms) - default 100ms
 *
 * Rate Limiting:
 *   The GlobalKZ API has a rate limit of 500 requests per 5 minutes per IP.
 *
 *   Default configuration (80% utilization):
 *   - 5 records per batch with 100ms delay = ~1.5 seconds per batch
 *   - Running every 3.75 seconds = 80 batches per 5 minutes = 400 requests per 5 min
 *   - Speed: ~4,800 records/hour
 *
 *   This is more than sufficient for maintenance mode (catching new records as they appear).
 *   For bulk scraping, use scripts/standalone-scraper.js with proxy support.
 *
 * Usage:
 *   const scraper = require('./services/kzRecordsScraper');
 *   scraper.startScraperJob(3750); // Check every 3.75 seconds
 */

require("dotenv").config();
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const logger = require("../utils/logger");
const { getKzPool } = require("../db/kzRecords");

// Configuration
const GOKZ_API_URL =
  process.env.GOKZ_API_URL || "https://kztimerglobal.com/api/v2";
const CONCURRENCY = parseInt(process.env.KZ_SCRAPER_CONCURRENCY) || 5;
const RETRY_ATTEMPTS = 3;
const RETRY_DELAY = 2000; // Initial retry delay in ms (exponential backoff)
const REQUEST_DELAY = parseInt(process.env.KZ_SCRAPER_REQUEST_DELAY) || 100;
const STATE_FILE = path.join(__dirname, "../../logs/kz-scraper-state.json");
const REQUEST_TIMEOUT = 10000;

// Caches for normalized data
const playerCache = new Map();
const mapCache = new Map();
const serverCache = new Map();

// State tracking
let isRunning = false;
let currentRecordId = 0;
const stats = {
  startTime: null,
  recordsProcessed: 0,
  recordsInserted: 0,
  recordsSkipped: 0,
  notFoundCount: 0,
  errorCount: 0,
  lastSuccessfulId: 0,
};

/**
 * Load state from file
 */
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
      currentRecordId = state.lastRecordId || 0;
      logger.info(
        `[KZ Scraper] Loaded state: Starting from record ID ${currentRecordId}`,
      );
    } else {
      logger.info(
        `[KZ Scraper] No state file found, will query database for max original_id`,
      );
    }
  } catch (error) {
    logger.error(`[KZ Scraper] Error loading state:`, error);
  }
}

/**
 * Save state to file
 */
function saveState() {
  try {
    // Ensure logs directory exists
    const logsDir = path.dirname(STATE_FILE);
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    const state = {
      lastRecordId: stats.lastSuccessfulId || currentRecordId,
      lastUpdate: new Date().toISOString(),
      stats: {
        recordsProcessed: stats.recordsProcessed,
        recordsInserted: stats.recordsInserted,
        recordsSkipped: stats.recordsSkipped,
      },
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), {
      mode: 0o666, // Make file readable/writable by all
    });
  } catch (error) {
    // Don't crash on save errors - state will be recovered from database on restart
    logger.warn(
      `[KZ Scraper] Failed to save state file (will use DB on restart): ${error.message}`,
    );
  }
}

/**
 * Initialize starting record ID from database
 */
async function initializeRecordId() {
  try {
    const pool = getKzPool();
    const connection = await pool.getConnection();
    try {
      const [rows] = await connection.query(
        "SELECT MAX(original_id) as max_id FROM kz_records WHERE original_id IS NOT NULL",
      );

      if (rows[0].max_id) {
        currentRecordId = rows[0].max_id;
        logger.info(
          `[KZ Scraper] Database max original_id: ${currentRecordId}`,
        );
      } else {
        logger.info(`[KZ Scraper] No records in database, starting from ID 1`);
        currentRecordId = 1;
      }
    } finally {
      connection.release();
    }
  } catch (error) {
    logger.error(`[KZ Scraper] Error querying database for max ID:`, error);
    currentRecordId = 1;
  }
}

/**
 * Sanitize string (same as import script)
 */
function sanitizeString(str, maxLength = 255, defaultValue = "Unknown") {
  if (!str || typeof str !== "string") {
    return defaultValue;
  }

  str = str.trim();
  str = str.replace(/\0/g, "");
  str = str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");

  if (str.length === 0) {
    return defaultValue;
  }

  if (str.length > maxLength) {
    str = str.substring(0, maxLength);
  }

  return str;
}

/**
 * Convert timestamp (same as import script)
 */
function convertTimestamp(isoString) {
  if (!isoString) return "1970-01-01 00:00:01";

  const timestamp = isoString
    .replace("T", " ")
    .replace(/\.\d+Z?$/, "")
    .substring(0, 19);

  const year = parseInt(timestamp.substring(0, 4));
  if (year < 1970) {
    return "1970-01-01 00:00:01";
  }

  if (year > 2038) {
    return "2038-01-19 03:14:07";
  }

  return timestamp;
}

/**
 * Get or create player ID
 */
async function getOrCreatePlayer(connection, record) {
  // Keep steamid64 as string to preserve precision (no parseInt)
  let steamid64 = record.steamid64 ? String(record.steamid64) : null;

  if (!steamid64) {
    const recordId = record.id || Math.floor(Math.random() * 1000000);
    steamid64 = String(999900000000 + recordId);
  }

  const cacheKey = steamid64;

  if (playerCache.has(cacheKey)) {
    return playerCache.get(cacheKey);
  }

  const [rows] = await connection.query(
    "SELECT id FROM kz_players WHERE steamid64 = ?",
    [steamid64],
  );

  if (rows.length > 0) {
    playerCache.set(cacheKey, rows[0].id);
    return rows[0].id;
  }

  const steamId = sanitizeString(
    record.steam_id,
    32,
    `STEAM_ID_MISSING_${steamid64}`,
  );
  const playerName = sanitizeString(
    record.player_name,
    100,
    `Unknown Player (${steamid64})`,
  );

  const [result] = await connection.query(
    "INSERT INTO kz_players (steamid64, steam_id, player_name) VALUES (?, ?, ?)",
    [steamid64, steamId, playerName],
  );

  playerCache.set(cacheKey, result.insertId);
  return result.insertId;
}

/**
 * Get or create map ID
 */
async function getOrCreateMap(connection, record) {
  const mapId =
    record.map_id !== undefined && record.map_id !== null
      ? parseInt(record.map_id)
      : -1;
  const mapName = sanitizeString(record.map_name, 255, "unknown_map");

  const cacheKey = `${mapId}:${mapName}`;

  if (mapCache.has(cacheKey)) {
    return mapCache.get(cacheKey);
  }

  const [rows] = await connection.query(
    "SELECT id FROM kz_maps WHERE map_id = ? AND map_name = ?",
    [mapId, mapName],
  );

  if (rows.length > 0) {
    mapCache.set(cacheKey, rows[0].id);
    return rows[0].id;
  }

  const [result] = await connection.query(
    "INSERT INTO kz_maps (map_id, map_name) VALUES (?, ?)",
    [mapId, mapName],
  );

  mapCache.set(cacheKey, result.insertId);
  return result.insertId;
}

/**
 * Get or create server ID
 */
async function getOrCreateServer(connection, record) {
  const serverId =
    record.server_id !== undefined && record.server_id !== null
      ? parseInt(record.server_id)
      : null;

  if (serverId === null || isNaN(serverId)) {
    const unknownId = -1;
    const cacheKey = unknownId;

    if (serverCache.has(cacheKey)) {
      return serverCache.get(cacheKey);
    }

    const [rows] = await connection.query(
      "SELECT id FROM kz_servers WHERE server_id = ?",
      [unknownId],
    );

    if (rows.length > 0) {
      serverCache.set(cacheKey, rows[0].id);
      return rows[0].id;
    }

    const [result] = await connection.query(
      "INSERT INTO kz_servers (server_id, server_name) VALUES (?, ?)",
      [unknownId, "Unknown Server (Missing ID)"],
    );

    serverCache.set(cacheKey, result.insertId);
    return result.insertId;
  }

  const cacheKey = serverId;

  if (serverCache.has(cacheKey)) {
    return serverCache.get(cacheKey);
  }

  const [rows] = await connection.query(
    "SELECT id FROM kz_servers WHERE server_id = ?",
    [serverId],
  );

  if (rows.length > 0) {
    serverCache.set(cacheKey, rows[0].id);
    return rows[0].id;
  }

  const serverName = sanitizeString(
    record.server_name,
    255,
    `Unknown Server (ID: ${serverId})`,
  );

  const [result] = await connection.query(
    "INSERT INTO kz_servers (server_id, server_name) VALUES (?, ?)",
    [serverId, serverName],
  );

  serverCache.set(cacheKey, result.insertId);
  return result.insertId;
}

/**
 * Fetch record from API with retry logic and rate limit handling
 */
async function fetchRecord(recordId, attempt = 1) {
  try {
    const response = await axios.get(`${GOKZ_API_URL}/records/${recordId}`, {
      timeout: REQUEST_TIMEOUT,
    });

    return response.data;
  } catch (error) {
    if (error.response?.status === 404) {
      // Record doesn't exist - this is expected
      return null;
    }

    if (error.response?.status === 429) {
      // Rate limited - wait longer before retrying
      const rateLimitDelay = 60000; // Wait 1 minute on rate limit
      logger.warn(
        `[KZ Scraper] Rate limited (429) on record ${recordId}, waiting ${rateLimitDelay / 1000}s before retry`,
      );
      await new Promise((resolve) => setTimeout(resolve, rateLimitDelay));

      if (attempt < RETRY_ATTEMPTS) {
        return fetchRecord(recordId, attempt + 1);
      }
      return null; // Skip this record if still rate limited after retries
    }

    if (attempt < RETRY_ATTEMPTS) {
      const delay = RETRY_DELAY * Math.pow(2, attempt - 1);
      logger.warn(
        `[KZ Scraper] Retry ${attempt}/${RETRY_ATTEMPTS} for record ${recordId} after ${delay}ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
      return fetchRecord(recordId, attempt + 1);
    }

    throw error;
  }
}

/**
 * Process and insert a single record
 */
async function processRecord(connection, record) {
  const playerId = await getOrCreatePlayer(connection, record);
  const mapId = await getOrCreateMap(connection, record);
  const serverId = await getOrCreateServer(connection, record);

  const createdOn = convertTimestamp(record.created_on);
  const updatedOn = convertTimestamp(record.updated_on);

  const mode = sanitizeString(record.mode, 32, "kz_timer");
  const stage =
    record.stage !== undefined && record.stage !== null
      ? parseInt(record.stage)
      : 0;
  const time =
    record.time !== undefined && record.time !== null
      ? parseFloat(record.time)
      : 0;
  const teleports =
    record.teleports !== undefined && record.teleports !== null
      ? parseInt(record.teleports)
      : 0;
  const points =
    record.points !== undefined && record.points !== null
      ? parseInt(record.points)
      : 0;
  const tickrate =
    record.tickrate !== undefined && record.tickrate !== null
      ? parseInt(record.tickrate)
      : 128;
  const recordFilterId =
    record.record_filter_id !== undefined && record.record_filter_id !== null
      ? parseInt(record.record_filter_id)
      : 0;
  const replayId =
    record.replay_id !== undefined && record.replay_id !== null
      ? parseInt(record.replay_id)
      : 0;
  const updatedBy =
    record.updated_by !== undefined && record.updated_by !== null
      ? parseInt(record.updated_by)
      : 0;

  // Insert record (use INSERT IGNORE to skip duplicates silently)
  const [result] = await connection.query(
    `INSERT IGNORE INTO kz_records 
        (original_id, player_id, map_id, server_id, mode, stage, time, teleports, points, 
         tickrate, record_filter_id, replay_id, updated_by, created_on, updated_on)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.id,
      playerId,
      mapId,
      serverId,
      mode,
      stage,
      time,
      teleports,
      points,
      tickrate,
      recordFilterId,
      replayId,
      updatedBy,
      createdOn,
      updatedOn,
    ],
  );

  // Return true if a row was inserted, false if it was a duplicate
  return result.affectedRows > 0;
}

/**
 * Scrape a batch of record IDs (sequential with delays)
 */
async function scrapeBatch(startId, batchSize) {
  const pool = getKzPool();
  const connection = await pool.getConnection();

  logger.debug(
    `[KZ Scraper] Starting batch scrape from ID ${startId} to ${startId + batchSize - 1}`,
  );

  try {
    await connection.beginTransaction();

    // Sequential fetching with delays to avoid rate limiting
    const results = [];
    for (let i = 0; i < batchSize; i++) {
      const recordId = startId + i;
      const recordData = await fetchRecord(recordId);
      results.push(recordData);

      // Add delay between requests (except for the last one)
      if (i < batchSize - 1 && REQUEST_DELAY > 0) {
        await new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY));
      }
    }

    let inserted = 0;
    let skipped = 0;
    let notFound = 0;

    for (let i = 0; i < results.length; i++) {
      const recordId = startId + i;
      const recordData = results[i];

      if (!recordData) {
        notFound++;
        stats.notFoundCount++;
        continue;
      }

      try {
        const wasInserted = await processRecord(connection, recordData);
        if (wasInserted) {
          inserted++;
          stats.recordsInserted++;
          stats.lastSuccessfulId = recordId;
        } else {
          skipped++;
          stats.recordsSkipped++;
        }
        stats.recordsProcessed++;
      } catch (error) {
        logger.error(
          `[KZ Scraper] Error processing record ${recordId}: ${error.message}`,
        );
        logger.error(`[KZ Scraper] Stack trace: ${error.stack}`);
        logger.error(`[KZ Scraper] Record data: ${JSON.stringify(recordData)}`);
        stats.errorCount++;
        skipped++;
      }
    }

    await connection.commit();

    return {
      inserted,
      skipped,
      notFound,
      lastId: startId + batchSize - 1,
    };
  } catch (error) {
    await connection.rollback();
    logger.error(`[KZ Scraper] Error in scrapeBatch: ${error.message}`);
    logger.error(`[KZ Scraper] Stack trace: ${error.stack}`);
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Main scraper loop
 */
async function runScraper() {
  if (isRunning) {
    logger.debug(
      "[KZ Scraper] Scraper already running, skipping this iteration",
    );
    return;
  }

  isRunning = true;

  try {
    const batchResult = await scrapeBatch(currentRecordId + 1, CONCURRENCY);

    // If entire batch was 404s, reset to last successful ID and stay there
    if (batchResult.notFound === CONCURRENCY && batchResult.inserted === 0) {
      // All records in batch were not found - we're caught up
      if (stats.lastSuccessfulId > 0) {
        // Reset to last successful ID to keep checking from there
        currentRecordId = stats.lastSuccessfulId;
        logger.debug(
          `[KZ Scraper] All records not found (${CONCURRENCY}/${CONCURRENCY}). ` +
            `Resetting to last successful ID ${currentRecordId} to wait for new records.`,
        );
      } else {
        // No successful records yet, still increment to avoid infinite loop at ID 0
        currentRecordId = batchResult.lastId;
        logger.debug(
          `[KZ Scraper] No records found yet, continuing forward from ID ${currentRecordId}`,
        );
      }
    } else {
      // Normal operation - at least one record found, continue forward
      currentRecordId = batchResult.lastId;
    }

    // Save state after each batch to avoid losing progress
    saveState();

    // Log progress every 10 inserted records or every 100 processed
    if (
      (batchResult.inserted > 0 && stats.recordsInserted % 10 === 0) ||
      stats.recordsProcessed % 100 === 0
    ) {
      const elapsed = (Date.now() - stats.startTime) / 1000;
      const rate =
        elapsed > 0 ? (stats.recordsProcessed / elapsed).toFixed(2) : 0;

      logger.info(
        `[KZ Scraper] Progress: Checked up to ID ${currentRecordId} | ` +
          `Inserted: ${stats.recordsInserted} | Skipped: ${stats.recordsSkipped} | ` +
          `Not Found: ${stats.notFoundCount} | Rate: ${rate} rec/s`,
      );
    }

    // If we found something after being caught up, log it
    if (batchResult.inserted > 0 && batchResult.notFound > 0) {
      logger.info(
        `[KZ Scraper] Found ${batchResult.inserted} new record(s) (${batchResult.notFound} not found in batch)`,
      );
    }
  } catch (error) {
    logger.error(`[KZ Scraper] Error in scraper loop: ${error.message}`);
    logger.error(`[KZ Scraper] Stack trace: ${error.stack}`);
    stats.errorCount++;
  } finally {
    isRunning = false;
  }
}

/**
 * Start the scraper job
 */
async function startScraperJob(intervalMs = 3750) {
  // 3.75 seconds for 80% rate limit utilization
  logger.info(
    `[KZ Scraper] Starting KZ Records scraper service (interval: ${intervalMs}ms, concurrency: ${CONCURRENCY}, request delay: ${REQUEST_DELAY}ms)`,
  );
  logger.info(
    `[KZ Scraper] Estimated rate: ~${Math.floor((300 / (intervalMs / 1000)) * CONCURRENCY)} requests per 5 minutes (limit: 500)`,
  );

  // Test database connection first
  try {
    const pool = getKzPool();
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
    logger.info("[KZ Scraper] Database connection verified successfully");
  } catch (error) {
    logger.error(
      `[KZ Scraper] Failed to connect to KZ database: ${error.message}`,
    );
    logger.error("[KZ Scraper] Scraper will not start");
    return;
  }

  // Initialize state
  stats.startTime = Date.now();
  loadState();

  // Initialize record ID from database if not loaded from state
  if (currentRecordId === 0) {
    await initializeRecordId();
    logger.info(`[KZ Scraper] Initialization complete, starting scraper`);
  }

  // Run immediately, then on interval
  setTimeout(() => {
    runScraper();
    setInterval(runScraper, intervalMs);
  }, 2000); // Small delay to let server initialize
}

/**
 * Get current scraper statistics
 */
function getStats() {
  const uptime = stats.startTime ? (Date.now() - stats.startTime) / 1000 : 0;
  const rate = uptime > 0 ? Math.round(stats.recordsProcessed / uptime) : 0;

  return {
    isRunning,
    currentRecordId,
    uptime: Math.round(uptime),
    recordsProcessed: stats.recordsProcessed,
    recordsInserted: stats.recordsInserted,
    recordsSkipped: stats.recordsSkipped,
    notFoundCount: stats.notFoundCount,
    errorCount: stats.errorCount,
    lastSuccessfulId: stats.lastSuccessfulId,
    averageRate: rate,
    cacheSize: {
      players: playerCache.size,
      maps: mapCache.size,
      servers: serverCache.size,
    },
  };
}

module.exports = {
  startScraperJob,
  getStats,
};
