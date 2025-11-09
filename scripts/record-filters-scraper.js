#!/usr/bin/env node
/**
 * Standalone Record Filters Scraper
 *
 * Fetches all record filters from GlobalKZ API and populates kz_record_filters table.
 * Record filters define unique combinations of map, mode, stage, tickrate, and teleport status.
 *
 * API Endpoint: GET https://kztimerglobal.com/api/v2/record_filters?limit=1000&offset=0
 *
 * Features:
 * - Batch processing with pagination
 * - Progress tracking
 * - Graceful shutdown
 * - Resume support
 *
 * Usage:
 *   node scripts/record-filters-scraper.js [options]
 *
 * Options:
 *   --batch-size N    Number of filters to fetch per batch (default: 1000, max: 1000)
 *   --delay N         Delay between batches in milliseconds (default: 1000)
 *   --force           Re-fetch all filters even if they exist
 *   --dry-run         Show what would be done without making changes
 *   --help            Show this help message
 */

require("dotenv").config();
const axios = require("axios");
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
    charset: "utf8mb4",
  },

  // API settings
  apiUrl: process.env.GOKZ_API_URL || "https://kztimerglobal.com/api/v2",
  requestTimeout: 10000,

  // Scraper settings
  batchSize: 1000, // API max limit
  delayBetweenBatches: 1000,
  retryAttempts: 3,
  retryDelay: 2000,
  force: false,
  dryRun: false,
};

// Parse command line arguments
process.argv.slice(2).forEach((arg, i, args) => {
  if (arg === "--batch-size" && args[i + 1])
    CONFIG.batchSize = Math.min(parseInt(args[i + 1]), 1000);
  if (arg === "--delay" && args[i + 1])
    CONFIG.delayBetweenBatches = parseInt(args[i + 1]);
  if (arg === "--force") CONFIG.force = true;
  if (arg === "--dry-run") CONFIG.dryRun = true;
  if (arg === "--help") {
    console.log(`
Record Filters Scraper

Fetches record filters from GlobalKZ API and populates kz_record_filters table.

Usage:
  node scripts/record-filters-scraper.js [options]

Options:
  --batch-size N    Number of filters per batch (default: 1000, max: 1000)
  --delay N         Delay between batches in milliseconds (default: 1000)
  --force           Re-fetch all filters even if they exist
  --dry-run         Show what would be done without making changes
  --help            Show this help message

Examples:
  # Fetch all record filters
  node scripts/record-filters-scraper.js

  # Dry run to see what would be fetched
  node scripts/record-filters-scraper.js --dry-run

  # Force update all filters
  node scripts/record-filters-scraper.js --force

  # Custom batch size and delay
  node scripts/record-filters-scraper.js --batch-size 500 --delay 2000
    `);
    process.exit(0);
  }
});

// ============================================================================
// GLOBAL STATE
// ============================================================================

let connection = null;
let shouldStop = false;

const stats = {
  startTime: Date.now(),
  filtersProcessed: 0,
  filtersInserted: 0,
  filtersUpdated: 0,
  filtersSkipped: 0,
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
 * Check if filter exists
 */
async function filterExists(filterId) {
  const [rows] = await connection.query(
    "SELECT id FROM kz_record_filters WHERE id = ?",
    [filterId],
  );
  return rows.length > 0;
}

/**
 * Insert or update record filter
 */
async function upsertRecordFilter(filter) {
  if (CONFIG.dryRun) {
    log(
      "info",
      `[DRY RUN] Would upsert filter ${filter.id}: map=${filter.map_id}, mode=${filter.mode_id}, stage=${filter.stage}, tickrate=${filter.tickrate}, teleports=${filter.has_teleports}`,
    );
    return "skipped";
  }

  try {
    // Convert datetime strings to MySQL format
    const createdOn = filter.created_on
      ? new Date(filter.created_on).toISOString().slice(0, 19).replace("T", " ")
      : null;
    const updatedOn = filter.updated_on
      ? new Date(filter.updated_on).toISOString().slice(0, 19).replace("T", " ")
      : null;

    const query = `
      INSERT INTO kz_record_filters (
        id, map_id, stage, mode_id, tickrate, has_teleports,
        created_on, updated_on, updated_by_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        map_id = VALUES(map_id),
        stage = VALUES(stage),
        mode_id = VALUES(mode_id),
        tickrate = VALUES(tickrate),
        has_teleports = VALUES(has_teleports),
        updated_on = VALUES(updated_on),
        updated_by_id = VALUES(updated_by_id)
    `;

    const [result] = await connection.query(query, [
      filter.id,
      filter.map_id,
      filter.stage || 0,
      filter.mode_id,
      filter.tickrate,
      filter.has_teleports || false,
      createdOn,
      updatedOn,
      filter.updated_by_id || null,
    ]);

    // Check if it was an insert or update
    return result.affectedRows === 1 ? "inserted" : "updated";
  } catch (error) {
    log("error", `Failed to upsert filter ${filter.id}: ${error.message}`);
    throw error;
  }
}

// ============================================================================
// API FUNCTIONS
// ============================================================================

/**
 * Fetch record filters from API
 */
async function fetchRecordFilters(limit, offset, attempt = 1) {
  try {
    const url = `${CONFIG.apiUrl}/record_filters?limit=${limit}&offset=${offset}`;
    log("info", `Fetching: ${url}`);

    const response = await axios.get(url, {
      timeout: CONFIG.requestTimeout,
      headers: {
        "User-Agent": "KZ-Records-Scraper/1.0",
      },
    });

    return response.data;
  } catch (error) {
    if (error.response) {
      if (error.response.status === 429) {
        // Rate limited
        log("warn", "Rate limited by API. Waiting 60 seconds...");
        await sleep(60000);

        if (attempt < CONFIG.retryAttempts) {
          return await fetchRecordFilters(limit, offset, attempt + 1);
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
        `Error fetching filters: ${error.message}. Retrying in ${delay}ms... (attempt ${attempt}/${CONFIG.retryAttempts})`,
      );
      await sleep(delay);
      return await fetchRecordFilters(limit, offset, attempt + 1);
    }

    throw error;
  }
}

// ============================================================================
// SCRAPER LOGIC
// ============================================================================

/**
 * Process a batch of filters
 */
async function processBatch(filters) {
  for (const filter of filters) {
    if (shouldStop) {
      return;
    }

    try {
      // Check if filter exists and skip if not forcing update
      if (!CONFIG.force && !CONFIG.dryRun) {
        const exists = await filterExists(filter.id);
        if (exists) {
          stats.filtersSkipped++;
          stats.filtersProcessed++;
          continue;
        }
      }

      // Upsert filter
      const result = await upsertRecordFilter(filter);

      if (result === "inserted") {
        stats.filtersInserted++;
      } else if (result === "updated") {
        stats.filtersUpdated++;
      } else {
        stats.filtersSkipped++;
      }

      stats.filtersProcessed++;
    } catch (error) {
      log("error", `Error processing filter ${filter.id}: ${error.message}`);
      stats.errorCount++;
    }
  }
}

/**
 * Main scraper loop
 */
async function scrapeAllFilters() {
  let offset = 0;
  let hasMore = true;
  let batchNum = 1;

  while (hasMore && !shouldStop) {
    try {
      log(
        "info",
        `Fetching batch ${batchNum} (offset: ${offset}, limit: ${CONFIG.batchSize})...`,
      );

      const filters = await fetchRecordFilters(CONFIG.batchSize, offset);

      if (filters.length === 0) {
        log("info", "No more filters to fetch");
        hasMore = false;
        break;
      }

      log("info", `Received ${filters.length} filters`);

      // Process the batch
      await processBatch(filters);

      // Log progress
      const elapsed = (Date.now() - stats.startTime) / 1000;
      const rate =
        stats.filtersProcessed > 0
          ? (stats.filtersProcessed / elapsed).toFixed(2)
          : "0.00";
      log(
        "info",
        `Progress: ${stats.filtersProcessed} processed, ${stats.filtersInserted} inserted, ${stats.filtersUpdated} updated, ${stats.filtersSkipped} skipped (${rate} filters/s)`,
      );

      // Check if we got less than requested (end of data)
      if (filters.length < CONFIG.batchSize) {
        log("info", "Reached end of available filters");
        hasMore = false;
        break;
      }

      // Move to next batch
      offset += CONFIG.batchSize;
      batchNum++;

      // Delay between batches
      if (hasMore) {
        log("info", `Waiting ${CONFIG.delayBetweenBatches}ms before next batch...`);
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
    stats.filtersProcessed > 0
      ? (stats.filtersProcessed / elapsed).toFixed(2)
      : "0.00";

  log("info", "=".repeat(70));
  log("info", "Scraper completed!");
  log("info", `  Total processed: ${stats.filtersProcessed}`);
  log("info", `  Inserted: ${stats.filtersInserted}`);
  log("info", `  Updated: ${stats.filtersUpdated}`);
  log("info", `  Skipped: ${stats.filtersSkipped}`);
  log("info", `  Errors: ${stats.errorCount}`);
  log("info", `  Time elapsed: ${elapsed.toFixed(2)}s`);
  log("info", `  Rate: ${rate} filters/s`);
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
    log("info", "Record Filters Scraper");
    log("info", "=".repeat(70));
    log("info", "Configuration:");
    log(
      "info",
      `  Database: ${CONFIG.db.host}:${CONFIG.db.port}/${CONFIG.db.database}`,
    );
    log("info", `  API: ${CONFIG.apiUrl}`);
    log("info", `  Batch size: ${CONFIG.batchSize}`);
    log("info", `  Delay: ${CONFIG.delayBetweenBatches}ms`);
    log("info", `  Force update: ${CONFIG.force}`);
    log("info", `  Mode: ${CONFIG.dryRun ? "DRY RUN" : "LIVE"}`);
    log("info", "=".repeat(70));

    // Connect to database
    await connectDatabase();

    // Start scraping
    stats.startTime = Date.now();
    await scrapeAllFilters();

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
