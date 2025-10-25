const { GameDig } = require("gamedig");
const logger = require("../utils/logger");

async function queryServer(ip, port, game) {
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

    return {
      status: 1,
      map: state.map || "",
      players: state.players.map((p) => ({ name: p.name, id: p.id })) || [],
      playersRaw: state.players.raw || {},
      maxplayers: state.maxplayers || 0,
      version: state.version || "",
      playerCount: state.players.length || state.numplayers || 0,
      ping: state.ping || 0,
    };
  } catch (error) {
    logger.error(`Failed to query ${ip}:${port} - ${error.message}`);
    return { status: 0 };
  }
}

module.exports = { queryServer };
