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

    // Merge GameDig and RCON data
    const players = state.players.map((p) => {
      const basePlayer = {
        name: p.name || "Unknown",
        score: p.raw?.score || 0,
        time: p.raw?.time || 0,
      };

      // Try to find matching player in RCON data by name
      if (rconData && rconData.players) {
        const rconPlayer = rconData.players.find(
          (rp) => rp.name.toLowerCase() === p.name?.toLowerCase(),
        );
        if (rconPlayer) {
          basePlayer.steamid = convertToSteamID64(rconPlayer.steamid);
          basePlayer.ping = rconPlayer.ping;
          basePlayer.userid = rconPlayer.userid;
        }
      }

      return basePlayer;
    });

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
