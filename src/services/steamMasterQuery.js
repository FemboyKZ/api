const axios = require("axios");
const logger = require("../utils/logger");

/**
 * Query Steam Master Server API for server information
 *
 * This is the most reliable method for getting CS:GO/CS2 server data:
 * - Official Valve API
 * - Real-time accurate data
 * - Includes all server metadata (players, map, secure status, etc.)
 * - No need for direct server connection
 *
 * @param {string} ip - Server IP address
 * @param {number} port - Server game port
 * @param {string} game - Game type ('csgo' or 'counterstrike2')
 * @returns {Object|null} Server info or null if not found/failed
 */
async function querySteamMaster(ip, port, game) {
  const STEAM_API_KEY = process.env.STEAM_API_KEY;

  if (!STEAM_API_KEY) {
    logger.warn(
      "STEAM_API_KEY not configured - cannot query Steam Master Server",
    );
    return null;
  }

  try {
    // Map game type to Steam AppID
    const appIds = {
      csgo: "730", // CS:GO
      counterstrike2: "730", // CS2 uses same AppID
    };

    const appId = appIds[game] || "730";

    // Build filter for specific server
    const filters = [`appid\\${appId}`, `addr\\${ip}:${port}`];

    const filterString = filters.join("\\");

    logger.debug(`Querying Steam Master Server for ${ip}:${port} (${game})`);

    const response = await axios.get(
      "https://api.steampowered.com/IGameServersService/GetServerList/v1/",
      {
        params: {
          key: STEAM_API_KEY,
          format: "json",
          filter: filterString,
        },
        timeout: 5000, // 5 second timeout
      },
    );

    if (
      !response.data?.response?.servers ||
      response.data.response.servers.length === 0
    ) {
      logger.debug(`Steam Master Server returned no results for ${ip}:${port}`);
      return null;
    }

    const serverData = response.data.response.servers[0];

    // Parse players from gametype field (if available)
    // Steam returns player count in 'players' field directly
    const result = {
      status: 1,
      map: serverData.map || "",
      playerCount: serverData.players || 0,
      maxplayers: serverData.max_players || 0,
      hostname: serverData.name || "",
      version: serverData.version || "",
      secure: serverData.secure || false,
      steamid: serverData.steamid || "",
      gamedir: serverData.gamedir || "",
      gametype: serverData.gametype || "",
      ping: 0, // Steam API doesn't provide ping
      players: [], // Steam Master Server doesn't provide player list with names/IDs
    };

    logger.debug(
      `Steam Master Server query successful: ${ip}:${port} - ${result.playerCount}/${result.maxplayers} players on ${result.map}`,
    );

    return result;
  } catch (error) {
    // Don't log errors as warnings - this is expected to fail sometimes
    logger.debug(
      `Steam Master Server query failed for ${ip}:${port}: ${error.message}`,
    );
    return null;
  }
}

/**
 * Query multiple servers from Steam Master Server in parallel
 *
 * @param {Array} servers - Array of {ip, port, game} objects
 * @returns {Map} Map of 'ip:port' => server data
 */
async function queryMultipleSteamServers(servers) {
  const results = new Map();

  const promises = servers.map(async (server) => {
    const data = await querySteamMaster(server.ip, server.port, server.game);
    if (data) {
      results.set(`${server.ip}:${server.port}`, data);
    }
  });

  await Promise.allSettled(promises);

  return results;
}

module.exports = {
  querySteamMaster,
  queryMultipleSteamServers,
};
