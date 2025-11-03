const axios = require("axios");
const pool = require("../db");
const logger = require("../utils/logger");

/**
 * Steam Avatar Service
 *
 * Fetches player avatar URLs from Steam Web API and caches them in the database.
 *
 * Steam Web API Reference:
 * https://developer.valvesoftware.com/wiki/Steam_Web_API#GetPlayerSummaries_.28v0002.29
 *
 * Avatars returned:
 * - avatar (32x32)
 * - avatarmedium (64x64)
 * - avatarfull (184x184)
 */

const STEAM_API_URL =
  "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/";
const CACHE_DURATION_HOURS = 24; // How long to cache avatar URLs before refreshing

/**
 * Fetch avatars for multiple Steam IDs from Steam API
 * @param {string[]} steamIds - Array of Steam IDs (max 100 per request)
 * @returns {Promise<Object>} Map of steamid -> avatar data
 */
async function fetchAvatarsFromSteam(steamIds) {
  const STEAM_API_KEY = process.env.STEAM_API_KEY;

  if (!STEAM_API_KEY) {
    logger.warn("STEAM_API_KEY not configured - cannot fetch avatars");
    return {};
  }

  if (!steamIds || steamIds.length === 0) {
    return {};
  }

  // Steam API supports up to 100 Steam IDs per request
  const batchSize = 100;
  const batches = [];
  for (let i = 0; i < steamIds.length; i += batchSize) {
    batches.push(steamIds.slice(i, i + batchSize));
  }

  const results = {};

  for (const batch of batches) {
    try {
      const response = await axios.get(STEAM_API_URL, {
        params: {
          key: STEAM_API_KEY,
          steamids: batch.join(","),
        },
        timeout: 10000,
      });

      if (
        response.data &&
        response.data.response &&
        response.data.response.players
      ) {
        for (const player of response.data.response.players) {
          results[player.steamid] = {
            avatar_small: player.avatar || null,
            avatar_medium: player.avatarmedium || null,
            avatar_full: player.avatarfull || null,
          };
        }
      }
    } catch (error) {
      logger.error(`Failed to fetch avatars from Steam API: ${error.message}`);
    }
  }

  return results;
}

/**
 * Update avatars in database for given Steam IDs
 * @param {string[]} steamIds - Array of Steam IDs to update
 */
async function updateAvatarsInDatabase(steamIds) {
  if (!steamIds || steamIds.length === 0) {
    return;
  }

  const avatarData = await fetchAvatarsFromSteam(steamIds);

  for (const [steamid, avatars] of Object.entries(avatarData)) {
    try {
      await pool.query(
        `UPDATE players 
         SET avatar_small = ?, 
             avatar_medium = ?, 
             avatar_full = ?, 
             avatar_updated_at = NOW()
         WHERE steamid = ?`,
        [
          avatars.avatar_small,
          avatars.avatar_medium,
          avatars.avatar_full,
          steamid,
        ],
      );
    } catch (error) {
      logger.error(`Failed to update avatar for ${steamid}: ${error.message}`);
    }
  }

  logger.info(`Updated avatars for ${Object.keys(avatarData).length} players`);
}

/**
 * Get Steam IDs that need avatar updates (never fetched or cache expired)
 * @param {number} limit - Maximum number of Steam IDs to return
 * @returns {Promise<string[]>} Array of Steam IDs needing updates
 */
async function getSteamIdsNeedingAvatars(limit = 100) {
  try {
    const [rows] = await pool.query(
      `SELECT DISTINCT steamid 
       FROM players 
       WHERE avatar_updated_at IS NULL 
          OR avatar_updated_at < DATE_SUB(NOW(), INTERVAL ? HOUR)
       LIMIT ?`,
      [CACHE_DURATION_HOURS, limit],
    );

    return rows.map((row) => row.steamid);
  } catch (error) {
    logger.error(`Failed to get Steam IDs needing avatars: ${error.message}`);
    return [];
  }
}

/**
 * Background job to update avatars for players missing them
 * Runs periodically to keep avatar cache fresh
 */
async function updateMissingAvatars() {
  try {
    const steamIds = await getSteamIdsNeedingAvatars(100);

    if (steamIds.length > 0) {
      logger.info(`Updating avatars for ${steamIds.length} players...`);
      await updateAvatarsInDatabase(steamIds);
    }
  } catch (error) {
    logger.error(`Failed to update missing avatars: ${error.message}`);
  }
}

/**
 * Force refresh avatars for specific Steam IDs
 * @param {string|string[]} steamIds - Steam ID or array of Steam IDs
 */
async function refreshAvatars(steamIds) {
  const ids = Array.isArray(steamIds) ? steamIds : [steamIds];
  await updateAvatarsInDatabase(ids);
}

/**
 * Start background avatar update job
 * @param {number} intervalMs - Interval in milliseconds (default: 1 hour)
 */
function startAvatarUpdateJob(intervalMs = 60 * 60 * 1000) {
  logger.info(`Starting avatar update job (interval: ${intervalMs / 1000}s)`);

  // Run immediately on startup
  updateMissingAvatars();

  // Then run periodically
  setInterval(updateMissingAvatars, intervalMs);
}

module.exports = {
  fetchAvatarsFromSteam,
  updateAvatarsInDatabase,
  refreshAvatars,
  startAvatarUpdateJob,
  getSteamIdsNeedingAvatars,
};
