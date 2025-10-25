const pool = require("../db");
const { queryServer } = require("./serverQuery");
const logger = require("../utils/logger");
const fs = require("fs");
const {
  emitServerUpdate,
  emitServerStatusChange,
  emitPlayerUpdate,
  emitMapUpdate,
} = require("./websocket");
const { deleteCache } = require("../db/redis");

let serversConfig = [];

function loadConfig() {
  serversConfig = JSON.parse(fs.readFileSync("config/servers.json", "utf8"));
}

async function updateLoop() {
  loadConfig();
  for (const server of serversConfig) {
    try {
      const result = await queryServer(server.ip, server.port, server.game);

      // Get previous server status for comparison
      const [prevStatus] = await pool.query(
        "SELECT status, map, player_count FROM servers WHERE ip=? AND port=?",
        [server.ip, server.port],
      );
      const previousServer = prevStatus[0];

      if (result.status === 1) {
        // Insert/update server status and map
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

        // Emit WebSocket events for server changes
        const serverData = {
          ip: server.ip,
          port: server.port,
          game: server.game,
          status: result.status,
          map: result.map,
          players: result.playerCount,
          version: result.version,
        };

        emitServerUpdate(serverData);

        // Emit status change if server came online
        if (!previousServer || previousServer.status === 0) {
          emitServerStatusChange({
            ...serverData,
            statusChange: "online",
          });
        }

        // Emit map change event
        if (previousServer && previousServer.map !== result.map) {
          emitMapUpdate({
            server: `${server.ip}:${server.port}`,
            oldMap: previousServer.map,
            newMap: result.map,
          });
        }

        // Track players
        if (result.players && result.players.length > 0) {
          for (const player of result.players) {
            if (player.id) {
              // Insert or update player record
              await pool.query(
                `INSERT INTO players (steamid, name, playtime, server_ip, server_port, last_seen)
                 VALUES (?, ?, 1, ?, ?, NOW())
                 ON DUPLICATE KEY UPDATE 
                   name=VALUES(name), 
                   playtime=playtime+1, 
                   server_ip=VALUES(server_ip), 
                   server_port=VALUES(server_port), 
                   last_seen=NOW()`,
                [player.id, player.name || "Unknown", server.ip, server.port],
              );

              // Emit player update event
              emitPlayerUpdate({
                steamid: player.id,
                name: player.name || "Unknown",
                server: `${server.ip}:${server.port}`,
              });
            }
          }
          logger.info(
            `Tracked ${result.players.length} players on ${server.ip}:${server.port}`,
          );
        }

        // Track map playtime
        if (result.map) {
          await pool.query(
            `INSERT INTO maps (name, playtime, server_ip, server_port, last_played)
             VALUES (?, 1, ?, ?, NOW())
             ON DUPLICATE KEY UPDATE 
               playtime=playtime+1, 
               server_ip=VALUES(server_ip), 
               server_port=VALUES(server_port), 
               last_played=NOW()`,
            [result.map, server.ip, server.port],
          );
        }
      } else {
        await pool.query(
          `UPDATE servers SET status=0, last_update=NOW() WHERE ip=? AND port=?`,
          [server.ip, server.port],
        );

        // Emit status change if server went offline
        if (previousServer && previousServer.status === 1) {
          emitServerStatusChange({
            ip: server.ip,
            port: server.port,
            game: server.game,
            status: 0,
            statusChange: "offline",
          });
        }
      }

      // Invalidate relevant caches
      await deleteCache("cache:servers:*");
      await deleteCache("cache:players:*");
      await deleteCache("cache:maps:*");

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
