/**
 * Import KZ Records from JSON files into MariaDB
 * Handles 25M+ records with batching and progress tracking
 *
 * Usage: node scripts/import-kz-records.js <json-file-path>
 * Example: node scripts/import-kz-records.js C:\Users\Juniper\Desktop\raw\0.json
 */

require("dotenv").config();

const { getKzPool } = require("../src/db/kzRecords");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

// Configuration
const BATCH_SIZE = 1000; // Insert 1000 records at a time
const PROGRESS_INTERVAL = 10000; // Show progress every 10k records

// Caches for normalized data
const playerCache = new Map(); // steamid64 -> player_id
const mapCache = new Map(); // map_id:map_name -> map_id
const serverCache = new Map(); // server_id -> server_id

/**
 * Sanitize string to handle special characters and truncate to max length
 */
function sanitizeString(str, maxLength = 255, defaultValue = "Unknown") {
  if (!str || typeof str !== "string") {
    return defaultValue;
  }

  // Trim whitespace
  str = str.trim();

  // Replace null bytes and other problematic characters
  str = str.replace(/\0/g, ""); // Remove null bytes
  str = str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ""); // Remove control characters except tab/newline

  // If string is empty after sanitization, use default
  if (str.length === 0) {
    return defaultValue;
  }

  // Truncate if too long
  if (str.length > maxLength) {
    str = str.substring(0, maxLength);
  }

  return str;
}

/**
 * Get or create player ID
 */
async function getOrCreatePlayer(connection, record) {
  // Validate steamid64 - handle missing values by creating a unique placeholder
  let steamid64 = record.steamid64 ? parseInt(record.steamid64) : null;

  // If steamid64 is missing or invalid, create a unique placeholder based on record ID
  if (!steamid64 || isNaN(steamid64)) {
    // Use a large number range that won't conflict with real Steam IDs
    // Real Steam IDs start around 76561197960265728, so we use 999900000000 + record.id
    const recordId = record.id || Math.floor(Math.random() * 1000000);
    steamid64 = 999900000000 + recordId;
  }

  const cacheKey = steamid64;

  if (playerCache.has(cacheKey)) {
    return playerCache.get(cacheKey);
  }

  // Try to find existing player
  const [rows] = await connection.query(
    "SELECT id FROM kz_players WHERE steamid64 = ?",
    [steamid64],
  );

  if (rows.length > 0) {
    playerCache.set(cacheKey, rows[0].id);
    return rows[0].id;
  }

  // Handle missing/invalid fields with defaults and sanitization
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

  // Insert new player
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
  // Use -1 for missing map_id (consistent with schema design)
  const mapId =
    record.map_id !== undefined && record.map_id !== null
      ? parseInt(record.map_id)
      : -1;

  // Sanitize map name with special handling for empty/missing values
  const mapName = sanitizeString(record.map_name, 255, "unknown_map");

  const cacheKey = `${mapId}:${mapName}`;

  if (mapCache.has(cacheKey)) {
    return mapCache.get(cacheKey);
  }

  // Try to find existing map
  const [rows] = await connection.query(
    "SELECT id FROM kz_maps WHERE map_id = ? AND map_name = ?",
    [mapId, mapName],
  );

  if (rows.length > 0) {
    mapCache.set(cacheKey, rows[0].id);
    return rows[0].id;
  }

  // Insert new map
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
  // Validate server_id - must be a valid number
  const serverId =
    record.server_id !== undefined && record.server_id !== null
      ? parseInt(record.server_id)
      : null;

  if (serverId === null || isNaN(serverId)) {
    // Use a negative server_id for records with missing server_id
    const unknownId = -1;
    const cacheKey = unknownId;

    if (serverCache.has(cacheKey)) {
      return serverCache.get(cacheKey);
    }

    // Try to find existing "Unknown Server" entry
    const [rows] = await connection.query(
      "SELECT id FROM kz_servers WHERE server_id = ?",
      [unknownId],
    );

    if (rows.length > 0) {
      serverCache.set(cacheKey, rows[0].id);
      return rows[0].id;
    }

    // Insert new unknown server
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

  // Try to find existing server
  const [rows] = await connection.query(
    "SELECT id FROM kz_servers WHERE server_id = ?",
    [serverId],
  );

  if (rows.length > 0) {
    serverCache.set(cacheKey, rows[0].id);
    return rows[0].id;
  }

  // Handle missing/invalid server_name with default value and sanitization
  const serverName = sanitizeString(
    record.server_name,
    255,
    `Unknown Server (ID: ${serverId})`,
  );

  // Insert new server
  const [result] = await connection.query(
    "INSERT INTO kz_servers (server_id, server_name) VALUES (?, ?)",
    [serverId, serverName],
  );

  serverCache.set(cacheKey, result.insertId);
  return result.insertId;
}

/**
 * Insert batch of records
 */
async function insertRecordBatch(connection, batch) {
  if (batch.length === 0) return;

  const values = batch.map((record) => [
    record.original_id,
    record.player_id,
    record.map_id,
    record.server_id,
    record.mode,
    record.stage,
    record.time,
    record.teleports,
    record.points,
    record.tickrate,
    record.record_filter_id,
    record.replay_id,
    record.updated_by,
    record.created_on,
    record.updated_on,
  ]);

  const placeholders = values
    .map(() => "(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .join(",");
  const flatValues = values.flat();

  await connection.query(
    `INSERT INTO kz_records 
        (original_id, player_id, map_id, server_id, mode, stage, time, teleports, points, 
         tickrate, record_filter_id, replay_id, updated_by, created_on, updated_on)
        VALUES ${placeholders}`,
    flatValues,
  );
}

/**
 * Convert ISO timestamp to MySQL format and handle invalid dates
 */
function convertTimestamp(isoString) {
  if (!isoString) return "1970-01-01 00:00:01";

  // Replace T with space, remove timezone, limit to 19 chars
  const timestamp = isoString
    .replace("T", " ")
    .replace(/\.\d+Z?$/, "")
    .substring(0, 19);

  // Check if date is before 1970 (MySQL TIMESTAMP minimum)
  const year = parseInt(timestamp.substring(0, 4));
  if (year < 1970) {
    return "1970-01-01 00:00:01";
  }

  // Check if date is after 2038 (MySQL TIMESTAMP maximum on 32-bit)
  if (year > 2038) {
    return "2038-01-19 03:14:07";
  }

  return timestamp;
}

/**
 * Process a single record
 */
async function processRecord(connection, record) {
  const playerId = await getOrCreatePlayer(connection, record);
  const mapId = await getOrCreateMap(connection, record);
  const serverId = await getOrCreateServer(connection, record);

  // Convert timestamps and handle invalid dates
  const createdOn = convertTimestamp(record.created_on);
  const updatedOn = convertTimestamp(record.updated_on);

  // Sanitize mode field (max 32 chars per schema)
  const mode = sanitizeString(record.mode, 32, "kz_timer");

  // Validate and default numeric fields
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

  return {
    original_id: record.id || null,
    player_id: playerId,
    map_id: mapId,
    server_id: serverId,
    mode: mode,
    stage: stage,
    time: time,
    teleports: teleports,
    points: points,
    tickrate: tickrate,
    record_filter_id: recordFilterId,
    replay_id: replayId,
    updated_by: updatedBy,
    created_on: createdOn,
    updated_on: updatedOn,
  };
}

/**
 * Main import function
 */
async function importRecords(filePath) {
  console.log(`Starting import from: ${filePath}`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log(
    `Database: ${process.env.KZ_DB_HOST || "localhost"}:${process.env.KZ_DB_PORT || 3308}/${process.env.KZ_DB_NAME || "kz_records"}\n`,
  );

  // Check if file exists
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  // Read and parse JSON
  console.log("Reading JSON file...");
  const jsonData = fs.readFileSync(filePath, "utf8");
  const records = JSON.parse(jsonData);
  console.log(`Found ${records.length.toLocaleString()} records\n`);

  // Create database connection
  const pool = getKzPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    let batch = [];
    let processedCount = 0;
    let skippedCount = 0;
    const startTime = Date.now();

    for (let i = 0; i < records.length; i++) {
      const record = records[i];

      try {
        // Process record and add to batch
        const processedRecord = await processRecord(connection, record);
        batch.push(processedRecord);
      } catch (error) {
        // Log error but continue processing
        skippedCount++;
        if (skippedCount <= 10) {
          console.error(
            `\n⚠ Warning: Skipped record at index ${i}: ${error.message}`,
          );
          if (skippedCount === 10) {
            console.error("  (Further skip warnings will be suppressed...)\n");
          }
        }
        continue;
      }

      // Insert batch when full
      if (batch.length >= BATCH_SIZE) {
        await insertRecordBatch(connection, batch);
        processedCount += batch.length;
        batch = [];

        // Show progress
        if (processedCount % PROGRESS_INTERVAL === 0) {
          const elapsed = (Date.now() - startTime) / 1000;
          const rate = Math.round(processedCount / elapsed);
          const remaining = Math.round(
            (records.length - processedCount - skippedCount) / rate,
          );

          console.log(
            `Progress: ${processedCount.toLocaleString()}/${records.length.toLocaleString()} ` +
              `(${((processedCount / records.length) * 100).toFixed(1)}%) | ` +
              `Rate: ${rate.toLocaleString()} rec/s | ` +
              `Skipped: ${skippedCount.toLocaleString()} | ` +
              `ETA: ${remaining}s`,
          );
        }
      }
    }

    // Insert remaining records
    if (batch.length > 0) {
      await insertRecordBatch(connection, batch);
      processedCount += batch.length;
    }

    await connection.commit();

    const totalTime = (Date.now() - startTime) / 1000;
    const avgRate = Math.round(processedCount / totalTime);

    console.log("\n✓ Import completed successfully!");
    console.log(`Total records processed: ${processedCount.toLocaleString()}`);
    if (skippedCount > 0) {
      console.log(
        `Total records skipped: ${skippedCount.toLocaleString()} (${((skippedCount / records.length) * 100).toFixed(2)}%)`,
      );
    }
    console.log(`Total time: ${totalTime.toFixed(1)}s`);
    console.log(`Average rate: ${avgRate.toLocaleString()} records/second`);
    console.log(`\nCache statistics:`);
    console.log(`  Players: ${playerCache.size.toLocaleString()}`);
    console.log(`  Maps: ${mapCache.size.toLocaleString()}`);
    console.log(`  Servers: ${serverCache.size.toLocaleString()}`);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
    // Don't close the pool - it's managed by the module
  }
}

/**
 * Import multiple files from a directory
 */
async function importDirectory(dirPath) {
  const files = fs
    .readdirSync(dirPath)
    .filter((file) => file.endsWith(".json"))
    .sort();

  console.log(`Found ${files.length} JSON files in ${dirPath}\n`);

  for (let i = 0; i < files.length; i++) {
    const filePath = path.join(dirPath, files[i]);
    console.log(`\n[${i + 1}/${files.length}] Processing: ${files[i]}`);
    console.log("=".repeat(60));

    try {
      await importRecords(filePath);
    } catch (error) {
      console.error(`\n✗ Error processing ${files[i]}:`, error.message);
      console.error("Continuing with next file...\n");
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("All files processed!");
}

// Main execution
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error("Usage: node import-kz-records.js <json-file-or-directory>");
    console.error(
      "Example: node import-kz-records.js C:\\Users\\Juniper\\Desktop\\raw\\0.json",
    );
    console.error(
      "Example: node import-kz-records.js C:\\Users\\Juniper\\Desktop\\raw",
    );
    process.exit(1);
  }

  const inputPath = args[0];

  // Check if it's a directory or file
  const stats = fs.statSync(inputPath);

  if (stats.isDirectory()) {
    importDirectory(inputPath)
      .then(() => process.exit(0))
      .catch((error) => {
        console.error("\n✗ Fatal error:", error);
        process.exit(1);
      });
  } else {
    importRecords(inputPath)
      .then(() => process.exit(0))
      .catch((error) => {
        console.error("\n✗ Error:", error);
        process.exit(1);
      });
  }
}

module.exports = { importRecords, importDirectory };
