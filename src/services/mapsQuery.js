/**
 * Refreshes cached per-map metadata from the GOKZ/CS2KZ APIs.
 * Each map is only re-fetched once its cached copy is a week old, so a full pass stays cheap.
 */

const axios = require("axios");
const pool = require("../db");
const logger = require("../utils/logger");

/**
 * GOKZ/CS2KZ API Service
 *
 * Fetches map data from GlobalKZ API for CS:GO maps and CS2KZ API for CS2 maps.
 *
 * GOKZ API Reference (CS:GO):
 * https://kztimerglobal.com/api/v2/maps/name/{mapname}
 *
 * CS2KZ API Reference (CS2):
 * https://api.cs2kz.org/maps/{mapname}
 */

const GOKZ_API_URL =
  process.env.GOKZ_API_URL || "https://kztimerglobal.com/api/v2";
const CS2KZ_API_URL = process.env.CS2KZ_API_URL || "https://api.cs2kz.org";
const CACHE_DURATION_HOURS = 168; // 7 days - map info doesn't change often

/**
 * Fetch map data from GOKZ API
 * @param {string} mapName - Name of the map (e.g., "kz_synergy_x")
 * @returns {Promise<Object|null>} Map data or null if not found
 */
async function fetchMapFromGOKZ(mapName) {
  try {
    const url = `${GOKZ_API_URL}/maps/name/${encodeURIComponent(mapName)}`;
    logger.debug(`Fetching map data from GOKZ: ${url}`);

    const response = await axios.get(url, {
      timeout: 10000,
      validateStatus: (status) => status === 200 || status === 404,
    });

    if (response.status === 404) {
      logger.debug(`Map ${mapName} not found in GOKZ API`);
      return null;
    }

    if (response.data) {
      return {
        workshop_url: response.data.workshop_url || null,
        difficulty: response.data.difficulty || null,
        filesize: response.data.filesize || null,
        id: response.data.id || null,
        validated: response.data.validated || null,
        created_on: response.data.created_on || null,
        updated_on: response.data.updated_on || null,
        download_url: response.data.download_url || null,
      };
    }

    return null;
  } catch (error) {
    logger.error(
      `Failed to fetch map ${mapName} from GOKZ API: ${error.message}`,
    );
    return null;
  }
}

/**
 * Fetch map data from CS2KZ API
 * @param {string} mapName - Name of the map (e.g., "kz_grotto")
 * @returns {Promise<Object|null>} Map data or null if not found
 */
async function fetchMapFromCS2KZ(mapName) {
  try {
    const url = `${CS2KZ_API_URL}/maps/${encodeURIComponent(mapName)}`;
    logger.debug(`Fetching map data from CS2KZ: ${url}`);

    const response = await axios.get(url, {
      timeout: 10000,
      validateStatus: (status) => status === 200 || status === 404,
    });

    if (response.status === 404) {
      logger.debug(`Map ${mapName} not found in CS2KZ API`);
      return null;
    }

    if (response.data) {
      // Keep mappers as array of objects with full details
      const mappers = response.data.mappers || [];

      // Keep courses with their full details
      const courses = response.data.courses || [];

      return {
        workshop_id: response.data.workshop_id || null,
        mappers: mappers, // Array of {name, id} objects
        description: response.data.description || null,
        checksum: response.data.vpk_checksum || null,
        id: response.data.id || null,
        approved_at: response.data.approved_at || null,
        courses: courses, // Array of course objects with filters, difficulty, etc.
        created_at: response.data.created_at || null,
        updated_at: response.data.updated_at || null,
      };
    }

    return null;
  } catch (error) {
    logger.error(
      `Failed to fetch map ${mapName} from CS2KZ API: ${error.message}`,
    );
    return null;
  }
}

/**
 * Update map globalInfo in database for CS:GO maps
 * @param {string} mapName - Name of the map
 * @param {Object} globalInfo - Global info data from GOKZ
 */
async function updateMapGlobalInfo(mapName, globalInfo, game = "csgo") {
  if (!globalInfo) {
    return;
  }

  try {
    await pool.query(
      `UPDATE maps 
       SET globalInfo = ?, 
           globalInfo_updated_at = NOW()
       WHERE name = ? AND game = ?`,
      [JSON.stringify(globalInfo), mapName, game],
    );

    logger.info(`Updated globalInfo for ${game} map: ${mapName}`);
  } catch (error) {
    logger.error(
      `Failed to update globalInfo for ${mapName}: ${error.message}`,
    );
  }
}

/**
 * Get maps that need globalInfo updates (never fetched or cache expired)
 * @param {string} game - Game type ('csgo' or 'counterstrike2')
 * @returns {Promise<string[]>} Array of map names needing updates
 */
async function getMapsNeedingGlobalInfo(game) {
  try {
    const [rows] = await pool.query(
      `SELECT DISTINCT name 
       FROM maps 
       WHERE game = ?
         AND (globalInfo_updated_at IS NULL 
              OR globalInfo_updated_at < DATE_SUB(NOW(), INTERVAL ? HOUR))`,
      [game, CACHE_DURATION_HOURS],
    );

    return rows.map((row) => row.name);
  } catch (error) {
    logger.error(`Failed to get maps needing globalInfo: ${error.message}`);
    return [];
  }
}

/**
 * Background job to update globalInfo for both CS:GO and CS2 maps
 * Runs periodically to keep map data fresh
 * Processes ALL maps that need updates (no limit)
 */
/**
 * Which upstream API serves each game's map metadata.
 */
const GAME_SOURCES = [
  { game: "csgo", label: "CS:GO", fetch: fetchMapFromGOKZ },
  { game: "counterstrike2", label: "CS2", fetch: fetchMapFromCS2KZ },
];

/**
 * Refresh globalInfo for every stale map of one game.
 * @param {{game: string, label: string, fetch: Function}} source
 */
async function updateGlobalInfoForGame({ game, label, fetch }) {
  const maps = await getMapsNeedingGlobalInfo(game);

  if (maps.length === 0) {
    logger.info(`No ${label} maps need globalInfo updates`);
    return;
  }

  logger.info(`Updating globalInfo for ${maps.length} ${label} maps...`);

  let successCount = 0;
  let failCount = 0;

  for (const mapName of maps) {
    const globalInfo = await fetch(mapName);
    if (globalInfo) {
      await updateMapGlobalInfo(mapName, globalInfo, game);
      successCount++;
    } else {
      failCount++;
    }
    // Small delay to avoid hammering the API
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  logger.info(
    `Completed ${label} globalInfo update: ${successCount} successful, ${failCount} not found`,
  );
}

async function updateMissingGlobalInfo() {
  logger.info("Starting map globalInfo update cycle...");

  try {
    for (const source of GAME_SOURCES) {
      await updateGlobalInfoForGame(source);
    }

    logger.info("Map globalInfo update cycle complete");
  } catch (error) {
    logger.error(`Failed to update missing globalInfo: ${error.message}`);
  }
}

/**
 * Force refresh globalInfo for specific map
 * @param {string} mapName - Map name to refresh
 * @param {string} game - Game type ('csgo' or 'counterstrike2')
 */
async function refreshMapGlobalInfo(mapName, game = "csgo") {
  const source = GAME_SOURCES.find((s) => s.game === game);
  if (!source) {
    logger.warn(`No map metadata source for game "${game}"`);
    return;
  }

  const globalInfo = await source.fetch(mapName);

  if (globalInfo) {
    await updateMapGlobalInfo(mapName, globalInfo, game);
  }
}

/**
 * Start background globalInfo update job
 * @param {number} intervalMs - Interval in milliseconds (default: 6 hours)
 */
const GLOBALINFO_INTERVAL =
  parseInt(process.env.MAP_GLOBALINFO_INTERVAL, 10) || 6 * 60 * 60 * 1000;

let globalInfoTimer = null;

function startGlobalInfoUpdateJob(intervalMs = GLOBALINFO_INTERVAL) {
  logger.info(
    `Starting map globalInfo update job (interval: ${intervalMs / 1000}s = ${intervalMs / 1000 / 60 / 60}hrs)`,
  );
  logger.info(`GOKZ API URL: ${GOKZ_API_URL}`);
  logger.info(`CS2KZ API URL: ${CS2KZ_API_URL}`);
  logger.info(
    `Cache duration: ${CACHE_DURATION_HOURS} hours (${CACHE_DURATION_HOURS / 24} days)`,
  );

  // Run immediately on startup
  updateMissingGlobalInfo();

  // Then run periodically
  globalInfoTimer = setInterval(updateMissingGlobalInfo, intervalMs);
}

function stopGlobalInfoUpdateJob() {
  clearInterval(globalInfoTimer);
  globalInfoTimer = null;
}

module.exports = {
  fetchMapFromGOKZ,
  fetchMapFromCS2KZ,
  updateMapGlobalInfo,
  refreshMapGlobalInfo,
  startGlobalInfoUpdateJob,
  stopGlobalInfoUpdateJob,
  GLOBALINFO_INTERVAL,
  getMapsNeedingGlobalInfo,
};
