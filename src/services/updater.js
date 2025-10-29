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

/**
 * Server Update Service
 * 
 * Polls all configured game servers in parallel at regular intervals (default: 30 seconds).
 * 
 * For each server:
 * 1. Queries via GameDig for basic status (map, player count, online/offline)
 * 2. Queries via RCON (if configured) for Steam IDs and extended data
 * 3. Stores current status in servers table (with RCON data if available)
 * 4. Records historical snapshots in server_history table
 * 5. Tracks player sessions (join/leave) when Steam IDs available from RCON
 * 6. Tracks map changes and rotation in map_history table
 * 7. Updates player statistics (separated by game type)
 * 8. Updates map statistics (separated by game type)
 * 9. Emits WebSocket events for real-time updates
 * 
 * Data Separation:
 * - Players and maps use composite unique keys (steamid+game, name+game)
 * - Same player on CS:GO and CS2 has separate playtime tracking
 * - Same map on CS:GO and CS2 has separate playtime tracking
 * 
 * Performance:
 * - All servers queried in parallel using Promise.all()
 * - Update time = slowest server response, not sum of all servers
 * - Cache invalidated once after all updates complete
 */

let serversConfig = [];
const previousServerStates = new Map(); // Track previous state for session tracking
const currentMapStates = new Map(); // Track current maps for map history

function loadConfig() {
  serversConfig = JSON.parse(fs.readFileSync("config/servers.json", "utf8"));
}

/**
 * Record server history snapshot
 */
async function recordServerHistory(server, result) {
  try {
    await pool.query(
      `INSERT INTO server_history 
       (server_ip, server_port, game, status, map, player_count, maxplayers, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        server.ip,
        server.port,
        server.game,
        result.status,
        result.map || "",
        result.playerCount || 0,
        result.maxplayers || 0,
        result.version || "",
      ],
    );
  } catch (error) {
    logger.error("Failed to record server history", {
      server: `${server.ip}:${server.port}`,
      error: error.message,
    });
  }
}

/**
 * Track player sessions (join/leave)
 */
async function trackPlayerSessions(server, currentPlayers) {
  const serverKey = `${server.ip}:${server.port}`;
  const previousPlayers = previousServerStates.get(serverKey) || new Set();
  const currentPlayerIds = new Set(
    currentPlayers.map((p) => p.steamid).filter((id) => id),
  );

  // Players who joined
  for (const player of currentPlayers) {
    if (player.steamid && !previousPlayers.has(player.steamid)) {
      try {
        await pool.query(
          `INSERT INTO player_sessions (steamid, name, server_ip, server_port, joined_at)
           VALUES (?, ?, ?, ?, NOW())`,
          [player.steamid, player.name || "Unknown", server.ip, server.port],
        );
        logger.debug("Player joined", {
          steamid: player.steamid,
          server: serverKey,
        });
      } catch (error) {
        logger.error("Failed to track player join", {
          error: error.message,
          steamid: player.id,
        });
      }
    }
  }

  // Players who left
  for (const playerId of previousPlayers) {
    if (!currentPlayerIds.has(playerId)) {
      try {
        await pool.query(
          `UPDATE player_sessions 
           SET left_at = NOW(), 
               duration = TIMESTAMPDIFF(SECOND, joined_at, NOW())
           WHERE steamid = ? 
             AND server_ip = ? 
             AND server_port = ? 
             AND left_at IS NULL`,
          [playerId, server.ip, server.port],
        );
        logger.debug("Player left", { steamid: playerId, server: serverKey });
      } catch (error) {
        logger.error("Failed to track player leave", {
          error: error.message,
          steamid: playerId,
        });
      }
    }
  }

  // Update previous state
  previousServerStates.set(serverKey, currentPlayerIds);
}

/**
 * Track map changes
 */
async function trackMapChange(server, newMap, playerCount) {
  const serverKey = `${server.ip}:${server.port}`;
  const currentMap = currentMapStates.get(serverKey);

  if (currentMap && currentMap.name !== newMap) {
    // End previous map
    try {
      await pool.query(
        `UPDATE map_history 
         SET ended_at = NOW(), 
             duration = TIMESTAMPDIFF(SECOND, started_at, NOW())
         WHERE server_ip = ? 
           AND server_port = ? 
           AND ended_at IS NULL`,
        [server.ip, server.port],
      );

      // Start new map
      await pool.query(
        `INSERT INTO map_history 
         (server_ip, server_port, map_name, started_at, player_count_avg, player_count_peak)
         VALUES (?, ?, ?, NOW(), ?, ?)`,
        [server.ip, server.port, newMap, playerCount, playerCount],
      );

      logger.debug("Map changed", {
        server: serverKey,
        from: currentMap.name,
        to: newMap,
      });
    } catch (error) {
      logger.error("Failed to track map change", { error: error.message });
    }
  } else if (!currentMap && newMap) {
    // First map entry for this server
    try {
      await pool.query(
        `INSERT INTO map_history 
         (server_ip, server_port, map_name, started_at, player_count_avg, player_count_peak)
         VALUES (?, ?, ?, NOW(), ?, ?)`,
        [server.ip, server.port, newMap, playerCount, playerCount],
      );
    } catch (error) {
      logger.error("Failed to initialize map tracking", {
        error: error.message,
      });
    }
  } else if (currentMap && currentMap.name === newMap) {
    // Update player counts for current map
    try {
      await pool.query(
        `UPDATE map_history 
         SET player_count_peak = GREATEST(player_count_peak, ?),
             player_count_avg = (player_count_avg + ?) / 2
         WHERE server_ip = ? 
           AND server_port = ? 
           AND ended_at IS NULL`,
        [playerCount, playerCount, server.ip, server.port],
      );
    } catch (error) {
      logger.error("Failed to update map player counts", {
        error: error.message,
      });
    }
  }

  currentMapStates.set(serverKey, { name: newMap, playerCount });
}

async function updateLoop() {
  loadConfig();
  
  // Query all servers in parallel
  const updatePromises = serversConfig.map(async (server) => {
    try {
      const result = await queryServer(
        server.ip,
        server.port,
        server.game,
        server.rconPort,
        server.rconPassword,
      );

      // Get previous server status for comparison
      const [prevStatus] = await pool.query(
        "SELECT status, map, player_count FROM servers WHERE ip=? AND port=?",
        [server.ip, server.port],
      );
      const previousServer = prevStatus[0];

      if (result.status === 1) {
        // Prepare players list for storage - store as JSON array or empty array
        const playersList =
          result.players && result.players.length > 0 ? result.players : [];

        // Insert/update server status and map
        await pool.query(
          `INSERT INTO servers (ip, port, game, version, hostname, os, secure, status, map, player_count, maxplayers, bot_count, players_list, region, domain)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE version=VALUES(version), hostname=VALUES(hostname), os=VALUES(os), secure=VALUES(secure), status=VALUES(status), map=VALUES(map), player_count=VALUES(player_count), maxplayers=VALUES(maxplayers), bot_count=VALUES(bot_count), players_list=VALUES(players_list), region=VALUES(region), domain=VALUES(domain), last_update=NOW()`,
          [
            server.ip,
            server.port,
            server.game,
            result.version || "",
            result.hostname || null,
            result.os || null,
            result.secure !== undefined ? result.secure : null,
            result.status,
            result.map || "",
            result.playerCount || 0,
            result.maxplayers || 0,
            result.bots || 0,
            JSON.stringify(playersList), // MariaDB needs stringified JSON
            server.region || null,
            server.domain || null,
          ],
        );

        // Record historical data
        await recordServerHistory(server, result);

        // Track player sessions (only if we have Steam IDs from RCON)
        if (result.players && result.players.length > 0) {
          const playersWithSteamId = result.players.filter((p) => p.steamid);
          if (playersWithSteamId.length > 0) {
            await trackPlayerSessions(server, playersWithSteamId);
          }
        }

        // Track map changes
        if (result.map) {
          await trackMapChange(server, result.map, result.playerCount || 0);
        }

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

        // Track individual players (only those with Steam IDs from RCON)
        if (result.players && result.players.length > 0) {
          for (const player of result.players) {
            if (player.steamid) {
              // Extract name from player data (handle various formats and empty strings)
              const playerName = (player.name && player.name.trim()) ? player.name.trim() : null;
              
              // Insert or update player record (separated by game)
              await pool.query(
                `INSERT INTO players (steamid, latest_name, latest_ip, game, playtime, server_ip, server_port, last_seen)
                 VALUES (?, ?, ?, ?, 1, ?, ?, NOW())
                 ON DUPLICATE KEY UPDATE 
                   latest_name=VALUES(latest_name), 
                   latest_ip=VALUES(latest_ip),
                   playtime=playtime+1, 
                   server_ip=VALUES(server_ip), 
                   server_port=VALUES(server_port), 
                   last_seen=NOW()`,
                [
                  player.steamid,
                  playerName,
                  player.ip || null,
                  server.game,
                  server.ip,
                  server.port,
                ],
              );

              // Emit player update event
              emitPlayerUpdate({
                steamid: player.steamid,
                name: playerName || "Unknown",
                server: `${server.ip}:${server.port}`,
              });
            }
          }
        }

        // Track map playtime (separated by game)
        if (result.map) {
          await pool.query(
            `INSERT INTO maps (name, game, playtime, server_ip, server_port, last_played)
             VALUES (?, ?, 1, ?, ?, NOW())
             ON DUPLICATE KEY UPDATE 
               playtime=playtime+1, 
               server_ip=VALUES(server_ip), 
               server_port=VALUES(server_port), 
               last_played=NOW()`,
            [result.map, server.game, server.ip, server.port],
          );
        }
      } else {
        // Server is offline or query failed - still insert/update the record
        await pool.query(
          `INSERT INTO servers (ip, port, game, status, region, domain, last_update)
           VALUES (?, ?, ?, 0, ?, ?, NOW())
           ON DUPLICATE KEY UPDATE status=0, region=VALUES(region), domain=VALUES(domain), last_update=NOW()`,
          [server.ip, server.port, server.game, server.region || null, server.domain || null],
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
    } catch (e) {
      logger.error(
        `Failed to update server ${server.ip}:${server.port} - ${e.message}`,
      );
    }
  });
  
  // Wait for all server updates to complete
  await Promise.all(updatePromises);
  
  // Invalidate caches once after all updates (moved from inside loop)
  await deleteCache("cache:servers:*");
  await deleteCache("cache:players:*");
  await deleteCache("cache:maps:*");
  await deleteCache("cache:history:*");
}

function startUpdateLoop(intervalMs) {
  updateLoop();
  setInterval(updateLoop, intervalMs);
}

module.exports = { startUpdateLoop };
