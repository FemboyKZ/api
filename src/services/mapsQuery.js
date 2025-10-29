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

const GOKZ_API_URL = process.env.GOKZ_API_URL || "https://kztimerglobal.com/api/v2";
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
    logger.error(`Failed to fetch map ${mapName} from GOKZ API: ${error.message}`);
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
      // Extract mapper names
      const mappers = response.data.mappers 
        ? response.data.mappers.map(m => m.name).join(', ')
        : null;

      return {
        workshop_id: response.data.workshop_id || null,
        mappers: mappers,
        description: response.data.description || null,
        checksum: response.data.vpk_checksum || null,
        id: response.data.id || null,
        approved_at: response.data.approved_at || null,
      };
    }

    return null;
  } catch (error) {
    logger.error(`Failed to fetch map ${mapName} from CS2KZ API: ${error.message}`);
    return null;
  }
}

/**
 * Update map globalInfo in database for CS:GO maps
 * @param {string} mapName - Name of the map
 * @param {Object} globalInfo - Global info data from GOKZ
 */
async function updateMapGlobalInfo(mapName, globalInfo, game = 'csgo') {
  if (!globalInfo) {
    return;
  }

  try {
    await pool.query(
      `UPDATE maps 
       SET globalInfo = ?, 
           globalInfo_updated_at = NOW()
       WHERE name = ? AND game = ?`,
      [JSON.stringify(globalInfo), mapName, game]
    );

    logger.info(`Updated globalInfo for ${game} map: ${mapName}`);
  } catch (error) {
    logger.error(`Failed to update globalInfo for ${mapName}: ${error.message}`);
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
      [game, CACHE_DURATION_HOURS]
    );

    return rows.map(row => row.name);
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
async function updateMissingGlobalInfo() {
  logger.info('Starting map globalInfo update cycle...');
  
  try {
    // Update CS:GO maps from GOKZ
    const csgoMaps = await getMapsNeedingGlobalInfo('csgo');
    
    if (csgoMaps.length > 0) {
      logger.info(`Updating globalInfo for ${csgoMaps.length} CS:GO maps...`);
      
      let successCount = 0;
      let failCount = 0;
      
      for (const mapName of csgoMaps) {
        const globalInfo = await fetchMapFromGOKZ(mapName);
        if (globalInfo) {
          await updateMapGlobalInfo(mapName, globalInfo, 'csgo');
          successCount++;
        } else {
          failCount++;
        }
        // Small delay to avoid hammering the API
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      logger.info(`Completed CS:GO globalInfo update: ${successCount} successful, ${failCount} not found`);
    } else {
      logger.info('No CS:GO maps need globalInfo updates');
    }

    // Update CS2 maps from CS2KZ
    const cs2Maps = await getMapsNeedingGlobalInfo('counterstrike2');
    
    if (cs2Maps.length > 0) {
      logger.info(`Updating globalInfo for ${cs2Maps.length} CS2 maps...`);
      
      let successCount = 0;
      let failCount = 0;
      
      for (const mapName of cs2Maps) {
        const globalInfo = await fetchMapFromCS2KZ(mapName);
        if (globalInfo) {
          await updateMapGlobalInfo(mapName, globalInfo, 'counterstrike2');
          successCount++;
        } else {
          failCount++;
        }
        // Small delay to avoid hammering the API
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      logger.info(`Completed CS2 globalInfo update: ${successCount} successful, ${failCount} not found`);
    } else {
      logger.info('No CS2 maps need globalInfo updates');
    }
    
    logger.info('Map globalInfo update cycle complete');
  } catch (error) {
    logger.error(`Failed to update missing globalInfo: ${error.message}`);
  }
}

/**
 * Force refresh globalInfo for specific map
 * @param {string} mapName - Map name to refresh
 * @param {string} game - Game type ('csgo' or 'counterstrike2')
 */
async function refreshMapGlobalInfo(mapName, game = 'csgo') {
  let globalInfo;
  
  if (game === 'csgo') {
    globalInfo = await fetchMapFromGOKZ(mapName);
  } else if (game === 'counterstrike2') {
    globalInfo = await fetchMapFromCS2KZ(mapName);
  }
  
  if (globalInfo) {
    await updateMapGlobalInfo(mapName, globalInfo, game);
  }
}

/**
 * Start background globalInfo update job
 * @param {number} intervalMs - Interval in milliseconds (default: 6 hours)
 */
function startGlobalInfoUpdateJob(intervalMs = 6 * 60 * 60 * 1000) {
  logger.info(`Starting map globalInfo update job (interval: ${intervalMs / 1000}s = ${intervalMs / 1000 / 60 / 60}hrs)`);
  logger.info(`GOKZ API URL: ${GOKZ_API_URL}`);
  logger.info(`CS2KZ API URL: ${CS2KZ_API_URL}`);
  logger.info(`Cache duration: ${CACHE_DURATION_HOURS} hours (${CACHE_DURATION_HOURS / 24} days)`);
  
  // Run immediately on startup
  updateMissingGlobalInfo();
  
  // Then run periodically
  setInterval(updateMissingGlobalInfo, intervalMs);
}

module.exports = {
  fetchMapFromGOKZ,
  fetchMapFromCS2KZ,
  updateMapGlobalInfo,
  refreshMapGlobalInfo,
  startGlobalInfoUpdateJob,
  getMapsNeedingGlobalInfo,
};
