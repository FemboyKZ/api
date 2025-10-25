const { GameDig } = require("gamedig");
const logger = require("../utils/logger");
const { queryRcon, convertToSteamID64 } = require("./rconQuery");

async function queryServer(ip, port, game, rconPort, rconPassword) {
  try {
    // GameDig now supports 'valve' protocol which works for both CS:GO and CS2
    // We use the game type directly from config
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

    // Try to get detailed player info via RCON if available
    let rconData = null;
    if (rconPassword && rconPort) {
      rconData = await queryRcon(ip, rconPort, rconPassword);
    }

    // Use RCON player data if available, otherwise fall back to GameDig
    let players = [];
    if (rconData && rconData.players && rconData.players.length > 0) {
      // Use RCON data exclusively - it has steamid, accurate ping, etc.
      players = rconData.players.map((p) => ({
        name: p.name || "Unknown",
        steamid: p.steamid ? convertToSteamID64(p.steamid) : null,
        time: p.time || "00:00",
        ping: p.ping || 0,
        loss: p.loss || 0,
        userid: p.userid || 0,
        state: p.state || "active",
        bot: p.bot || false,
      }));
    } else {
      // Fall back to GameDig data (no steamids available)
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
      result.secure = rconData.serverInfo.secure !== undefined 
        ? (rconData.serverInfo.secure === 'secure' ? 1 : 0)
        : null;
      result.steamid = rconData.serverInfo.steamid || null;
      result.bots = rconData.serverInfo.botCount || 0;
    }

    return result;
  } catch (error) {
    logger.error(`Failed to query ${ip}:${port} - ${error.message}`);
    return { status: 0 };
  }
}

module.exports = { queryServer };
