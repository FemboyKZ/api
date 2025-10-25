const Gamedig = require("gamedig");

async function queryServer(ip, port, game) {
  try {
    const state = await Gamedig.query({
      type: game === "counterstrike2" ? "csgo" : game,
      host: ip,
      port: port,
      socketTimeout: 3000,
    });
    return {
      status: 1,
      map: state.map || "",
      players: state.players.map((p) => ({ name: p.name, id: p.id })) || [],
      playersRaw: state.players.raw || {},
      maxplayers: state.maxplayers || 0,
      version: state.raw?.version || "",
      playerCount: state.players.length || state.numplayers || 0,
      ping: state.ping || 0,
    };
  } catch (error) {
    return { status: 0 };
  }
}

module.exports = { queryServer };
