const { GameDig } = require("gamedig");
const logger = require("../utils/logger");
const { queryRcon, convertToSteamID64 } = require("./rconQuery");

/**
 * Query a game server using GameDig and optionally RCON for extended data
 * 
 * GameDig provides: status, map, player count, basic player info (no Steam IDs)
 * RCON provides: Steam IDs, hostname, OS, secure status, owner Steam ID, bot count, detailed player stats
 * 
 * When RCON is available and returns player data, it is used exclusively instead of GameDig player data.
 * This is because RCON provides more accurate and complete information including Steam IDs.
 * 
 * @param {string} ip - Server IP address
 * @param {number} port - Server game port
 * @param {string} game - Game type (csgo, counterstrike2, etc.)
 * @param {number} rconPort - RCON port (optional)
 * @param {string} rconPassword - RCON password (optional)
 * @returns {Object} Server status including players, map, version, and RCON data if available
 */
async function queryServer(ip, port, game, rconPort, rconPassword) {
  try {
    // GameDig query type - use game type directly from config
    const queryType = game;

    logger.info(
      `Querying ${ip}:${port} as type '${queryType}' (original: ${game})`,
    );

    const state = await GameDig.query({
      type: queryType,
      host: ip,
      port: port,
      socketTimeout: 3000,
    });

    logger.info(
      `Successfully queried ${ip}:${port} - ${state.players.length} players`,
    );

    // Try to get detailed player info and server metadata via RCON if configured
    let rconData = null;
    if (rconPassword && rconPort) {
      rconData = await queryRcon(ip, rconPort, rconPassword);
    }

    // Use RCON player data exclusively if available (has Steam IDs and better accuracy)
    // Otherwise fall back to GameDig player data (no Steam IDs)
    let players = [];
    if (rconData && rconData.players && rconData.players.length > 0) {
      // RCON data: convert Steam IDs to SteamID64 format for consistency
      players = rconData.players.map((p) => ({
        name: p.name || "Unknown",
        steamid: p.steamid ? convertToSteamID64(p.steamid) : null,
        ip: p.ip || null,
        time: p.time || "00:00",
        ping: p.ping || 0,
        loss: p.loss || 0,
        userid: p.userid || 0,
        state: p.state || "active",
        bot: p.bot || false,
      }));
    } else {
      // GameDig fallback: no Steam IDs available
      players = state.players.map((p) => ({
        name: p.name || "Unknown",
        score: p.raw?.score || 0,
        time: p.raw?.time || 0,
      }));
    }

    const result = {
      status: 1,
      map: state.map || "",
      players: players || [],
      playersRaw: state.players.raw || {},
      maxplayers: state.maxplayers || 0,
      version: state.version || "",
      playerCount: state.players.length || state.numplayers || 0,
      ping: state.ping || 0,
    };

    // Add RCON server info if available
    if (rconData && rconData.serverInfo) {
      result.hostname = rconData.serverInfo.hostname || null;
      result.os = rconData.serverInfo.os || null;
      result.secure = rconData.serverInfo.secure;
      result.bots = rconData.serverInfo.botCount || 0;
    }

    return result;
  } catch (error) {
    logger.error(`Failed to query ${ip}:${port} - ${error.message}`);
    return { status: 0 };
  }
}

module.exports = { queryServer };
