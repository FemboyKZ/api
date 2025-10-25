const pool = require("../db");
const { queryServer } = require("./serverQuery");
const logger = require("../utils/logger");
const fs = require("fs");

let serversConfig = [];

function loadConfig() {
  serversConfig = JSON.parse(fs.readFileSync("config/servers.json", "utf8"));
}

async function updateLoop() {
  loadConfig();
  for (const server of serversConfig) {
    try {
      const result = await queryServer(server.ip, server.port, server.game);
      if (result.status === 1) {
        // Simple example: insert/update server status and map
        await pool.query(
          `INSERT INTO servers (ip, port, game, status, map, player_count, version, last_update)
           VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
           ON DUPLICATE KEY UPDATE status=VALUES(status), map=VALUES(map), player_count=VALUES(player_count), version=VALUES(version), last_update=NOW()`,
          [
            server.ip,
            server.port,
            server.game,
            result.status,
            result.map,
            result.playerCount,
            result.version,
          ],
        );

        // Track players and maps more in depth here (example only updating servers table)
      } else {
        await pool.query(
          `UPDATE servers SET status=0, last_update=NOW() WHERE ip=? AND port=?`,
          [server.ip, server.port],
        );
      }
      logger.info(`Updated server ${server.ip}:${server.port} status`);
    } catch (e) {
      logger.error(
        `Failed to update server ${server.ip}:${server.port} - ${e.message}`,
      );
    }
  }
}

function startUpdateLoop(intervalMs) {
  updateLoop();
  setInterval(updateLoop, intervalMs);
}

module.exports = { startUpdateLoop };
