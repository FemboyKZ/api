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
 * - Checks for new bans and updates player ban status
 * - Dynamic intervals: fast polling when finding records, slow polling when caught up
 *
 * Configuration (via .env):
 *   KZ_SCRAPER_ENABLED=true           # Enable/disable scraper
 *   KZ_SCRAPER_INTERVAL=3750          # How often to run when finding records (ms) - default 3.75s
 *   KZ_SCRAPER_IDLE_INTERVAL=30000    # How often to run when caught up (ms) - default 30s
 *   KZ_SCRAPER_CONCURRENCY=5          # Records per batch - default 5
 *   KZ_SCRAPER_REQUEST_DELAY=100      # Delay between requests (ms) - default 100ms
 *   KZ_SCRAPER_BANS_INTERVAL=300000   # How often to check bans (ms) - default 5min
 *
 * Rate Limiting:
 *   The GlobalKZ API has a rate limit of 500 requests per 5 minutes per IP.
 *
 *   Default configuration when finding records (80% utilization):
 *   - 5 records per batch with 100ms delay = ~1.5 seconds per batch
 *   - Running every 3.75 seconds = 80 batches per 5 minutes = 400 requests per 5 min
 *   - Speed: ~4,800 records/hour
 *
 *   When caught up (13% utilization):
 *   - Running every 30 seconds = 10 batches per 5 minutes = 50 requests per 5 min
 *   - Reduces API load by ~87% during idle periods
 *
 *   This is more than sufficient for maintenance mode (catching new records as they appear).
 *   For bulk scraping, use scripts/standalone-scraper.js with proxy support.
 *
 * Usage:
 *   const scraper = require('./services/kzRecordsScraper');
 *   scraper.startScraperJob(3750, 30000); // Fast polling (3.75s), slow polling (30s)
 */

require("dotenv").config();
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const logger = require("../utils/logger");
const { getKzPool } = require("../db/kzRecords");
const { updatePlayerBanStatus } = require("./kzBanStatus");

// Configuration
const GOKZ_API_URL =
  process.env.GOKZ_API_URL || "https://kztimerglobal.com/api/v2";
const CONCURRENCY = parseInt(process.env.KZ_SCRAPER_CONCURRENCY) || 5;
const RETRY_ATTEMPTS = 3;
const RETRY_DELAY = 2000; // Initial retry delay in ms (exponential backoff)
const REQUEST_DELAY = parseInt(process.env.KZ_SCRAPER_REQUEST_DELAY) || 100;
const STATE_FILE = path.join(__dirname, "../../logs/kz-scraper-state.json");
const REQUEST_TIMEOUT = 10000;
const BANS_CHECK_INTERVAL =
  parseInt(process.env.KZ_SCRAPER_BANS_INTERVAL) || 300000; // 5 minutes

// Caches for normalized data
const playerCache = new Map();
const mapCache = new Map();
const serverCache = new Map();

// State tracking
let isRunning = false;
let isBansRunning = false;
let currentRecordId = 0;
let lastBanCheck = 0;
let scraperTimeout = null;
const stats = {
  startTime: null,
  recordsProcessed: 0,
  recordsInserted: 0,
  recordsSkipped: 0,
  notFoundCount: 0,
  errorCount: 0,
  lastSuccessfulId: 0,
  bansChecked: 0,
  bansInserted: 0,
  bansUpdated: 0,
  playersUpdated: 0,
};

/**
 * Load state from file
 */
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
      currentRecordId = state.lastRecordId || 0;
      lastBanCheck = state.lastBanCheck || 0;
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
      lastBanCheck,
      lastUpdate: new Date().toISOString(),
      stats: {
        recordsProcessed: stats.recordsProcessed,
        recordsInserted: stats.recordsInserted,
        recordsSkipped: stats.recordsSkipped,
        bansChecked: stats.bansChecked,
        bansInserted: stats.bansInserted,
        bansUpdated: stats.bansUpdated,
        playersUpdated: stats.playersUpdated,
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
 * Get or create player ID (returns auto-increment ID from kz_players table)
 * Also returns steamid64 for denormalized storage in kz_records
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
    "SELECT id, steamid64 FROM kz_players WHERE steamid64 = ?",
    [steamid64],
  );

  if (rows.length > 0) {
    const playerData = { id: rows[0].id, steamid64: rows[0].steamid64 };
    playerCache.set(cacheKey, playerData);
    return playerData;
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

  const playerData = { id: result.insertId, steamid64 };
  playerCache.set(cacheKey, playerData);
  return playerData;
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
        (original_id, player_id, steamid64, map_id, server_id, mode, stage, time, teleports, points, 
         tickrate, record_filter_id, replay_id, updated_by, created_on, updated_on)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.id,
      playerId.id,
      playerId.steamid64,
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

  const wasInserted = result.affectedRows > 0;

  // If record was inserted, update PB and WR caches
  if (wasInserted) {
    await updatePBAndWROnNewRecord(connection, {
      playerId: playerId.id,
      steamid64: playerId.steamid64,
      mapId,
      mapName: sanitizeString(record.map_name, 255, "unknown_map"),
      mode,
      stage,
      time,
      teleports,
      points,
      recordId: record.id,
      createdOn,
    });
  }

  return wasInserted;
}

/**
 * Update player PB and map WR caches when a new record is inserted
 * Only updates if the new time is better than existing cached time
 */
async function updatePBAndWROnNewRecord(connection, recordData) {
  const {
    playerId,
    steamid64,
    mapId,
    mapName,
    mode,
    stage,
    time,
    teleports,
    points,
    recordId,
    createdOn,
  } = recordData;

  try {
    // Check if kz_player_map_pbs table exists
    const [pbTableCheck] = await connection.query(
      `SELECT COUNT(*) as count FROM information_schema.tables 
       WHERE table_schema = DATABASE() AND table_name = 'kz_player_map_pbs'`,
    );

    if (pbTableCheck[0].count > 0) {
      // Update player PB cache
      await updatePlayerPBOnNewRecord(connection, {
        playerId,
        steamid64,
        mapId,
        mapName,
        mode,
        stage,
        time,
        teleports,
        points,
        recordId,
        createdOn,
      });
    }

    // Check if kz_map_statistics table has new WR columns (expanded to all modes)
    const [wrColumnCheck] = await connection.query(
      `SELECT COUNT(*) as count FROM information_schema.columns 
       WHERE table_schema = DATABASE() 
       AND table_name = 'kz_map_statistics' 
       AND column_name = 'wr_kz_timer_pro_time'`,
    );

    // Only update WR for stage 0 (main course)
    if (wrColumnCheck[0].count > 0 && stage === 0) {
      await updateMapWROnNewRecord(connection, {
        mapId,
        steamid64,
        mode,
        time,
        teleports,
        recordId,
        createdOn,
      });
    }
  } catch (error) {
    // Log but don't fail the record insert - PB/WR updates are secondary
    logger.warn(
      `[KZ Scraper] Failed to update PB/WR cache for record ${recordId}: ${error.message}`,
    );
  }
}

/**
 * Update player PB cache for a specific map/mode/stage
 */
async function updatePlayerPBOnNewRecord(connection, recordData) {
  const {
    playerId,
    steamid64,
    mapId,
    mapName,
    mode,
    stage,
    time,
    teleports,
    points,
    recordId,
    createdOn,
  } = recordData;

  const isPro = teleports === 0;

  // Get current PB for this player/map/mode/stage
  const [existing] = await connection.query(
    `SELECT id, pro_time, tp_time FROM kz_player_map_pbs 
     WHERE player_id = ? AND map_id = ? AND mode = ? AND stage = ?`,
    [playerId, mapId, mode, stage],
  );

  if (existing.length === 0) {
    // No existing PB - get map metadata and insert
    const [mapData] = await connection.query(
      `SELECT difficulty, validated FROM kz_maps WHERE id = ?`,
      [mapId],
    );

    const difficulty = mapData.length > 0 ? mapData[0].difficulty : null;
    const validated = mapData.length > 0 ? mapData[0].validated : null;

    if (isPro) {
      await connection.query(
        `INSERT INTO kz_player_map_pbs 
         (player_id, steamid64, map_id, map_name, mode, stage, 
          pro_time, pro_teleports, pro_points, pro_record_id, pro_created_on,
          map_difficulty, map_validated)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
        [
          playerId,
          steamid64,
          mapId,
          mapName,
          mode,
          stage,
          time,
          points,
          recordId,
          createdOn,
          difficulty,
          validated,
        ],
      );
    } else {
      await connection.query(
        `INSERT INTO kz_player_map_pbs 
         (player_id, steamid64, map_id, map_name, mode, stage, 
          tp_time, tp_teleports, tp_points, tp_record_id, tp_created_on,
          map_difficulty, map_validated)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          playerId,
          steamid64,
          mapId,
          mapName,
          mode,
          stage,
          time,
          teleports,
          points,
          recordId,
          createdOn,
          difficulty,
          validated,
        ],
      );
    }
    logger.debug(
      `[KZ Scraper] Created new PB for player ${playerId} on ${mapName}`,
    );
  } else {
    // Check if new time is better
    const currentPB = existing[0];
    const currentTime = isPro ? currentPB.pro_time : currentPB.tp_time;

    if (currentTime === null || time < parseFloat(currentTime)) {
      // New PB!
      if (isPro) {
        await connection.query(
          `UPDATE kz_player_map_pbs 
           SET pro_time = ?, pro_points = ?, pro_record_id = ?, pro_created_on = ?, updated_at = NOW()
           WHERE id = ?`,
          [time, points, recordId, createdOn, currentPB.id],
        );
      } else {
        await connection.query(
          `UPDATE kz_player_map_pbs 
           SET tp_time = ?, tp_teleports = ?, tp_points = ?, tp_record_id = ?, tp_created_on = ?, updated_at = NOW()
           WHERE id = ?`,
          [time, teleports, points, recordId, createdOn, currentPB.id],
        );
      }
      logger.debug(
        `[KZ Scraper] Updated PB for player ${playerId} on ${mapName}: ${currentTime}s → ${time}s`,
      );
    }
  }
}

/**
 * Update map WR cache if new record is faster
 * Handles all 3 modes (kz_timer, kz_simple, kz_vanilla) and both pro/overall
 */
async function updateMapWROnNewRecord(connection, recordData) {
  const { mapId, steamid64, mode, time, teleports, recordId } = recordData;

  // Determine which WR columns to potentially update
  const modePrefix = mode.replace("_", "_"); // kz_timer, kz_simple, kz_vanilla
  const isPro = teleports === 0;

  // Get player name
  const [player] = await connection.query(
    `SELECT player_name FROM kz_players WHERE steamid64 = ?`,
    [steamid64],
  );
  const playerName = player.length > 0 ? player[0].player_name : "Unknown";

  // Columns to update based on mode
  const proTimeCol = `wr_${modePrefix}_pro_time`;
  const proSteamidCol = `wr_${modePrefix}_pro_steamid64`;
  const proPlayerCol = `wr_${modePrefix}_pro_player_name`;
  const proRecordCol = `wr_${modePrefix}_pro_record_id`;

  const overallTimeCol = `wr_${modePrefix}_overall_time`;
  const overallTpsCol = `wr_${modePrefix}_overall_teleports`;
  const overallSteamidCol = `wr_${modePrefix}_overall_steamid64`;
  const overallPlayerCol = `wr_${modePrefix}_overall_player_name`;
  const overallRecordCol = `wr_${modePrefix}_overall_record_id`;

  // Get current WRs for this map and mode
  const [existing] = await connection.query(
    `SELECT ${proTimeCol} as pro_time, ${overallTimeCol} as overall_time 
     FROM kz_map_statistics WHERE map_id = ?`,
    [mapId],
  );

  if (existing.length === 0) {
    // No statistics row yet - this shouldn't happen if populate_map_statistics ran
    // But let's be safe and create one
    const insertData = { map_id: mapId };

    if (isPro) {
      // Pro record - update both pro and overall columns
      await connection.query(
        `INSERT INTO kz_map_statistics 
         (map_id, ${proTimeCol}, ${proSteamidCol}, ${proPlayerCol}, ${proRecordCol},
          ${overallTimeCol}, ${overallTpsCol}, ${overallSteamidCol}, ${overallPlayerCol}, ${overallRecordCol})
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           ${proTimeCol} = IF(VALUES(${proTimeCol}) < ${proTimeCol} OR ${proTimeCol} IS NULL, VALUES(${proTimeCol}), ${proTimeCol}),
           ${proSteamidCol} = IF(VALUES(${proTimeCol}) < ${proTimeCol} OR ${proTimeCol} IS NULL, VALUES(${proSteamidCol}), ${proSteamidCol}),
           ${proPlayerCol} = IF(VALUES(${proTimeCol}) < ${proTimeCol} OR ${proTimeCol} IS NULL, VALUES(${proPlayerCol}), ${proPlayerCol}),
           ${proRecordCol} = IF(VALUES(${proTimeCol}) < ${proTimeCol} OR ${proTimeCol} IS NULL, VALUES(${proRecordCol}), ${proRecordCol}),
           ${overallTimeCol} = IF(VALUES(${overallTimeCol}) < ${overallTimeCol} OR ${overallTimeCol} IS NULL, VALUES(${overallTimeCol}), ${overallTimeCol}),
           ${overallTpsCol} = IF(VALUES(${overallTimeCol}) < ${overallTimeCol} OR ${overallTimeCol} IS NULL, VALUES(${overallTpsCol}), ${overallTpsCol}),
           ${overallSteamidCol} = IF(VALUES(${overallTimeCol}) < ${overallTimeCol} OR ${overallTimeCol} IS NULL, VALUES(${overallSteamidCol}), ${overallSteamidCol}),
           ${overallPlayerCol} = IF(VALUES(${overallTimeCol}) < ${overallTimeCol} OR ${overallTimeCol} IS NULL, VALUES(${overallPlayerCol}), ${overallPlayerCol}),
           ${overallRecordCol} = IF(VALUES(${overallTimeCol}) < ${overallTimeCol} OR ${overallTimeCol} IS NULL, VALUES(${overallRecordCol}), ${overallRecordCol})`,
        [
          mapId,
          time,
          steamid64,
          playerName,
          recordId,
          time,
          steamid64,
          playerName,
          recordId,
        ],
      );
    } else {
      // TP record - only update overall columns
      await connection.query(
        `INSERT INTO kz_map_statistics 
         (map_id, ${overallTimeCol}, ${overallTpsCol}, ${overallSteamidCol}, ${overallPlayerCol}, ${overallRecordCol})
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           ${overallTimeCol} = IF(VALUES(${overallTimeCol}) < ${overallTimeCol} OR ${overallTimeCol} IS NULL, VALUES(${overallTimeCol}), ${overallTimeCol}),
           ${overallTpsCol} = IF(VALUES(${overallTimeCol}) < ${overallTimeCol} OR ${overallTimeCol} IS NULL, VALUES(${overallTpsCol}), ${overallTpsCol}),
           ${overallSteamidCol} = IF(VALUES(${overallTimeCol}) < ${overallTimeCol} OR ${overallTimeCol} IS NULL, VALUES(${overallSteamidCol}), ${overallSteamidCol}),
           ${overallPlayerCol} = IF(VALUES(${overallTimeCol}) < ${overallTimeCol} OR ${overallTimeCol} IS NULL, VALUES(${overallPlayerCol}), ${overallPlayerCol}),
           ${overallRecordCol} = IF(VALUES(${overallTimeCol}) < ${overallTimeCol} OR ${overallTimeCol} IS NULL, VALUES(${overallRecordCol}), ${overallRecordCol})`,
        [mapId, time, teleports, steamid64, playerName, recordId],
      );
    }
    logger.debug(
      `[KZ Scraper] Set initial WR for map ${mapId} (${mode}): ${time}s by ${playerName}`,
    );
    return;
  }

  // Check if this beats current WRs
  const currentProTime = existing[0].pro_time
    ? parseFloat(existing[0].pro_time)
    : null;
  const currentOverallTime = existing[0].overall_time
    ? parseFloat(existing[0].overall_time)
    : null;

  const updates = [];
  const values = [];

  if (isPro) {
    // Pro record can beat both pro and overall WRs
    if (currentProTime === null || time < currentProTime) {
      updates.push(
        `${proTimeCol} = ?`,
        `${proSteamidCol} = ?`,
        `${proPlayerCol} = ?`,
        `${proRecordCol} = ?`,
      );
      values.push(time, steamid64, playerName, recordId);
      logger.info(
        `[KZ Scraper] New PRO WR for map ${mapId} (${mode}): ${currentProTime}s → ${time}s by ${playerName}`,
      );
    }
    if (currentOverallTime === null || time < currentOverallTime) {
      updates.push(
        `${overallTimeCol} = ?`,
        `${overallTpsCol} = ?`,
        `${overallSteamidCol} = ?`,
        `${overallPlayerCol} = ?`,
        `${overallRecordCol} = ?`,
      );
      values.push(time, 0, steamid64, playerName, recordId);
      logger.info(
        `[KZ Scraper] New OVERALL WR for map ${mapId} (${mode}): ${currentOverallTime}s → ${time}s by ${playerName}`,
      );
    }
  } else {
    // TP record can only beat overall WR
    if (currentOverallTime === null || time < currentOverallTime) {
      updates.push(
        `${overallTimeCol} = ?`,
        `${overallTpsCol} = ?`,
        `${overallSteamidCol} = ?`,
        `${overallPlayerCol} = ?`,
        `${overallRecordCol} = ?`,
      );
      values.push(time, teleports, steamid64, playerName, recordId);
      logger.info(
        `[KZ Scraper] New OVERALL WR (TP) for map ${mapId} (${mode}): ${currentOverallTime}s → ${time}s by ${playerName} (${teleports} TPs)`,
      );
    }
  }

  if (updates.length > 0) {
    values.push(mapId);
    await connection.query(
      `UPDATE kz_map_statistics SET ${updates.join(", ")} WHERE map_id = ?`,
      values,
    );
  }
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
        // Handle deadlock and lock timeout errors with retry
        if (
          error.code === "ER_LOCK_DEADLOCK" ||
          error.code === "ER_LOCK_WAIT_TIMEOUT"
        ) {
          const errorType =
            error.code === "ER_LOCK_DEADLOCK"
              ? "Deadlock"
              : "Lock wait timeout";
          logger.warn(
            `[KZ Scraper] ${errorType} detected for record ${recordId}, retrying...`,
          );
          try {
            // Retry once after brief delay (longer for lock timeouts)
            const retryDelay =
              error.code === "ER_LOCK_WAIT_TIMEOUT" ? 500 : 100;
            await new Promise((resolve) => setTimeout(resolve, retryDelay));
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
            logger.info(
              `[KZ Scraper] Record ${recordId} processed successfully after ${errorType.toLowerCase()} retry`,
            );
          } catch (retryError) {
            logger.error(
              `[KZ Scraper] Error processing record ${recordId} after retry: ${retryError.message}`,
            );
            logger.error(`[KZ Scraper] Stack trace: ${retryError.stack}`);
            logger.error(
              `[KZ Scraper] Record data: ${JSON.stringify(recordData)}`,
            );
            stats.errorCount++;
            skipped++;
          }
        } else {
          logger.error(
            `[KZ Scraper] Error processing record ${recordId}: ${error.message}`,
          );
          logger.error(`[KZ Scraper] Stack trace: ${error.stack}`);
          logger.error(
            `[KZ Scraper] Record data: ${JSON.stringify(recordData)}`,
          );
          stats.errorCount++;
          skipped++;
        }
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
 * Format datetime for MySQL
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
 * Fetch bans from API
 */
async function fetchBans(limit = 200, offset = 0, attempt = 1) {
  try {
    const response = await axios.get(`${GOKZ_API_URL}/bans`, {
      params: { limit, offset },
      timeout: 30000, // 30 seconds for bans endpoint (can be slow)
    });

    return response.data || [];
  } catch (error) {
    if (error.response?.status === 429) {
      const rateLimitDelay = 60000;
      logger.warn(
        `[KZ Scraper] Rate limited (429) on bans, waiting ${rateLimitDelay / 1000}s before retry`,
      );
      await new Promise((resolve) => setTimeout(resolve, rateLimitDelay));

      if (attempt < RETRY_ATTEMPTS) {
        return fetchBans(limit, offset, attempt + 1);
      }
      return [];
    }

    if (attempt < RETRY_ATTEMPTS) {
      const delay = RETRY_DELAY * Math.pow(2, attempt - 1);
      logger.warn(
        `[KZ Scraper] Retry ${attempt}/${RETRY_ATTEMPTS} for bans after ${delay}ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
      return fetchBans(limit, offset, attempt + 1);
    }

    throw error;
  }
}

/**
 * Process bans and update player ban status
 */
async function processBans() {
  if (isBansRunning) {
    logger.debug(
      "[KZ Scraper] Bans check already running, skipping this iteration",
    );
    return;
  }

  const now = Date.now();
  if (now - lastBanCheck < BANS_CHECK_INTERVAL) {
    return; // Not time yet
  }

  isBansRunning = true;
  lastBanCheck = now;

  try {
    logger.info("[KZ Scraper] Checking for new bans...");

    const pool = getKzPool();
    const connection = await pool.getConnection();

    try {
      const limit = 200; // Reduced from 1000 to avoid timeout
      let totalProcessed = 0;
      let totalInserted = 0;
      let totalUpdated = 0;
      let playersUpdated = 0;

      // Always fetch from offset 0 - API returns latest bans first
      const bans = await fetchBans(limit, 0);
      if (bans.length > 0) {
        // Batch insert/update bans
        if (bans.length > 0) {
          const values = bans.map((ban) => [
            ban.id,
            ban.ban_type || "none",
            formatDateTime(ban.expires_on),
            ban.ip || null,
            ban.steamid64 ? String(ban.steamid64) : null,
            ban.player_name || null,
            ban.steam_id || null,
            ban.notes || null,
            ban.stats || null,
            ban.server_id || null,
            ban.updated_by_id ? String(ban.updated_by_id) : null,
            formatDateTime(ban.created_on),
            formatDateTime(ban.updated_on),
          ]);

          const [result] = await connection.query(
            `INSERT INTO kz_bans (
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
              updated_at = CURRENT_TIMESTAMP`,
            [values],
          );

          // Calculate inserts vs updates
          const totalBans = bans.length;
          let inserted, updated;

          if (result.affectedRows === totalBans) {
            inserted = totalBans;
            updated = 0;
          } else if (result.affectedRows > totalBans) {
            inserted = 2 * totalBans - result.affectedRows;
            updated = totalBans - inserted;
          } else {
            inserted = 0;
            updated = totalBans;
          }

          totalInserted += inserted;
          totalUpdated += updated;
          totalProcessed += bans.length;

          // Update player ban status for all steamid64s in this batch
          const steamIds = bans
            .map((ban) => (ban.steamid64 ? String(ban.steamid64) : null))
            .filter(Boolean);

          if (steamIds.length > 0) {
            // First, ensure all players exist (create if missing)
            for (const ban of bans) {
              if (ban.steamid64) {
                const steamid64 = String(ban.steamid64);
                const playerName = sanitizeString(
                  ban.player_name,
                  100,
                  `Unknown Player (${steamid64})`,
                );
                const steamId = sanitizeString(
                  ban.steam_id,
                  32,
                  `STEAM_ID_MISSING_${steamid64}`,
                );

                await connection.query(
                  `INSERT IGNORE INTO kz_players (steamid64, steam_id, player_name, is_banned)
                   VALUES (?, ?, ?, TRUE)`,
                  [steamid64, steamId, playerName],
                );
              }
            }

            // Use ban status service to update is_banned flags intelligently
            // This checks for active vs expired bans
            const banStatusResult = await updatePlayerBanStatus(steamIds);
            playersUpdated += banStatusResult.banned + banStatusResult.unbanned;

            logger.debug(
              `[KZ Scraper] Processed ${bans.length} bans (inserted: ${inserted}, updated: ${updated}, players banned: ${banStatusResult.banned}, unbanned: ${banStatusResult.unbanned})`,
            );
          } else {
            logger.debug(
              `[KZ Scraper] Processed ${bans.length} bans (inserted: ${inserted}, updated: ${updated}, no players to update)`,
            );
          }
        }
      }

      stats.bansChecked += totalProcessed;
      stats.bansInserted += totalInserted;
      stats.bansUpdated += totalUpdated;
      stats.playersUpdated += playersUpdated;

      logger.info(
        `[KZ Scraper] Bans check complete: ${totalProcessed} checked, ${totalInserted} inserted, ${totalUpdated} updated, ${playersUpdated} players updated`,
      );

      saveState();
    } finally {
      connection.release();
    }
  } catch (error) {
    logger.error(`[KZ Scraper] Error processing bans: ${error.message}`);
    logger.error(`[KZ Scraper] Stack trace: ${error.stack}`);
    stats.errorCount++;
  } finally {
    isBansRunning = false;
  }
}

/**
 * Main scraper loop
 */
async function runScraper(normalIntervalMs, idleIntervalMs) {
  if (isRunning) {
    logger.debug(
      "[KZ Scraper] Scraper already running, skipping this iteration",
    );
    return;
  }

  isRunning = true;
  let nextInterval = normalIntervalMs;

  try {
    // Check bans periodically (non-blocking)
    processBans().catch((error) => {
      logger.error(`[KZ Scraper] Bans check failed: ${error.message}`);
    });

    const batchResult = await scrapeBatch(currentRecordId + 1, CONCURRENCY);

    // If entire batch was 404s, reset to last successful ID and stay there
    if (batchResult.notFound === CONCURRENCY && batchResult.inserted === 0) {
      // All records in batch were not found - we're caught up
      // Use idle interval (longer delay)
      nextInterval = idleIntervalMs;

      if (stats.lastSuccessfulId > 0) {
        // Reset to last successful ID to keep checking from there
        currentRecordId = stats.lastSuccessfulId;
        logger.debug(
          `[KZ Scraper] All records not found (${CONCURRENCY}/${CONCURRENCY}). ` +
            `Resetting to last successful ID ${currentRecordId}. Next check in ${idleIntervalMs / 1000}s.`,
        );
      } else {
        // No successful records yet - don't increment, stay at current position
        logger.debug(
          `[KZ Scraper] No records found yet at ID ${currentRecordId}. Next check in ${idleIntervalMs / 1000}s.`,
        );
      }
    } else {
      // Normal operation - at least one record found, continue forward
      // Use normal interval (shorter delay)
      nextInterval = normalIntervalMs;
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
    // Use normal interval on error to retry sooner
    nextInterval = normalIntervalMs;
  } finally {
    isRunning = false;
    // Schedule next run with dynamic interval
    scraperTimeout = setTimeout(
      () => runScraper(normalIntervalMs, idleIntervalMs),
      nextInterval,
    );
  }
}

/**
 * Start the scraper job
 */
async function startScraperJob(intervalMs = 3750, idleIntervalMs = 30000) {
  // Normal interval: 3.75 seconds for 80% rate limit utilization
  // Idle interval: 30 seconds when no new records found (default)
  logger.info(
    `[KZ Scraper] Starting KZ Records scraper service (normal interval: ${intervalMs}ms, idle interval: ${idleIntervalMs}ms, concurrency: ${CONCURRENCY}, request delay: ${REQUEST_DELAY}ms)`,
  );
  logger.info(
    `[KZ Scraper] Estimated rate: ~${Math.floor((300 / (intervalMs / 1000)) * CONCURRENCY)} requests per 5 minutes (limit: 500) when actively scraping`,
  );
  logger.info(
    `[KZ Scraper] Idle mode: ~${Math.floor((300 / (idleIntervalMs / 1000)) * CONCURRENCY)} requests per 5 minutes when caught up`,
  );
  logger.info(
    `[KZ Scraper] Bans check enabled (interval: ${BANS_CHECK_INTERVAL / 1000}s)`,
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

  // Run immediately after small delay to let server initialize
  setTimeout(() => {
    runScraper(intervalMs, idleIntervalMs);
  }, 2000);
}

/**
 * Get current scraper statistics
 */
function getStats() {
  const uptime = stats.startTime ? (Date.now() - stats.startTime) / 1000 : 0;
  const rate = uptime > 0 ? Math.round(stats.recordsProcessed / uptime) : 0;
  const timeSinceLastBanCheck =
    lastBanCheck > 0 ? Date.now() - lastBanCheck : null;

  return {
    isRunning,
    isBansRunning,
    currentRecordId,
    uptime: Math.round(uptime),
    recordsProcessed: stats.recordsProcessed,
    recordsInserted: stats.recordsInserted,
    recordsSkipped: stats.recordsSkipped,
    notFoundCount: stats.notFoundCount,
    errorCount: stats.errorCount,
    lastSuccessfulId: stats.lastSuccessfulId,
    averageRate: rate,
    bansChecked: stats.bansChecked,
    bansInserted: stats.bansInserted,
    bansUpdated: stats.bansUpdated,
    playersUpdated: stats.playersUpdated,
    lastBanCheck:
      lastBanCheck > 0 ? new Date(lastBanCheck).toISOString() : null,
    timeSinceLastBanCheck: timeSinceLastBanCheck
      ? Math.round(timeSinceLastBanCheck / 1000)
      : null,
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
