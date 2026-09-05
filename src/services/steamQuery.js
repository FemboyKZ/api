const axios = require("axios");
const pool = require("../db");
const logger = require("../utils/logger");

/**
 * Steam Player Lookup
 *
 * Resolves a SteamID to that player's public profile via the Steam Web API,
 * used by GET /players/:steamid when we have never seen the player on a server.
 *
 * Steam Web API Reference:
 * https://developer.valvesoftware.com/wiki/Steam_Web_API#GetPlayerSummaries_.28v0002.29
 *
 */

const STEAM_API_URL =
  "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/";

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
      profileUrl: steamPlayer.profileurl,
      personaState: steamPlayer.personastate,
    };

    // Optionally save to database as a new player with 0 playtime
    if (saveToDb) {
      try {
        // Insert a placeholder record so we have the player in our system
        // Using 'csgo' as default game since we need a game value latest_name,
        // not the deprecated `name` column - it is what every read path selects.
        await pool.query(
          `INSERT INTO players (steamid, latest_name, game, playtime, server_ip, server_port, last_seen)
           VALUES (?, ?, 'csgo', 0, '0.0.0.0', 0, NOW())
           ON DUPLICATE KEY UPDATE 
             latest_name = VALUES(latest_name)`,
          [playerData.steamid, playerData.name],
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

module.exports = { getPlayerSummary };
