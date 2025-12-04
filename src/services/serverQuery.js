const { GameDig } = require("gamedig");
const logger = require("../utils/logger");
const { queryRcon, convertToSteamID64 } = require("./rconQuery");
const { querySteamMaster } = require("./steamMasterQuery");

/**
 * Query a game server with fallback strategy:
 * 1. Steam Master Server (primary) - Official Valve API, most reliable
 * 2. RCON (fallback) - For player details and extended metadata
 * 3. GameDig (fallback) - Direct server query if Steam/RCON fail
 *
 * Steam Master Server provides:
 * - Real-time accurate status from Valve's official API
 * - Server metadata: name, map, player count, version, secure status
 * - No direct connection needed, bypasses firewall/network issues
 * - Does NOT provide individual player names or Steam IDs
 *
 * RCON provides (when configured):
 * - Steam IDs for all players (SteamID64 format)
 * - Player details: connection time, ping, loss, IP address
 * - Additional server metadata: hostname, OS, bot count
 *
 * GameDig provides (fallback):
 * - Basic status when Steam API unavailable
 * - Player names (no Steam IDs)
 * - Map and player count
 *
 * @param {string} ip - Server IP address
 * @param {number} port - Game server query port
 * @param {string} game - Game type ('csgo', 'counterstrike2', etc.)
 * @param {number} rconPort - RCON port (optional)
 * @param {string} rconPassword - RCON password (optional)
 * @returns {Object} Server status with players, map, metadata
 */
async function queryServer(ip, port, game, rconPort, rconPassword) {
  try {
    logger.info(`Querying ${ip}:${port} (${game})`);

    // STRATEGY 1: Try Steam Master Server first (most reliable)
    let result = await querySteamMaster(ip, port, game);
    let dataSource = "steam";

    // STRATEGY 2: Fallback to GameDig if Steam fails
    if (!result) {
      logger.debug(`Steam Master Server failed, trying GameDig for ${ip}:${port}`);
      try {
        const state = await GameDig.query({
          type: game,
          host: ip,
          port: port,
          socketTimeout: 3000,
        });

        result = {
          status: 1,
          map: state.map || "",
          players: state.players.map((p) => ({
            name: p.name?.trim() || null,
            score: p.raw?.score || 0,
            time: p.raw?.time || 0,
          })),
          playersRaw: state.players.raw || {},
          maxplayers: state.maxplayers || 0,
          version: state.version || "",
          playerCount: state.players.length || state.numplayers || 0,
          ping: state.ping || 0,
        };
        dataSource = "gamedig";
        logger.info(`GameDig query successful: ${ip}:${port} - ${result.playerCount} players`);
      } catch (gamedigError) {
        logger.error(`GameDig also failed for ${ip}:${port}: ${gamedigError.message}`);
        return { status: 0 };
      }
    }

    // STRATEGY 3: Query RCON for detailed player data (always try if configured)
    let rconData = null;
    if (rconPassword && rconPort) {
      rconData = await queryRcon(ip, rconPort, rconPassword, game);
    }

    // Merge RCON player data if available
    if (rconData?.players?.length > 0) {
      result.players = rconData.players.map((p) => {
        const cleanName = p.name?.trim() || null;
        return {
          name: cleanName,
          steamid: p.steamid ? convertToSteamID64(p.steamid) : null,
          ip: p.ip || null,
          time: p.time || null,
          ping: p.ping || 0,
          loss: p.loss || 0,
          userid: p.userid || 0,
          state: p.state || "active",
          bot: p.bot || false,
        };
      });
      // Update player count from RCON (more accurate)
      result.playerCount = rconData.players.length;
      dataSource = dataSource === "steam" ? "steam+rcon" : "gamedig+rcon";
    }

    // Add RCON metadata if available
    if (rconData?.serverInfo) {
      result.hostname = rconData.serverInfo.hostname || result.hostname || null;
      result.os = rconData.serverInfo.os || null;
      result.secure = rconData.serverInfo.secure !== undefined 
        ? rconData.serverInfo.secure 
        : result.secure;
      result.bots = rconData.serverInfo.botCount || 0;
    }

    logger.info(
      `Server query successful [${dataSource}]: ${ip}:${port} - ${result.playerCount}/${result.maxplayers} players on ${result.map}`,
    );

    return result;
  } catch (error) {
    logger.error(`Failed to query ${ip}:${port}: ${error.message}`);
    return { status: 0 };
  }
}

module.exports = { queryServer };
