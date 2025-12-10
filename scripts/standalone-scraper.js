#!/usr/bin/env node
/**
 * Standalone KZ Records Scraper
 *
 * This script runs independently from the main API server.
 * Useful for dedicated scraping or running on a separate machine.
 *
 * Features:
 * - Proxy rotation support
 * - Parallel fetching with multiple proxies
 * - Progress tracking and statistics
 * - Graceful shutdown
 * - Resume from last position
 *
 * Usage:
 *   node scripts/standalone-scraper.js
 *
 * Configuration via .env:
 *   KZ_SCRAPER_CONCURRENCY=34
 *   KZ_SCRAPER_INTERVAL=2500
 *   KZ_SCRAPER_REQUEST_DELAY=0
 *   KZ_SCRAPER_PROXIES=proxy1,proxy2,proxy3
 *
 * Or via command line:
 *   node scripts/standalone-scraper.js --concurrency 50 --interval 2000 --final-id 25000000
 */

require("dotenv").config();
const axios = require("axios");
const { HttpsProxyAgent } = require("https-proxy-agent");
const { HttpProxyAgent } = require("http-proxy-agent");
const fs = require("fs").promises;
const path = require("path");
const mysql = require("mysql2/promise");

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  // Database connection
  db: {
    host: process.env.KZ_DB_HOST || "localhost",
    port: parseInt(process.env.KZ_DB_PORT) || 3308,
    user: process.env.KZ_DB_USER || "root",
    password: process.env.KZ_DB_PASSWORD || "",
    database: process.env.KZ_DB_NAME || "kz_records",
    connectionLimit: 20, // Increased from 10 for better parallel performance
    waitForConnections: true,
    queueLimit: 0,
    multipleStatements: true, // Allow batch operations
  },

  // API settings
  apiUrl: process.env.GOKZ_API_URL || "https://kztimerglobal.com/api/v2",
  requestTimeout: 10000, // 10 seconds

  // Scraper settings (can be overridden by command line args)
  concurrency: parseInt(process.env.KZ_SCRAPER_CONCURRENCY) || 34,
  interval: parseInt(process.env.KZ_SCRAPER_INTERVAL) || 2500,
  requestDelay: parseInt(process.env.KZ_SCRAPER_REQUEST_DELAY) || 0,

  // Proxy settings
  proxies: process.env.KZ_SCRAPER_PROXIES
    ? process.env.KZ_SCRAPER_PROXIES.split(",")
        .map((p) => p.trim())
        .filter(Boolean)
    : [],

  // State file
  stateFile: path.join(__dirname, "../logs/standalone-scraper-state.json"),

  // Retry settings
  retryAttempts: 3,
  retryDelay: 2500,
};

// Parse command line arguments
process.argv.slice(2).forEach((arg, i, args) => {
  if (arg === "--concurrency" && args[i + 1])
    CONFIG.concurrency = parseInt(args[i + 1]);
  if (arg === "--interval" && args[i + 1])
    CONFIG.interval = parseInt(args[i + 1]);
  if (arg === "--delay" && args[i + 1])
    CONFIG.requestDelay = parseInt(args[i + 1]);
  if (arg === "--start-id" && args[i + 1])
    CONFIG.startId = parseInt(args[i + 1]);
  if (arg === "--final-id" && args[i + 1])
    CONFIG.finalId = parseInt(args[i + 1]);
});

// ============================================================================
// GLOBAL STATE
// ============================================================================

let pool = null;
let currentRecordId = CONFIG.startId || 0;
let currentProxyIndex = 0;
let isRunning = false;
let shouldStop = false;

const proxyAgents = [];
const stats = {
  startTime: Date.now(),
  recordsProcessed: 0,
  recordsInserted: 0,
  recordsSkipped: 0,
  notFoundCount: 0,
  errorCount: 0,
  lastSuccessfulId: 0,
  rateLimitCount: 0,
};

// Note: These caches are NOT used by batch operations
// Batch operations fetch all players/maps/servers in bulk per batch
// These are kept for compatibility but have no performance impact on batch mode

// ============================================================================
// LOGGING
// ============================================================================

function log(level, message, data = null) {
  const timestamp = new Date().toISOString().replace("T", " ").slice(0, 19);
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;

  if (data) {
    console.log(`${prefix} ${message}`, data);
  } else {
    console.log(`${prefix} ${message}`);
  }
}

function logProgress() {
  const elapsed = Date.now() - stats.startTime;
  const elapsedSeconds = Math.floor(elapsed / 1000);
  const rate =
    elapsedSeconds > 0
      ? (stats.recordsProcessed / elapsedSeconds).toFixed(2)
      : "0.00";

  log(
    "info",
    `Progress: ID ${currentRecordId} | ` +
      `Inserted: ${stats.recordsInserted} | ` +
      `Skipped: ${stats.recordsSkipped} | ` +
      `Not Found: ${stats.notFoundCount} | ` +
      `Errors: ${stats.errorCount} | ` +
      `Rate: ${rate} rec/s`,
  );
}

// ============================================================================
// PROXY SETUP
// ============================================================================

function setupProxies() {
  if (CONFIG.proxies.length > 0) {
    log("info", `Setting up ${CONFIG.proxies.length} proxies...`);

    CONFIG.proxies.forEach((proxyUrl, index) => {
      try {
        const httpsAgent = new HttpsProxyAgent(proxyUrl);
        const httpAgent = new HttpProxyAgent(proxyUrl);
        proxyAgents.push({ proxyUrl, httpsAgent, httpAgent });
        log("info", `Proxy ${index + 1}: ${proxyUrl}`);
      } catch (error) {
        log(
          "error",
          `Failed to create agent for proxy ${proxyUrl}: ${error.message}`,
        );
      }
    });

    if (proxyAgents.length === 0) {
      log("warn", "No valid proxies configured, using direct connection");
    } else {
      log(
        "info",
        `${proxyAgents.length} proxies ready - will use parallel fetching`,
      );
    }
  } else {
    log(
      "info",
      "No proxies configured - using direct connection with sequential fetching",
    );
  }
}

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

async function loadState() {
  try {
    const data = await fs.readFile(CONFIG.stateFile, "utf8");
    const state = JSON.parse(data);
    currentRecordId = state.currentRecordId || 0;
    log("info", `Loaded state from file: Starting at ID ${currentRecordId}`);
    return state;
  } catch (error) {
    if (error.code === "ENOENT") {
      log("info", "No state file found, querying database for max ID...");
      try {
        const [rows] = await pool.query(
          "SELECT MAX(original_id) as max_id FROM kz_records",
        );
        currentRecordId = (rows[0]?.max_id || 0) + 1;
        log("info", `Starting from ID ${currentRecordId} (max in DB + 1)`);
      } catch (dbError) {
        log(
          "error",
          `Failed to query max ID from database: ${dbError.message}`,
        );
        currentRecordId = 1;
        log("info", `Starting from ID 1`);
      }
    } else {
      log("error", `Failed to load state: ${error.message}`);
      currentRecordId = 1;
    }
  }
}

async function saveState() {
  const state = {
    currentRecordId,
    lastSaved: new Date().toISOString(),
    stats: {
      recordsProcessed: stats.recordsProcessed,
      recordsInserted: stats.recordsInserted,
      recordsSkipped: stats.recordsSkipped,
      notFoundCount: stats.notFoundCount,
      errorCount: stats.errorCount,
      lastSuccessfulId: stats.lastSuccessfulId,
    },
  };

  try {
    const dir = path.dirname(CONFIG.stateFile);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(CONFIG.stateFile, JSON.stringify(state, null, 2));
  } catch (error) {
    log("warn", `Failed to save state: ${error.message}`);
  }
}

// ============================================================================
// API FETCHING
// ============================================================================

async function fetchRecord(recordId, attempt = 1) {
  try {
    const config = {
      timeout: CONFIG.requestTimeout,
    };

    // Rotate through proxy agents if configured
    if (proxyAgents.length > 0) {
      const agent = proxyAgents[currentProxyIndex];
      if (CONFIG.apiUrl.startsWith("https")) {
        config.httpsAgent = agent.httpsAgent;
      } else if (CONFIG.apiUrl.startsWith("http:")) {
        config.httpAgent = agent.httpAgent;
      }

      // Move to next proxy for next request (round-robin)
      currentProxyIndex = (currentProxyIndex + 1) % proxyAgents.length;
    }

    const response = await axios.get(
      `${CONFIG.apiUrl}/records/${recordId}`,
      config,
    );

    return response.data;
  } catch (error) {
    if (error.response?.status === 404) {
      return null; // Record doesn't exist
    }

    if (error.response?.status === 429) {
      stats.rateLimitCount++;
      const rateLimitDelay = 60000; // Wait 1 minute on rate limit
      log(
        "warn",
        `Rate limited (429) on record ${recordId}, waiting ${rateLimitDelay / 1000}s before retry. ` +
          `Total rate limits: ${stats.rateLimitCount}`,
      );
      await new Promise((resolve) => setTimeout(resolve, rateLimitDelay));

      if (attempt < CONFIG.retryAttempts) {
        return fetchRecord(recordId, attempt + 1);
      }
      return null;
    }

    if (attempt < CONFIG.retryAttempts) {
      const delay = CONFIG.retryDelay * Math.pow(2, attempt - 1);
      log(
        "warn",
        `Retry ${attempt}/${CONFIG.retryAttempts} for record ${recordId} after ${delay}ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
      return fetchRecord(recordId, attempt + 1);
    }

    throw error;
  }
}

// ============================================================================
// DATABASE OPERATIONS
// ============================================================================

function fixTimestamp(timestamp) {
  if (!timestamp) return null;
  const year = parseInt(timestamp.substring(0, 4));
  if (year > 2038) return "2038-01-19 03:14:07";
  return timestamp;
}

// Old individual lookup functions removed - batch operations handle this now

// ============================================================================
// BATCH SCRAPING
// ============================================================================

async function scrapeBatch(startId, batchSize) {
  // With multiple proxies, fetch in parallel WITHOUT transaction overhead
  const shouldFetchParallel = proxyAgents.length >= 2;

  let results;
  if (shouldFetchParallel) {
    // Parallel fetching - each proxy handles rate limit independently
    const promises = [];
    for (let i = 0; i < batchSize; i++) {
      const recordId = startId + i;
      promises.push(fetchRecord(recordId));
    }
    results = await Promise.all(promises);
  } else {
    // Sequential fetching with delays (single IP)
    results = [];
    for (let i = 0; i < batchSize; i++) {
      const recordId = startId + i;
      const recordData = await fetchRecord(recordId);
      results.push(recordData);

      if (i < batchSize - 1 && CONFIG.requestDelay > 0) {
        await new Promise((resolve) =>
          setTimeout(resolve, CONFIG.requestDelay),
        );
      }
    }
  }

  let inserted = 0;
  let skipped = 0;
  let notFound = 0;

  // Filter out null results
  const validRecords = results.filter((r, i) => {
    if (!r) {
      notFound++;
      stats.notFoundCount++;
      return false;
    }
    return true;
  });

  if (validRecords.length === 0) {
    return { inserted, skipped, notFound, lastId: startId + batchSize - 1 };
  }

  const connection = await pool.getConnection();
  try {
    // Step 1: Batch ensure all players exist
    const uniquePlayers = new Map();
    for (const record of validRecords) {
      // Store steamid64 as string to preserve precision
      const steamid64Str = String(record.steamid64);
      uniquePlayers.set(steamid64Str, {
        steamid64: steamid64Str,
        steam_id: record.steam_id || null,
        player_name: record.player_name || "Unknown",
      });
    }

    if (uniquePlayers.size > 0) {
      // Insert steamid64 as strings (works for both BIGINT and VARCHAR columns)
      const playerValues = Array.from(uniquePlayers.values())
        .map(
          (p) =>
            `(${connection.escape(p.steamid64)}, ${connection.escape(p.steam_id)}, ${connection.escape(p.player_name)})`,
        )
        .join(",");

      await connection.query(
        `INSERT IGNORE INTO kz_players (steamid64, steam_id, player_name) VALUES ${playerValues}`,
      );
    }

    // Step 2: Batch ensure all maps exist
    const uniqueMaps = new Map();
    for (const record of validRecords) {
      uniqueMaps.set(record.map_id, {
        map_id: record.map_id,
        map_name: record.map_name,
      });
    }

    if (uniqueMaps.size > 0) {
      const mapValues = Array.from(uniqueMaps.values())
        .map(
          (m) =>
            `(${connection.escape(m.map_id)}, ${connection.escape(m.map_name)})`,
        )
        .join(",");

      await connection.query(
        `INSERT IGNORE INTO kz_maps (map_id, map_name) VALUES ${mapValues}`,
      );
    }

    // Step 3: Batch ensure all servers exist
    const uniqueServers = new Map();
    for (const record of validRecords) {
      uniqueServers.set(record.server_id, {
        server_id: record.server_id,
        server_name: record.server_name,
      });
    }

    if (uniqueServers.size > 0) {
      const serverValues = Array.from(uniqueServers.values())
        .map(
          (s) =>
            `(${connection.escape(s.server_id)}, ${connection.escape(s.server_name)})`,
        )
        .join(",");

      await connection.query(
        `INSERT IGNORE INTO kz_servers (server_id, server_name) VALUES ${serverValues}`,
      );
    }

    // Step 4: Fetch all player/map/server IDs in one query each
    const steamIdList = Array.from(uniquePlayers.keys())
      .map((id) => connection.escape(id))
      .join(",");
    const [playerRows] = await connection.query(
      `SELECT id, steamid64 FROM kz_players WHERE steamid64 IN (${steamIdList})`,
    );
    // Map uses string keys for consistent lookup
    const playerIdMap = new Map(
      playerRows.map((r) => [String(r.steamid64), r.id]),
    );

    const [mapRows] = await connection.query(
      `SELECT id, map_id FROM kz_maps WHERE map_id IN (${Array.from(
        uniqueMaps.keys(),
      )
        .map((id) => connection.escape(id))
        .join(",")})`,
    );
    const mapIdMap = new Map(mapRows.map((r) => [r.map_id, r.id]));

    const [serverRows] = await connection.query(
      `SELECT id, server_id FROM kz_servers WHERE server_id IN (${Array.from(
        uniqueServers.keys(),
      )
        .map((id) => connection.escape(id))
        .join(",")})`,
    );
    const serverIdMap = new Map(serverRows.map((r) => [r.server_id, r.id]));

    // Step 5: Batch insert all records at once
    const recordValues = [];
    for (const record of validRecords) {
      const steamid64Str = String(record.steamid64);
      const playerId = playerIdMap.get(steamid64Str);
      const mapId = mapIdMap.get(record.map_id);
      const serverId = serverIdMap.get(record.server_id);

      if (!playerId || !mapId || !serverId) {
        log(
          "warn",
          `Missing ID for record ${record.id}: player=${playerId} (steamid64=${steamid64Str}), map=${mapId}, server=${serverId}`,
        );
        skipped++;
        continue;
      }

      recordValues.push(
        `(${connection.escape(record.id)}, ${playerId}, ${mapId}, ${serverId}, ` +
          `${connection.escape(record.mode || "kz_timer")}, ` +
          `${parseInt(record.stage) || 0}, ` +
          `${parseFloat(record.time) || 0}, ` +
          `${parseInt(record.teleports) || 0}, ` +
          `${parseInt(record.points) || 0}, ` +
          `${parseInt(record.tickrate) || 128}, ` +
          `${parseInt(record.record_filter_id) || 0}, ` +
          `${parseInt(record.replay_id) || 0}, ` +
          `${parseInt(record.updated_by) || 0}, ` +
          `${connection.escape(fixTimestamp(record.created_on))}, ` +
          `${connection.escape(fixTimestamp(record.updated_on))})`,
      );
    }

    if (recordValues.length > 0) {
      const [result] = await connection.query(
        `INSERT IGNORE INTO kz_records (
          original_id, player_id, map_id, server_id, mode, stage,
          time, teleports, points, tickrate, record_filter_id, replay_id,
          updated_by, created_on, updated_on
        ) VALUES ${recordValues.join(",")}`,
      );

      inserted = result.affectedRows;
      stats.recordsInserted += inserted;
      stats.lastSuccessfulId = startId + batchSize - 1;
      stats.recordsProcessed += validRecords.length;
      skipped = validRecords.length - inserted;
      stats.recordsSkipped += skipped;
    }
  } catch (error) {
    log("error", `Batch processing error: ${error.message}`);
    stats.errorCount++;
    throw error;
  } finally {
    connection.release();
  }

  return { inserted, skipped, notFound, lastId: startId + batchSize - 1 };
}

// ============================================================================
// MAIN LOOP
// ============================================================================

async function mainLoop() {
  log("info", "=".repeat(70));
  log("info", "Starting scraper loop...");
  log(
    "info",
    `Configuration: Concurrency=${CONFIG.concurrency}, Interval=${CONFIG.interval}ms`,
  );
  log(
    "info",
    `Proxies: ${proxyAgents.length > 0 ? proxyAgents.length + " (parallel mode)" : "None (sequential mode)"}`,
  );
  if (CONFIG.finalId) {
    log("info", `Final ID: ${CONFIG.finalId} (will stop when reached)`);
  }
  log("info", "=".repeat(70));

  while (!shouldStop) {
    isRunning = true;

    // Check if we've reached the final ID
    if (CONFIG.finalId && currentRecordId > CONFIG.finalId) {
      log("info", `Reached final ID ${CONFIG.finalId}. Stopping scraper...`);
      shouldStop = true;
      break;
    }

    try {
      // Adjust batch size if approaching final ID
      let batchSize = CONFIG.concurrency;
      if (CONFIG.finalId && currentRecordId + batchSize > CONFIG.finalId) {
        batchSize = CONFIG.finalId - currentRecordId + 1;
        log("info", `Adjusting final batch size to ${batchSize} records`);
      }

      const result = await scrapeBatch(currentRecordId, batchSize);
      currentRecordId = result.lastId + 1;

      logProgress();

      // Save state periodically
      if (stats.recordsProcessed % 100 === 0) {
        await saveState();
      }

      // Wait before next batch (unless we're done)
      if (!CONFIG.finalId || currentRecordId <= CONFIG.finalId) {
        await new Promise((resolve) => setTimeout(resolve, CONFIG.interval));
      }
    } catch (error) {
      log("error", `Error in main loop: ${error.message}`);
      stats.errorCount++;

      // Back off on errors
      await new Promise((resolve) => setTimeout(resolve, CONFIG.interval * 2));
    }
  }

  isRunning = false;
  log("info", "Scraper loop stopped");
}

// ============================================================================
// INITIALIZATION & SHUTDOWN
// ============================================================================

async function initialize() {
  console.log("\n" + "=".repeat(70));
  console.log("KZ Records Standalone Scraper");
  console.log("=".repeat(70));

  // Setup proxies
  setupProxies();

  // Connect to database
  log("info", "Connecting to database...");
  pool = mysql.createPool(CONFIG.db);

  try {
    const connection = await pool.getConnection();
    log("info", "Database connected successfully");
    connection.release();
  } catch (error) {
    log("error", `Database connection failed: ${error.message}`);
    process.exit(1);
  }

  // Load state
  await loadState();

  log("info", "Initialization complete");
  console.log("=".repeat(70) + "\n");
}

async function shutdown() {
  if (isRunning) {
    log("info", "Shutdown signal received, stopping scraper...");
    shouldStop = true;

    // Wait for current batch to finish
    let attempts = 0;
    while (isRunning && attempts < 30) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      attempts++;
    }
  }

  // Save final state
  await saveState();

  // Print final statistics
  const elapsed = Date.now() - stats.startTime;
  const elapsedMinutes = Math.floor(elapsed / 60000);
  const avgRate =
    elapsedMinutes > 0
      ? Math.floor(stats.recordsProcessed / elapsedMinutes)
      : 0;

  console.log("\n" + "=".repeat(70));
  console.log("Final Statistics");
  console.log("=".repeat(70));
  log("info", `Total processed: ${stats.recordsProcessed}`);
  log("info", `Inserted: ${stats.recordsInserted}`);
  log("info", `Skipped: ${stats.recordsSkipped}`);
  log("info", `Not found: ${stats.notFoundCount}`);
  log("info", `Errors: ${stats.errorCount}`);
  log("info", `Rate limits: ${stats.rateLimitCount}`);
  log("info", `Last successful ID: ${stats.lastSuccessfulId}`);
  log("info", `Average rate: ${avgRate} records/min`);
  log("info", `Runtime: ${elapsedMinutes} minutes`);
  console.log("=".repeat(70) + "\n");

  // Close database
  if (pool) {
    await pool.end();
    log("info", "Database connection closed");
  }

  process.exit(0);
}

// ============================================================================
// SIGNAL HANDLERS
// ============================================================================

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// ============================================================================
// START
// ============================================================================

(async () => {
  try {
    await initialize();
    await mainLoop();
  } catch (error) {
    log("error", `Fatal error: ${error.message}`);
    console.error(error);
    process.exit(1);
  }
})();
