#!/usr/bin/env node
/**
 * Standalone Players Scraper
 *
 * Fetches player data from GlobalKZ API and updates kz_players table.
 * - Adds missing players
 * - Updates existing players with latest info (name, ban status, record count)
 *
 * API Endpoint: GET https://kztimerglobal.com/api/v2/players?limit=1000&offset=0
 *
 * Response format:
 * [
 *   {
 *     "steamid64": 76561198123456789,
 *     "steam_id": "STEAM_1:1:12345678",
 *     "is_banned": false,
 *     "total_records": 1234,
 *     "name": "PlayerName"
 *   }
 * ]
 *
 * Features:
 * - Batch processing with pagination
 * - Updates existing players
 * - Adds new players
 * - Progress tracking
 * - Graceful shutdown
 *
 * Usage:
 *   node scripts/players-scraper.js [options]
 *
 * Options:
 *   --batch-size N    Number of players to fetch per batch (default: 1000, max: 1000)
 *   --delay N         Delay between batches in milliseconds (default: 1000)
 *   --force           Update all players even if they exist
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
  requestTimeout: 30000,

  // Scraper settings
  batchSize: 500, // API max limit
  delayBetweenBatches: 2000,
  retryAttempts: 3,
  retryDelay: 2000,
  force: false,
  dryRun: false,
  updateMissing: false, // Only update players with missing is_banned or total_records
  startOffset: 0, // Starting offset for pagination
};

// Parse command line arguments
process.argv.slice(2).forEach((arg, i, args) => {
  if (arg === "--batch-size" && args[i + 1])
    CONFIG.batchSize = Math.min(parseInt(args[i + 1]), 500);
  if (arg === "--delay" && args[i + 1])
    CONFIG.delayBetweenBatches = parseInt(args[i + 1]);
  if (arg === "--offset" && args[i + 1])
    CONFIG.startOffset = parseInt(args[i + 1]);
  if (arg === "--force") CONFIG.force = true;
  if (arg === "--dry-run") CONFIG.dryRun = true;
  if (arg === "--update-missing") CONFIG.updateMissing = true;
  if (arg === "--help") {
    console.log(`
Players Scraper

Fetches player data from GlobalKZ API and updates kz_players table.

Usage:
  node scripts/players-scraper.js [options]

Options:
  --batch-size N      Number of players per batch (default: 500, max: 500)
  --delay N           Delay between batches in milliseconds (default: 2000)
  --offset N          Starting offset for pagination (default: 0)
  --force             Update all players even if they exist
  --update-missing    Only update players with missing is_banned or total_records
  --dry-run           Show what would be done without making changes
  --help              Show this help message

Examples:
  # Fetch and update all players
  node scripts/players-scraper.js

  # Start from offset 100
  node scripts/players-scraper.js --offset 100

  # Only update players with missing metadata
  node scripts/players-scraper.js --update-missing

  # Dry run to see what would be updated
  node scripts/players-scraper.js --dry-run

  # Force update all players
  node scripts/players-scraper.js --force

  # Custom batch size, delay, and offset
  node scripts/players-scraper.js --batch-size 500 --delay 2000 --offset 1000
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
  playersProcessed: 0,
  playersInserted: 0,
  playersUpdated: 0,
  playersSkipped: 0,
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
 * Insert or update player
 */
async function upsertPlayer(player) {
  if (CONFIG.dryRun) {
    log(
      "info",
      `[DRY RUN] Would upsert player: ${player.name} (${player.steamid64}), banned=${player.is_banned}, records=${player.total_records}`,
    );
    return "skipped";
  }

  try {
    // Convert steamid64 to string for precision
    const steamid64 = String(player.steamid64);
    const steamId = player.steam_id || "";
    const playerName = player.name || `Unknown Player (${steamid64})`;
    const isBanned = player.is_banned || false;
    const totalRecords = player.total_records || 0;

    const query = `
      INSERT INTO kz_players (
        steamid64, steam_id, player_name, is_banned, total_records
      ) VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        steam_id = VALUES(steam_id),
        player_name = VALUES(player_name),
        is_banned = VALUES(is_banned),
        total_records = VALUES(total_records),
        updated_at = CURRENT_TIMESTAMP
    `;

    const [result] = await connection.query(query, [
      steamid64,
      steamId,
      playerName,
      isBanned,
      totalRecords,
    ]);

    // Check if it was an insert or update
    return result.affectedRows === 1 ? "inserted" : "updated";
  } catch (error) {
    log(
      "error",
      `Failed to upsert player ${player.steamid64}: ${error.message}`,
    );
    throw error;
  }
}

/**
 * Batch upsert players (more efficient for large batches)
 */
async function batchUpsertPlayers(players) {
  if (CONFIG.dryRun) {
    players.forEach((player) => {
      log(
        "info",
        `[DRY RUN] Would upsert player: ${player.name} (${player.steamid64}), banned=${player.is_banned}, records=${player.total_records}`,
      );
    });
    return { inserted: 0, updated: players.length };
  }

  if (players.length === 0) {
    return { inserted: 0, updated: 0 };
  }

  try {
    // Build batch INSERT ... ON DUPLICATE KEY UPDATE
    const query = `
      INSERT INTO kz_players (
        steamid64, steam_id, player_name, is_banned, total_records
      ) VALUES ?
      ON DUPLICATE KEY UPDATE
        steam_id = VALUES(steam_id),
        player_name = VALUES(player_name),
        is_banned = VALUES(is_banned),
        total_records = VALUES(total_records),
        updated_at = CURRENT_TIMESTAMP
    `;

    const values = players.map((player) => [
      String(player.steamid64), // Convert to string for precision
      player.steam_id || "",
      player.name || `Unknown Player (${player.steamid64})`,
      player.is_banned || false,
      player.total_records || 0,
    ]);

    const [result] = await connection.query(query, [values]);

    // affectedRows = inserts + (updates * 2)
    // If a row is updated, affectedRows counts it twice
    const inserted = Math.floor(result.affectedRows / 2);
    const updated = result.affectedRows - inserted;

    return { inserted, updated };
  } catch (error) {
    log("error", `Failed to batch upsert players: ${error.message}`);
    throw error;
  }
}

// ============================================================================
// API FUNCTIONS
// ============================================================================

/**
 * Fetch players from API with pagination
 */
async function fetchPlayers(limit, offset, attempt = 1) {
  try {
    const url = `${CONFIG.apiUrl}/players?limit=${limit}&offset=${offset}`;
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
          return await fetchPlayers(limit, offset, attempt + 1);
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
        `Error fetching players: ${error.message}. Retrying in ${delay}ms... (attempt ${attempt}/${CONFIG.retryAttempts})`,
      );
      await sleep(delay);
      return await fetchPlayers(limit, offset, attempt + 1);
    }

    throw error;
  }
}

/**
 * Fetch players by steamid64 list from API
 */
async function fetchPlayersBySteamIds(steamid64List, attempt = 1) {
  try {
    // API accepts array of integers in steamid64_list parameter
    const steamIdsParam = steamid64List.join(",");
    const url = `${CONFIG.apiUrl}/players?steamid64_list=${steamIdsParam}`;
    log("info", `Fetching ${steamid64List.length} players by SteamID64 list`);

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
          return await fetchPlayers(limit, offset, attempt + 1);
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
        `Error fetching players: ${error.message}. Retrying in ${delay}ms... (attempt ${attempt}/${CONFIG.retryAttempts})`,
      );
      await sleep(delay);
      return await fetchPlayers(limit, offset, attempt + 1);
    }

    throw error;
  }
}

// ============================================================================
// SCRAPER LOGIC
// ============================================================================

/**
 * Process a batch of players
 */
async function processBatch(players) {
  // Use batch upsert for better performance
  const result = await batchUpsertPlayers(players);

  stats.playersInserted += result.inserted;
  stats.playersUpdated += result.updated;
  stats.playersProcessed += players.length;

  return result;
}

/**
 * Get players with missing metadata from database
 */
async function getPlayersWithMissingData() {
  try {
    const query = `
      SELECT steamid64 
      FROM kz_players 
      WHERE is_banned IS NULL OR total_records IS NULL OR total_records = 0
    `;
    
    const [rows] = await connection.query(query);
    return rows.map(row => row.steamid64);
  } catch (error) {
    log("error", `Failed to fetch players with missing data: ${error.message}`);
    throw error;
  }
}

/**
 * Update players with missing metadata using steamid64_list API
 */
async function updatePlayersWithMissingData() {
  log("info", "Fetching players with missing metadata from database...");
  const steamid64List = await getPlayersWithMissingData();
  
  if (steamid64List.length === 0) {
    log("info", "No players with missing metadata found");
    return;
  }
  
  log("info", `Found ${steamid64List.length} players with missing metadata`);
  
  // Process in batches (API might have limits on steamid64_list size)
  const apiBatchSize = 100; // Conservative batch size for steamid64_list
  
  for (let i = 0; i < steamid64List.length; i += apiBatchSize) {
    if (shouldStop) {
      break;
    }
    
    const batch = steamid64List.slice(i, i + apiBatchSize);
    const batchNum = Math.floor(i / apiBatchSize) + 1;
    const totalBatches = Math.ceil(steamid64List.length / apiBatchSize);
    
    log("info", `Processing batch ${batchNum}/${totalBatches} (${batch.length} players)...`);
    
    try {
      const players = await fetchPlayersBySteamIds(batch);
      
      if (players.length > 0) {
        await processBatch(players);
        
        // Log progress
        const elapsed = (Date.now() - stats.startTime) / 1000;
        const rate = stats.playersProcessed > 0 
          ? (stats.playersProcessed / elapsed).toFixed(2) 
          : "0.00";
        log(
          "info",
          `Progress: ${stats.playersProcessed}/${steamid64List.length} processed, ${stats.playersUpdated} updated (${rate} players/s)`,
        );
      } else {
        log("warn", `No data returned for batch ${batchNum}`);
      }
      
      // Delay between batches
      if (i + apiBatchSize < steamid64List.length) {
        log("info", `Waiting ${CONFIG.delayBetweenBatches}ms before next batch...`);
        await sleep(CONFIG.delayBetweenBatches);
      }
    } catch (error) {
      log("error", `Error processing batch ${batchNum}: ${error.message}`);
      stats.errorCount++;
      
      // Back off on errors
      await sleep(CONFIG.delayBetweenBatches * 2);
    }
  }
}

/**
 * Main scraper loop
 */
async function scrapeAllPlayers() {
  let offset = CONFIG.startOffset;
  let hasMore = true;
  let batchNum = Math.floor(CONFIG.startOffset / CONFIG.batchSize) + 1;
  
  if (CONFIG.startOffset > 0) {
    log("info", `Starting from offset ${CONFIG.startOffset} (batch ${batchNum})`);
  }

  while (hasMore && !shouldStop) {
    try {
      log(
        "info",
        `Fetching batch ${batchNum} (offset: ${offset}, limit: ${CONFIG.batchSize})...`,
      );

      const players = await fetchPlayers(CONFIG.batchSize, offset);

      if (players.length === 0) {
        log("info", "No more players to fetch");
        hasMore = false;
        break;
      }

      log("info", `Received ${players.length} players`);

      // Process the batch
      await processBatch(players);

      // Log progress
      const elapsed = (Date.now() - stats.startTime) / 1000;
      const rate =
        stats.playersProcessed > 0
          ? (stats.playersProcessed / elapsed).toFixed(2)
          : "0.00";
      log(
        "info",
        `Progress: ${stats.playersProcessed} processed, ${stats.playersInserted} inserted, ${stats.playersUpdated} updated (${rate} players/s)`,
      );

      // Check if we got less than requested (end of data)
      if (players.length < CONFIG.batchSize) {
        log("info", "Reached end of available players");
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
    stats.playersProcessed > 0
      ? (stats.playersProcessed / elapsed).toFixed(2)
      : "0.00";

  log("info", "=".repeat(70));
  log("info", "Scraper completed!");
  log("info", `  Total processed: ${stats.playersProcessed}`);
  log("info", `  Inserted: ${stats.playersInserted}`);
  log("info", `  Updated: ${stats.playersUpdated}`);
  log("info", `  Skipped: ${stats.playersSkipped}`);
  log("info", `  Errors: ${stats.errorCount}`);
  log("info", `  Time elapsed: ${elapsed.toFixed(2)}s`);
  log("info", `  Rate: ${rate} players/s`);
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
    log("info", "Players Scraper");
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
    log("info", `  Force update: ${CONFIG.force}`);
    log("info", `  Update missing only: ${CONFIG.updateMissing}`);
    log("info", `  Mode: ${CONFIG.dryRun ? "DRY RUN" : "LIVE"}`);
    log("info", "=".repeat(70));

    // Connect to database
    await connectDatabase();

    // Start scraping
    stats.startTime = Date.now();
    
    if (CONFIG.updateMissing) {
      log("info", "Running in UPDATE MISSING mode");
      await updatePlayersWithMissingData();
    } else {
      log("info", "Running in FULL SCRAPE mode");
      await scrapeAllPlayers();
    }

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
