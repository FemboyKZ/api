const axios = require("axios");
const { getKzPool } = require("../db/kzRecords");
const logger = require("../utils/logger");

/**
 * KZTimer World Records Sync Service
 *
 * Fetches world records from KZTimer Global API and updates our database.
 * This allows the site to get WR holder info without making individual API calls.
 *
 * Supports all 3 modes: kz_timer, kz_simple, kz_vanilla
 * For each mode, tracks both:
 * - Pro WR (no teleports)
 * - Overall WR (best time regardless of teleports)
 *
 * KZTimer API Reference:
 * https://kztimerglobal.com/api/v2/records/top
 */

const GOKZ_API_URL =
  process.env.GOKZ_API_URL || "https://kztimerglobal.com/api/v2";

// All WR types to sync for each map
const WR_TYPES = [
  { mode: "kz_timer", hasTeleports: false, columnPrefix: "wr_kz_timer_pro" },
  { mode: "kz_timer", hasTeleports: null, columnPrefix: "wr_kz_timer_overall" }, // null = any
  { mode: "kz_simple", hasTeleports: false, columnPrefix: "wr_kz_simple_pro" },
  {
    mode: "kz_simple",
    hasTeleports: null,
    columnPrefix: "wr_kz_simple_overall",
  },
  {
    mode: "kz_vanilla",
    hasTeleports: false,
    columnPrefix: "wr_kz_vanilla_pro",
  },
  {
    mode: "kz_vanilla",
    hasTeleports: null,
    columnPrefix: "wr_kz_vanilla_overall",
  },
];

/**
 * Fetch world record from KZTimer API for a specific map/mode/type
 * @param {string} mapName - Name of the map
 * @param {Object} options - Query options
 * @returns {Promise<Object|null>} World record data or null
 */
async function fetchWorldRecordFromKZTimer(mapName, options = {}) {
  try {
    const params = {
      map_name: mapName,
      modes_list_string: options.mode || "kz_timer",
      stage: options.stage ?? 0,
      tickrate: options.tickrate || 128,
      limit: 1,
    };

    // Only add has_teleports if explicitly false (pro runs)
    // For overall, we don't pass the param to get the absolute best time
    if (options.hasTeleports === false) {
      params.has_teleports = false;
    }

    const url = `${GOKZ_API_URL}/records/top`;
    logger.debug(
      `Fetching WR from KZTimer: ${mapName} (${options.mode}, ${options.hasTeleports === false ? "pro" : "overall"})`,
    );

    const response = await axios.get(url, {
      params,
      timeout: 10000,
      validateStatus: (status) => status === 200 || status === 404,
    });

    if (
      response.status === 404 ||
      !response.data ||
      response.data.length === 0
    ) {
      return null;
    }

    const wr = response.data[0];
    return {
      time: wr.time,
      steamid64: wr.steamid64,
      playerName: wr.player_name,
      recordId: wr.id,
      mode: wr.mode,
      teleports: wr.teleports,
      points: wr.points,
      serverName: wr.server_name,
      createdOn: wr.created_on,
    };
  } catch (error) {
    logger.error(
      `Failed to fetch WR for ${mapName} from KZTimer: ${error.message}`,
    );
    return null;
  }
}

/**
 * Update all world record types for a map in kz_map_statistics
 * @param {number} mapId - Internal map ID
 * @param {Object} wrsByType - Object with WR data keyed by column prefix
 */
async function updateMapWorldRecords(mapId, wrsByType) {
  const pool = getKzPool();
  if (!pool) {
    logger.error("KZ database pool not initialized");
    return false;
  }

  try {
    // Build dynamic SET clause for all WR types
    const setClauses = [];
    const values = [];

    for (const wrType of WR_TYPES) {
      const wr = wrsByType[wrType.columnPrefix];
      const prefix = wrType.columnPrefix;

      setClauses.push(`${prefix}_time = ?`);
      setClauses.push(`${prefix}_steamid64 = ?`);
      setClauses.push(`${prefix}_player_name = ?`);
      setClauses.push(`${prefix}_record_id = ?`);

      if (wr) {
        values.push(wr.time, wr.steamid64, wr.playerName, wr.recordId);
      } else {
        values.push(null, null, null, null);
      }

      // Add teleports column for overall types
      if (wrType.hasTeleports === null) {
        setClauses.push(`${prefix}_teleports = ?`);
        values.push(wr ? wr.teleports : null);
      }
    }

    setClauses.push("world_records_synced_at = NOW()");
    values.push(mapId);

    await pool.query(
      `UPDATE kz_map_statistics 
       SET ${setClauses.join(", ")}
       WHERE map_id = ?`,
      values,
    );

    return true;
  } catch (error) {
    logger.error(`Failed to update WRs for map ID ${mapId}: ${error.message}`);
    return false;
  }
}

/**
 * Get maps that need WR sync (never synced)
 * @returns {Promise<Array>} Array of maps needing WR sync
 */
async function getMapsNeedingWRSync(limit = 100) {
  const pool = getKzPool();
  if (!pool) {
    logger.error("KZ database pool not initialized");
    return [];
  }

  try {
    const [rows] = await pool.query(
      `SELECT 
        m.id,
        m.map_name,
        ms.world_records_synced_at
       FROM kz_maps m
       LEFT JOIN kz_map_statistics ms ON m.id = ms.map_id
       WHERE m.validated = TRUE
         AND ms.world_records_synced_at IS NULL
       ORDER BY m.map_name ASC
       LIMIT ?`,
      [limit],
    );

    return rows;
  } catch (error) {
    logger.error(`Failed to get maps needing WR sync: ${error.message}`);
    return [];
  }
}

/**
 * Sync all WR types for a single map
 * @param {Object} map - Map object with id and map_name
 * @returns {Promise<number>} Number of WR types successfully synced
 */
async function syncAllWorldRecordsForMap(map) {
  const wrsByType = {};
  let syncedCount = 0;

  // Fetch all 6 WR types for this map
  for (const wrType of WR_TYPES) {
    try {
      const wr = await fetchWorldRecordFromKZTimer(map.map_name, {
        mode: wrType.mode,
        hasTeleports: wrType.hasTeleports,
        stage: 0,
      });

      wrsByType[wrType.columnPrefix] = wr;
      if (wr) syncedCount++;

      // Small delay between requests to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 50));
    } catch (error) {
      logger.error(
        `Failed to fetch ${wrType.columnPrefix} for ${map.map_name}: ${error.message}`,
      );
    }
  }

  // Update all WRs in a single query
  await updateMapWorldRecords(map.id, wrsByType);

  return syncedCount;
}

/**
 * Background job to sync world records from KZTimer API
 * Runs periodically to keep WR data fresh
 */
async function syncWorldRecords() {
  logger.info("Starting world records sync cycle...");

  const pool = getKzPool();
  if (!pool) {
    logger.warn("KZ database not available, skipping WR sync");
    return;
  }

  try {
    const mapsNeedingSync = await getMapsNeedingWRSync();

    if (mapsNeedingSync.length === 0) {
      logger.info("No maps need WR sync");
      return;
    }

    logger.info(
      `Syncing world records for ${mapsNeedingSync.length} maps (6 WR types each)...`,
    );

    let successCount = 0;
    let errorCount = 0;

    for (const map of mapsNeedingSync) {
      try {
        const syncedWRs = await syncAllWorldRecordsForMap(map);
        logger.debug(`Synced ${syncedWRs} WR types for ${map.map_name}`);
        successCount++;

        // Delay between maps
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (error) {
        logger.error(
          `Failed to sync WRs for ${map.map_name}: ${error.message}`,
        );
        errorCount++;
      }
    }

    logger.info(
      `WR sync complete: ${successCount} maps synced, ${errorCount} errors`,
    );
  } catch (error) {
    logger.error(`Failed to sync world records: ${error.message}`);
  }
}

/**
 * Force refresh all world records for a specific map
 * @param {string} mapName - Map name to refresh
 * @returns {Promise<Object|null>} Object with all WR types or null
 */
async function refreshMapWorldRecord(mapName) {
  const pool = getKzPool();
  if (!pool) {
    logger.error("KZ database pool not initialized");
    return null;
  }

  try {
    // Get map ID
    const [maps] = await pool.query(
      "SELECT id, map_name FROM kz_maps WHERE map_name = ?",
      [mapName],
    );

    if (maps.length === 0) {
      logger.warn(`Map ${mapName} not found in database`);
      return null;
    }

    const map = maps[0];
    await syncAllWorldRecordsForMap(map);

    logger.info(`Force refreshed all WRs for ${mapName}`);
    return true;
  } catch (error) {
    logger.error(`Failed to refresh WRs for ${mapName}: ${error.message}`);
    return null;
  }
}

/**
 * Initial population of WR data from KZTimer API
 * This runs once on startup to fill missing WR holder info for all modes
 * After initial population, WRs are updated by the scraper when new records are inserted
 */
async function initialPopulateWorldRecords() {
  logger.info(
    "Starting initial world records population (all modes, pro + overall)...",
  );

  const pool = getKzPool();
  if (!pool) {
    logger.warn("KZ database not available, skipping initial WR population");
    return;
  }

  try {
    // Check if new WR columns exist
    const [columnCheck] = await pool.query(
      `SELECT COUNT(*) as count FROM information_schema.columns 
       WHERE table_schema = DATABASE() 
       AND table_name = 'kz_map_statistics' 
       AND column_name = 'wr_kz_timer_pro_time'`,
    );

    if (columnCheck[0].count === 0) {
      logger.warn(
        "New WR columns not found in kz_map_statistics, run expand_wr_to_all_modes.sql migration first",
      );
      return;
    }

    // Get maps that have never been synced (initial population only)
    const mapsNeedingSync = await getMapsNeedingWRSync(100);

    if (mapsNeedingSync.length === 0) {
      logger.info("Initial WR population complete - all maps have been synced");
      return;
    }

    logger.info(
      `Initial WR population: syncing ${mapsNeedingSync.length} maps (6 WR types each)...`,
    );

    let successCount = 0;
    let errorCount = 0;

    for (const map of mapsNeedingSync) {
      try {
        const syncedWRs = await syncAllWorldRecordsForMap(map);
        logger.debug(
          `Initial sync: ${map.map_name} - ${syncedWRs} WR types found`,
        );
        successCount++;

        // Rate limit: delay between maps (each map makes 6 API calls)
        await new Promise((resolve) => setTimeout(resolve, 200));
      } catch (error) {
        logger.error(
          `Failed to sync WRs for ${map.map_name}: ${error.message}`,
        );
        errorCount++;
      }
    }

    logger.info(
      `Initial WR population batch complete: ${successCount} maps synced, ${errorCount} errors`,
    );

    // If there are more maps to sync, schedule another batch
    if (mapsNeedingSync.length === 100) {
      logger.info(
        "More maps need initial WR sync, scheduling next batch in 5 minutes...",
      );
      setTimeout(initialPopulateWorldRecords, 5 * 60 * 1000);
    } else {
      logger.info("Initial WR population complete!");
    }
  } catch (error) {
    logger.error(`Failed to populate world records: ${error.message}`);
  }
}

/**
 * Start initial WR population job (runs once on startup, then continues until all maps are synced)
 */
function startWorldRecordsSyncJob() {
  logger.info("Starting world records initial population job");
  logger.info(`KZTimer API URL: ${GOKZ_API_URL}`);
  logger.info(
    "Syncing 6 WR types per map: kz_timer/kz_simple/kz_vanilla × pro/overall",
  );
  logger.info(
    "Note: After initial population, WRs are updated by the scraper on new records",
  );

  // Run after a short delay on startup (give DB time to initialize)
  setTimeout(() => {
    initialPopulateWorldRecords();
  }, 15000);
}

module.exports = {
  fetchWorldRecordFromKZTimer,
  updateMapWorldRecords,
  getMapsNeedingWRSync,
  syncAllWorldRecordsForMap,
  syncWorldRecords,
  initialPopulateWorldRecords,
  refreshMapWorldRecord,
  startWorldRecordsSyncJob,
  WR_TYPES,
};
