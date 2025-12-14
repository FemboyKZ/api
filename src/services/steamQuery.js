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
 * Note: Steam provides three avatar sizes (32x32, 64x64, 184x184), but they're all
 * the same image with different size suffixes (_medium.jpg, _full.jpg).
 * We only store the base URL to save space.
 */

const STEAM_API_URL =
  "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/";
const CACHE_DURATION_HOURS = 24; // How long to cache avatar URLs before refreshing

/**
 * Fetch avatars for multiple Steam IDs from Steam API
 * @param {string[]} steamIds - Array of Steam IDs (max 100 per request)
 * @returns {Promise<Object>} Map of steamid -> avatar URL (32x32, base size)
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
          // Only store the base avatar URL (32x32)
          // Can construct larger sizes by appending _medium.jpg or _full.jpg
          results[player.steamid] = player.avatar || null;
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

  for (const [steamid, avatar] of Object.entries(avatarData)) {
    try {
      await pool.query(
        `UPDATE players 
         SET avatar = ?, 
             avatar_updated_at = NOW()
         WHERE steamid = ?`,
        [avatar, steamid],
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

/**
 * Fetch player summary from Steam API and optionally save to database
 * @param {string} steamid - Steam ID64 of the player
 * @param {boolean} saveToDb - Whether to create a player record in the database
 * @returns {Promise<Object|null>} Player summary or null if not found
 */
async function getPlayerSummary(steamid, saveToDb = false) {
  const STEAM_API_KEY = process.env.STEAM_API_KEY;

  if (!STEAM_API_KEY) {
    logger.warn("STEAM_API_KEY not configured - cannot fetch player summary");
    return null;
  }

  try {
    const response = await axios.get(STEAM_API_URL, {
      params: {
        key: STEAM_API_KEY,
        steamids: steamid,
      },
      timeout: 10000,
    });

    if (
      !response.data ||
      !response.data.response ||
      !response.data.response.players ||
      response.data.response.players.length === 0
    ) {
      return null;
    }

    const steamPlayer = response.data.response.players[0];

    const playerData = {
      steamid: steamPlayer.steamid,
      name: steamPlayer.personaname,
      avatar: steamPlayer.avatar || null,
      profileUrl: steamPlayer.profileurl,
      personaState: steamPlayer.personastate,
    };

    // Optionally save to database as a new player with 0 playtime
    if (saveToDb) {
      try {
        // Insert a placeholder record so we have the player in our system
        // Using 'csgo' as default game since we need a game value
        await pool.query(
          `INSERT INTO players (steamid, name, avatar, avatar_updated_at, game, playtime, server_ip, server_port, last_seen)
           VALUES (?, ?, ?, NOW(), 'csgo', 0, '0.0.0.0', 0, NOW())
           ON DUPLICATE KEY UPDATE 
             name = VALUES(name),
             avatar = VALUES(avatar),
             avatar_updated_at = NOW()`,
          [playerData.steamid, playerData.name, playerData.avatar],
        );
        logger.info(
          `Created/updated player record for ${playerData.steamid} (${playerData.name})`,
        );
      } catch (dbError) {
        logger.error(`Failed to save player to database: ${dbError.message}`);
        // Continue anyway - we still have the Steam data
      }
    }

    return playerData;
  } catch (error) {
    logger.error(`Failed to fetch player summary from Steam: ${error.message}`);
    return null;
  }
}

module.exports = {
  fetchAvatarsFromSteam,
  updateAvatarsInDatabase,
  refreshAvatars,
  startAvatarUpdateJob,
  getSteamIdsNeedingAvatars,
  getPlayerSummary,
};
