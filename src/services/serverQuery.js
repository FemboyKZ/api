const { GameDig } = require("gamedig");
const logger = require("../utils/logger");
const { queryRcon, convertToSteamID64 } = require("./rconQuery");

/**
 * Query a game server using GameDig and optionally RCON for extended data
 * 
 * GameDig provides:
 * - Basic status (online/offline), map name, player count
 * - Limited player info (names only, no Steam IDs)
 * 
 * RCON provides (when configured):
 * - Steam IDs for all players (SteamID64 format)
 * - Accurate player data: connection time, ping, loss, IP address
 * - Server metadata: hostname, OS, secure status, bot count
 * 
 * When RCON is available and returns player data, it replaces GameDig player data
 * entirely for accuracy and completeness (Steam IDs, connection times, etc).
 * 
 * @param {string} ip - Server IP address
 * @param {number} port - Game server query port
 * @param {string} game - Game type ('csgo', 'counterstrike2', etc.)
 * @param {number} rconPort - RCON port (optional)
 * @param {string} rconPassword - RCON password (optional)
 * @returns {Object} Server status with players, map, metadata, and RCON data if available
 */
async function queryServer(ip, port, game, rconPort, rconPassword) {
  try {
    logger.info(`Querying ${ip}:${port} (${game})`);

    const state = await GameDig.query({
      type: game,
      host: ip,
      port: port,
      socketTimeout: 3000,
    });

    logger.info(`GameDig query successful: ${ip}:${port} - ${state.players.length} players`);

    // Query RCON for detailed player data and server metadata
    let rconData = null;
    if (rconPassword && rconPort) {
      rconData = await queryRcon(ip, rconPort, rconPassword, game);
    }

    // Build player list: prefer RCON data (has Steam IDs), fallback to GameDig
    let players = [];
    if (rconData?.players?.length > 0) {
      // RCON: Full player data with Steam IDs converted to SteamID64
      players = rconData.players.map((p) => {
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
    } else {
      // GameDig fallback: Basic player data (no Steam IDs)
      players = state.players.map((p) => {
        const cleanName = p.name?.trim() || null;
        
        return {
          name: cleanName,
          score: p.raw?.score || 0,
          time: p.raw?.time || 0,
        };
      });
    }

    const result = {
      status: 1,
      map: state.map || "",
      players: players,
      playersRaw: state.players.raw || {},
      maxplayers: state.maxplayers || 0,
      version: state.version || "",
      playerCount: state.players.length || state.numplayers || 0,
      ping: state.ping || 0,
    };

    // Add RCON metadata if available
    if (rconData?.serverInfo) {
      result.hostname = rconData.serverInfo.hostname || null;
      result.os = rconData.serverInfo.os || null;
      result.secure = rconData.serverInfo.secure;
      result.bots = rconData.serverInfo.botCount || 0;
    }

    return result;
  } catch (error) {
    logger.error(`Failed to query ${ip}:${port}: ${error.message}`);
    return { status: 0 };
  }
}

module.exports = { queryServer };
