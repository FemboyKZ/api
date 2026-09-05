/**
 * players_list helpers.
 *
 * MariaDB returns JSON columns as strings even with `jsonStrings: false`,
 * so every reader has to handle both shapes.
 */

const logger = require("./logger");

/**
 * Read the players_list column off a server row (needs `ip`/`port` for logging).
 * @returns {Array<object>} parsed players, or [] if absent or unparseable
 */
function parsePlayersList(server) {
  if (!server.players_list) return [];

  try {
    const parsed =
      typeof server.players_list === "string"
        ? JSON.parse(server.players_list)
        : server.players_list;
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    logger.error(
      `Failed to parse players_list for ${server.ip}:${server.port}`,
      { error: e.message },
    );
    return [];
  }
}

/** Drop player IP addresses before the list leaves the API. */
function withoutPlayerIPs(players) {
  return players.map(({ ip, ...playerWithoutIp }) => playerWithoutIp);
}

module.exports = { parsePlayersList, withoutPlayerIPs };
