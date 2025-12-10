#!/usr/bin/env node
/**
 * Standalone Bans Scraper
 *
 * Fetches ban data from GlobalKZ API and updates kz_bans table.
 * - Adds new bans
 * - Updates existing bans (expiration, notes, etc.)
 *
 * API Endpoint: GET https://kztimerglobal.com/api/v2/bans?limit=1000&offset=0
 *
 * Response format:
 * [
 *   {
 *     "id": 123,
 *     "ban_type": "cheating",
 *     "expires_on": "2025-11-09T18:14:57.736Z",
 *     "ip": "192.168.1.1",
 *     "steamid64": 76561198123456789,
 *     "player_name": "PlayerName",
 *     "steam_id": "STEAM_1:1:12345678",
 *     "notes": "Ban reason details",
 *     "stats": "Additional stats",
 *     "server_id": 1279,
 *     "updated_by_id": 76561198987654321,
 *     "created_on": "2025-01-01T10:00:00Z",
 *     "updated_on": "2025-01-02T15:30:00Z"
 *   }
 * ]
 *
 * Features:
 * - Batch processing with pagination
 * - Proxy rotation support
 * - Updates existing bans
 * - Adds new bans
 * - Progress tracking
 * - Graceful shutdown
 *
 * Usage:
 *   node scripts/bans-scraper.js [options]
 *
 * Options:
 *   --batch-size N    Number of bans to fetch per batch (default: 1000, max: 1000)
 *   --delay N         Delay between batches in milliseconds (default: 1000)
 *   --offset N        Starting offset for pagination (default: 0)
 *   --force           Update all bans even if they exist
 *   --dry-run         Show what would be done without making changes
 *   --help            Show this help message
 *
 * Configuration via .env:
 *   KZ_SCRAPER_PROXIES=proxy1,proxy2,proxy3
 */

require("dotenv").config();
const axios = require("axios");
const mysql = require("mysql2/promise");
const { HttpsProxyAgent } = require("https-proxy-agent");
const { HttpProxyAgent } = require("http-proxy-agent");

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
    charset: "utf8mb4",
  },

  // API settings
  apiUrl: process.env.GOKZ_API_URL || "https://kztimerglobal.com/api/v2",
  requestTimeout: 30000,

  // Scraper settings
  batchSize: 1000, // API max limit
  delayBetweenBatches: 1000,
  retryAttempts: 3,
  retryDelay: 2000,
  force: false,
  dryRun: false,
  startOffset: 0,

  // Proxy settings
  proxies: process.env.KZ_SCRAPER_PROXIES
    ? process.env.KZ_SCRAPER_PROXIES.split(",")
        .map((p) => p.trim())
        .filter(Boolean)
    : [],
};

// Parse command line arguments
process.argv.slice(2).forEach((arg, i, args) => {
  if (arg === "--batch-size" && args[i + 1])
    CONFIG.batchSize = Math.min(parseInt(args[i + 1]), 1000);
  if (arg === "--delay" && args[i + 1])
    CONFIG.delayBetweenBatches = parseInt(args[i + 1]);
  if (arg === "--offset" && args[i + 1])
    CONFIG.startOffset = parseInt(args[i + 1]);
  if (arg === "--force") CONFIG.force = true;
  if (arg === "--dry-run") CONFIG.dryRun = true;
  if (arg === "--help") {
    console.log(`
Bans Scraper

Fetches ban data from GlobalKZ API and updates kz_bans table.

Usage:
  node scripts/bans-scraper.js [options]

Options:
  --batch-size N    Number of bans per batch (default: 1000, max: 1000)
  --delay N         Delay between batches in milliseconds (default: 1000)
  --offset N        Starting offset for pagination (default: 0)
  --force           Update all bans even if they exist
  --dry-run         Show what would be done without making changes
  --help            Show this help message

Examples:
  # Fetch and update all bans
  node scripts/bans-scraper.js

  # Start from offset 100
  node scripts/bans-scraper.js --offset 100

  # Dry run to see what would be updated
  node scripts/bans-scraper.js --dry-run

  # Force update all bans
  node scripts/bans-scraper.js --force

  # Custom batch size and delay
  node scripts/bans-scraper.js --batch-size 500 --delay 2000
    `);
    process.exit(0);
  }
});

// ============================================================================
// GLOBAL STATE
// ============================================================================

let connection = null;
let shouldStop = false;
let currentProxyIndex = 0;

const proxyAgents = [];
const stats = {
  startTime: Date.now(),
  bansProcessed: 0,
  bansInserted: 0,
  bansUpdated: 0,
  bansSkipped: 0,
  errorCount: 0,
};

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
      log("info", `${proxyAgents.length} proxies ready for rotation`);
    }
  } else {
    log("info", "No proxies configured - using direct connection");
  }
}

/**
 * Get next proxy agent in rotation
 */
function getNextProxy() {
  if (proxyAgents.length === 0) {
    return null;
  }

  const proxy = proxyAgents[currentProxyIndex];
  currentProxyIndex = (currentProxyIndex + 1) % proxyAgents.length;
  return proxy;
}

// ============================================================================
// DATABASE FUNCTIONS
// ============================================================================

/**
 * Connect to database
 */
async function connectDatabase() {
  try {
    connection = await mysql.createConnection(CONFIG.db);
    log("info", `Connected to database: ${CONFIG.db.database}`);
    return connection;
  } catch (error) {
    log("error", `Failed to connect to database: ${error.message}`);
    throw error;
  }
}

/**
 * Convert ISO 8601 datetime string to MySQL DATETIME format
 */
function formatDateTime(isoString) {
  if (!isoString) return null;
  try {
    const date = new Date(isoString);
    return date.toISOString().slice(0, 19).replace("T", " ");
  } catch (error) {
    return null;
  }
}

/**
 * Batch upsert bans (more efficient for large batches)
 */
async function batchUpsertBans(bans) {
  if (CONFIG.dryRun) {
    bans.forEach((ban) => {
      log(
        "info",
        `[DRY RUN] Would upsert ban ${ban.id}: type=${ban.ban_type}, player=${ban.player_name} (${ban.steamid64})`,
      );
    });
    return { inserted: 0, updated: bans.length };
  }

  if (bans.length === 0) {
    return { inserted: 0, updated: 0 };
  }

  try {
    // Build batch INSERT ... ON DUPLICATE KEY UPDATE
    const query = `
      INSERT INTO kz_bans (
        id, ban_type, expires_on, ip, steamid64, player_name, steam_id,
        notes, stats, server_id, updated_by_id, created_on, updated_on
      ) VALUES ?
      ON DUPLICATE KEY UPDATE
        ban_type = VALUES(ban_type),
        expires_on = VALUES(expires_on),
        ip = VALUES(ip),
        steamid64 = VALUES(steamid64),
        player_name = VALUES(player_name),
        steam_id = VALUES(steam_id),
        notes = VALUES(notes),
        stats = VALUES(stats),
        server_id = VALUES(server_id),
        updated_by_id = VALUES(updated_by_id),
        updated_on = VALUES(updated_on),
        updated_at = CURRENT_TIMESTAMP
    `;

    const values = bans.map((ban) => [
      ban.id,
      ban.ban_type || "none",
      formatDateTime(ban.expires_on),
      ban.ip || null,
      ban.steamid64 ? String(ban.steamid64) : null, // Convert to string for precision
      ban.player_name || null,
      ban.steam_id || null,
      ban.notes || null,
      ban.stats || null,
      ban.server_id || null,
      ban.updated_by_id ? String(ban.updated_by_id) : null, // Convert to string
      formatDateTime(ban.created_on),
      formatDateTime(ban.updated_on),
    ]);

    const [result] = await connection.query(query, [values]);

    // MySQL affectedRows behavior with ON DUPLICATE KEY UPDATE:
    // - INSERT: affectedRows = 1
    // - UPDATE (with changes): affectedRows = 2
    // - UPDATE (no changes): affectedRows = 0
    //
    // For batch inserts, if all are new: affectedRows = bans.length
    // For batch with mix: affectedRows = inserts + (updates * 2)
    //
    // We can't perfectly distinguish inserts vs updates from affectedRows alone,
    // but we can estimate: if affectedRows == bans.length, likely all inserts
    const totalBans = bans.length;
    let inserted, updated;

    if (result.affectedRows === totalBans) {
      // All rows were inserted (no duplicates)
      inserted = totalBans;
      updated = 0;
    } else if (result.affectedRows > totalBans) {
      // Some updates occurred (affectedRows = 2 per update)
      // Formula: affectedRows = inserts + (updates * 2)
      // And: inserts + updates = totalBans
      // Solving: inserts = (2 * totalBans) - affectedRows
      inserted = 2 * totalBans - result.affectedRows;
      updated = totalBans - inserted;
    } else {
      // affectedRows < totalBans means some updates had no changes
      // This is ambiguous, so we'll report conservatively
      inserted = 0;
      updated = totalBans;
    }

    return { inserted, updated };
  } catch (error) {
    log("error", `Failed to batch upsert bans: ${error.message}`);
    throw error;
  }
}

// ============================================================================
// API FUNCTIONS
// ============================================================================

/**
 * Fetch bans from API with pagination
 */
async function fetchBans(limit, offset, attempt = 1) {
  try {
    const url = `${CONFIG.apiUrl}/bans?limit=${limit}&offset=${offset}`;

    // Get proxy if available
    const proxy = getNextProxy();
    const axiosConfig = {
      timeout: CONFIG.requestTimeout,
      headers: {
        "User-Agent": "KZ-Records-Scraper/1.0",
      },
    };

    if (proxy) {
      axiosConfig.httpsAgent = proxy.httpsAgent;
      axiosConfig.httpAgent = proxy.httpAgent;
      log("info", `Fetching: ${url} (via proxy ${currentProxyIndex})`);
    } else {
      log("info", `Fetching: ${url}`);
    }

    const response = await axios.get(url, axiosConfig);

    return response.data;
  } catch (error) {
    if (error.response) {
      if (error.response.status === 429) {
        // Rate limited
        log("warn", "Rate limited by API. Waiting 60 seconds...");
        await sleep(60000);

        if (attempt < CONFIG.retryAttempts) {
          return await fetchBans(limit, offset, attempt + 1);
        } else {
          throw new Error("Max retry attempts reached for rate limiting");
        }
      } else if (error.response.status === 404) {
        // No more data
        return [];
      }
    }

    // Network error or other issue - retry with exponential backoff
    if (attempt < CONFIG.retryAttempts) {
      const delay = CONFIG.retryDelay * Math.pow(2, attempt - 1);
      log(
        "warn",
        `Error fetching bans: ${error.message}. Retrying in ${delay}ms... (attempt ${attempt}/${CONFIG.retryAttempts})`,
      );
      await sleep(delay);
      return await fetchBans(limit, offset, attempt + 1);
    }

    throw error;
  }
}

// ============================================================================
// SCRAPER LOGIC
// ============================================================================

/**
 * Process a batch of bans
 */
async function processBatch(bans) {
  // Use batch upsert for better performance
  const result = await batchUpsertBans(bans);

  stats.bansInserted += result.inserted;
  stats.bansUpdated += result.updated;
  stats.bansProcessed += bans.length;

  return result;
}

/**
 * Main scraper loop
 */
async function scrapeAllBans() {
  let offset = CONFIG.startOffset;
  let hasMore = true;
  let batchNum = Math.floor(CONFIG.startOffset / CONFIG.batchSize) + 1;

  if (CONFIG.startOffset > 0) {
    log(
      "info",
      `Starting from offset ${CONFIG.startOffset} (batch ${batchNum})`,
    );
  }

  while (hasMore && !shouldStop) {
    try {
      log(
        "info",
        `Fetching batch ${batchNum} (offset: ${offset}, limit: ${CONFIG.batchSize})...`,
      );

      const bans = await fetchBans(CONFIG.batchSize, offset);

      if (bans.length === 0) {
        log("info", "No more bans to fetch");
        hasMore = false;
        break;
      }

      log("info", `Received ${bans.length} bans`);

      // Process the batch
      await processBatch(bans);

      // Log progress
      const elapsed = (Date.now() - stats.startTime) / 1000;
      const rate =
        stats.bansProcessed > 0
          ? (stats.bansProcessed / elapsed).toFixed(2)
          : "0.00";
      log(
        "info",
        `Progress: ${stats.bansProcessed} processed, ${stats.bansInserted} inserted, ${stats.bansUpdated} updated (${rate} bans/s)`,
      );

      // Check if we got less than requested (end of data)
      if (bans.length < CONFIG.batchSize) {
        log("info", "Reached end of available bans");
        hasMore = false;
        break;
      }

      // Move to next batch
      offset += CONFIG.batchSize;
      batchNum++;

      // Delay between batches
      if (hasMore) {
        log(
          "info",
          `Waiting ${CONFIG.delayBetweenBatches}ms before next batch...`,
        );
        await sleep(CONFIG.delayBetweenBatches);
      }
    } catch (error) {
      log("error", `Error in scraper loop: ${error.message}`);
      stats.errorCount++;

      // Back off on errors
      await sleep(CONFIG.delayBetweenBatches * 2);
    }
  }
}

/**
 * Sleep utility
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Print statistics
 */
function printStats() {
  const elapsed = (Date.now() - stats.startTime) / 1000;
  const rate =
    stats.bansProcessed > 0
      ? (stats.bansProcessed / elapsed).toFixed(2)
      : "0.00";

  log("info", "=".repeat(70));
  log("info", "Scraper completed!");
  log("info", `  Total processed: ${stats.bansProcessed}`);
  log("info", `  Inserted: ${stats.bansInserted}`);
  log("info", `  Updated: ${stats.bansUpdated}`);
  log("info", `  Skipped: ${stats.bansSkipped}`);
  log("info", `  Errors: ${stats.errorCount}`);
  log("info", `  Time elapsed: ${elapsed.toFixed(2)}s`);
  log("info", `  Rate: ${rate} bans/s`);
  log("info", "=".repeat(70));
}

/**
 * Graceful shutdown handler
 */
async function gracefulShutdown(signal) {
  if (shouldStop) {
    return;
  }

  shouldStop = true;
  log("info", `Received ${signal}. Shutting down gracefully...`);

  // Print current stats
  printStats();

  // Close database connection
  if (connection) {
    await connection.end();
    log("info", "Database connection closed");
  }

  process.exit(0);
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  try {
    // Setup signal handlers
    process.on("SIGINT", () => gracefulShutdown("SIGINT"));
    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

    // Print configuration
    log("info", "=".repeat(70));
    log("info", "Bans Scraper");
    log("info", "=".repeat(70));
    log("info", "Configuration:");
    log(
      "info",
      `  Database: ${CONFIG.db.host}:${CONFIG.db.port}/${CONFIG.db.database}`,
    );
    log("info", `  API: ${CONFIG.apiUrl}`);
    log("info", `  Batch size: ${CONFIG.batchSize}`);
    log("info", `  Delay: ${CONFIG.delayBetweenBatches}ms`);
    log("info", `  Start offset: ${CONFIG.startOffset}`);
    log(
      "info",
      `  Proxies: ${CONFIG.proxies.length > 0 ? CONFIG.proxies.length : "None"}`,
    );
    log("info", `  Force update: ${CONFIG.force}`);
    log("info", `  Mode: ${CONFIG.dryRun ? "DRY RUN" : "LIVE"}`);
    log("info", "=".repeat(70));

    // Setup proxies
    setupProxies();

    // Connect to database
    await connectDatabase();

    // Start scraping
    stats.startTime = Date.now();
    await scrapeAllBans();

    // Print final statistics
    printStats();

    // Close connection
    await connection.end();
    log("info", "Database connection closed");
  } catch (error) {
    log("error", `Fatal error: ${error.message}`);
    if (connection) {
      await connection.end();
    }
    process.exit(1);
  }
}

// Run the scraper
if (require.main === module) {
  main().catch((error) => {
    log("error", `Unhandled error: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { main };
