const { GameDig } = require("gamedig");
const logger = require("../utils/logger");
const { querySteamMaster } = require("./steamMasterQuery");

/**
 * Query a game server with fallback strategy:
 * 1. Steam Master Server (primary) - Official Valve API, most reliable
 * 2. GameDig (fallback) - Direct server query if Steam API unavailable
 *
 * Player details (Steam IDs, connection times, etc.) are provided by the
 * in-game plugin via the live status endpoint, not by polling.
 *
 * @param {string} ip - Server IP address
 * @param {number} port - Game server query port
 * @param {string} game - Game type ('csgo', 'counterstrike2', etc.)
 * @returns {Object} Server status with players, map, metadata
 */
async function queryServer(ip, port, game) {
  try {
    logger.debug(`Querying ${ip}:${port} (${game})`);

    // STRATEGY 1: Try Steam Master Server first (most reliable)
    let result = await querySteamMaster(ip, port, game);
    let dataSource = "steam";

    // STRATEGY 2: Fallback to GameDig if Steam fails
    if (!result) {
      logger.debug(
        `Steam Master Server failed, trying GameDig for ${ip}:${port}`,
      );
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
        logger.debug(
          `GameDig query successful: ${ip}:${port} - ${result.playerCount} players`,
        );
      } catch (gamedigError) {
        logger.error(
          `GameDig also failed for ${ip}:${port}: ${gamedigError.message}`,
        );
        return { status: 0 };
      }
    }

    logger.debug(
      `Server query successful [${dataSource}]: ${ip}:${port} - ${result.playerCount}/${result.maxplayers} players on ${result.map}`,
    );

    return result;
  } catch (error) {
    logger.error(`Failed to query ${ip}:${port}: ${error.message}`);
    return { status: 0 };
  }
}

module.exports = { queryServer };
