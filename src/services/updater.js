/**
 * Background loop: polls every tracked server, writes results, records history, pushes WebSocket updates.
 */

const pool = require("../db");
const { queryServer } = require("./serverQuery");
const logger = require("../utils/logger");
const fs = require("fs");
const { sanitizeMapName, sanitizePlayerName } = require("../utils/validators");
const {
  emitServerUpdate,
  emitServerStatusChange,
  emitPlayerUpdate,
  emitMapUpdate,
} = require("./websocket");
const { deleteCache } = require("../db/redis");
const { updateDiscordWebhooks } = require("./discordWebhook");
const { isServerLive } = require("./liveServers");
const {
  trackPlayerSessions,
  closeServerSessions,
  trackMapChange,
} = require("./serverTracking");

/**
 * Server Update Service
 *
 * Polls all configured game servers in parallel at regular intervals (default: 30 seconds).
 *
 * For each server:
 * 1. Queries via Steam Master Server (primary) or GameDig (fallback) for status
 * 2. Stores current status in servers table
 * 3. Records historical snapshots in server_history table
 * 4. Tracks player sessions (join/leave) when Steam IDs available from plugin
 * 5. Tracks map changes and rotation in map_history table
 *    (4 and 5 live in services/serverTracking.js, shared with the plugin ingest)
 * 6. Updates player statistics (separated by game type)
 * 7. Updates map statistics (separated by game type)
 * 8. Emits WebSocket events for real-time updates
 *
 * Player details (Steam IDs, connection times) are provided by the in-game
 * plugin via the live status endpoint, not by polling.
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
 * - Cycles never overlap: a tick is skipped while the previous one is running
 */

const CONFIG_PATH = "config/servers.json";
let serversConfig = [];
let configMtimeMs = 0; // Skips re-parsing the config when it has not changed
let UPDATE_INTERVAL_SECONDS = 30; // Default interval in seconds
let isUpdating = false; // Guards against overlapping update cycles

function loadConfig() {
  // Runs every cycle, so only re-read when the file actually changed.
  const { mtimeMs } = fs.statSync(CONFIG_PATH);
  if (mtimeMs === configMtimeMs) return;

  serversConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  configMtimeMs = mtimeMs;
  logger.info(`Loaded ${serversConfig.length} servers from ${CONFIG_PATH}`);
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

async function updateLoop() {
  // A cycle can outlast the interval when servers are slow to answer.
  if (isUpdating) {
    logger.warn("Update loop still running, skipping this tick");
    return;
  }
  isUpdating = true;
  try {
    await runUpdateCycle();
  } finally {
    isUpdating = false;
  }
}

async function runUpdateCycle() {
  loadConfig();

  // Query all servers in parallel
  const updatePromises = serversConfig.map(async (server) => {
    try {
      // Skip external queries if the extension is providing live data
      if (isServerLive(server.ip, server.port)) {
        logger.debug(
          `Skipping external query for ${server.ip}:${server.port} (live extension data)`,
        );
        return;
      }

      const result = await queryServer(server.ip, server.port, server.game);

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

        // Sanitize map name to remove workshop paths and URL encoding
        const sanitizedMap = result.map ? sanitizeMapName(result.map) : "";

        // Insert/update server status and map
        await pool.query(
          `INSERT INTO servers (ip, port, game, version, hostname, os, secure, status, map, player_count, maxplayers, bot_count, players_list, region, domain, api_id, kzt_id, tickrate)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE version=IF(VALUES(version)='', version, VALUES(version)), hostname=COALESCE(VALUES(hostname), hostname), os=COALESCE(VALUES(os), os), secure=COALESCE(VALUES(secure), secure), status=VALUES(status), map=VALUES(map), player_count=VALUES(player_count), maxplayers=VALUES(maxplayers), bot_count=VALUES(bot_count), players_list=VALUES(players_list), region=VALUES(region), domain=VALUES(domain), api_id=VALUES(api_id), kzt_id=VALUES(kzt_id), tickrate=VALUES(tickrate), last_update=NOW()`,
          [
            server.ip,
            server.port,
            server.game,
            result.version || "",
            result.hostname || server.name || null,
            result.os || null,
            result.secure !== undefined ? result.secure : null,
            result.status,
            sanitizedMap,
            result.playerCount || 0,
            result.maxplayers || 0,
            result.bots || 0,
            JSON.stringify(playersList), // MariaDB needs stringified JSON
            server.region || null,
            server.domain || null,
            server.apiId || null,
            server.kztId || null,
            server.tickrate || null,
          ],
        );

        // Record historical data
        await recordServerHistory(server, result);

        // Track player sessions (only if we have Steam IDs from plugin)
        if (result.players && result.players.length > 0) {
          const playersWithSteamId = result.players.filter((p) => p.steamid);
          if (playersWithSteamId.length > 0) {
            await trackPlayerSessions(
              server.ip,
              server.port,
              playersWithSteamId,
            );
          }
        }

        // Track map changes
        if (result.map) {
          await trackMapChange(
            server.ip,
            server.port,
            sanitizedMap,
            result.playerCount || 0,
          );
        }

        // Emit WebSocket events for server changes
        const serverData = {
          ip: server.ip,
          port: server.port,
          game: server.game,
          status: result.status,
          map: sanitizedMap,
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
        if (previousServer && previousServer.map !== sanitizedMap) {
          emitMapUpdate({
            server: `${server.ip}:${server.port}`,
            oldMap: previousServer.map,
            newMap: sanitizedMap,
          });
        }

        // Track individual players (only those with Steam IDs from RCON)
        const trackedPlayers = (result.players || []).filter((p) => p.steamid);
        if (trackedPlayers.length > 0) {
          // One multi-row upsert rather than a round-trip per player.
          const rows = trackedPlayers.map((player) => [
            player.steamid,
            // Never NULL: latest_name is what every read path selects.
            sanitizePlayerName(player.name) || "Unknown",
            player.ip || null,
            server.game,
            UPDATE_INTERVAL_SECONDS,
            server.ip,
            server.port,
          ]);

          await pool.query(
            `INSERT INTO players (steamid, latest_name, latest_ip, game, playtime, server_ip, server_port, last_seen)
             VALUES ${rows.map(() => "(?, ?, ?, ?, ?, ?, ?, NOW())").join(", ")}
             ON DUPLICATE KEY UPDATE 
               latest_name=VALUES(latest_name), 
               latest_ip=VALUES(latest_ip),
               playtime=playtime+VALUES(playtime), 
               server_ip=VALUES(server_ip), 
               server_port=VALUES(server_port), 
               last_seen=NOW()`,
            rows.flat(),
          );

          for (const row of rows) {
            emitPlayerUpdate({
              steamid: row[0],
              name: row[1],
              server: `${server.ip}:${server.port}`,
            });
          }
        }

        // Track map playtime (separated by game)
        if (result.map && sanitizedMap) {
          await pool.query(
            `INSERT INTO maps (name, game, playtime, server_ip, server_port, last_played)
             VALUES (?, ?, ?, ?, ?, NOW())
             ON DUPLICATE KEY UPDATE 
               playtime=playtime+?, 
               server_ip=VALUES(server_ip), 
               server_port=VALUES(server_port), 
               last_played=NOW()`,
            [
              sanitizedMap,
              server.game,
              UPDATE_INTERVAL_SECONDS,
              server.ip,
              server.port,
              UPDATE_INTERVAL_SECONDS,
            ],
          );
        }
      } else {
        // Server is offline or query failed - still insert/update the record
        // Clear players_list when server is offline to avoid stale data
        await pool.query(
          `INSERT INTO servers (ip, port, game, status, players_list, region, domain, api_id, kzt_id, tickrate, last_update)
           VALUES (?, ?, ?, 0, '[]', ?, ?, ?, ?, ?, NOW())
           ON DUPLICATE KEY UPDATE status=0, players_list='[]', region=VALUES(region), domain=VALUES(domain), api_id=VALUES(api_id), kzt_id=VALUES(kzt_id), tickrate=VALUES(tickrate), last_update=NOW()`,
          [
            server.ip,
            server.port,
            server.game,
            server.region || null,
            server.domain || null,
            server.apiId || null,
            server.kztId || null,
            server.tickrate || null,
          ],
        );

        // Nobody is connected to an offline server.
        // Without this, sessions opened before it went down stayed open (left_at IS NULL) forever.
        await closeServerSessions(server.ip, server.port);

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
    } catch (error) {
      logger.error(
        `Failed to update server ${server.ip}:${server.port} - ${error.message}`,
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

  // Update Discord webhooks after all server queries complete
  updateDiscordWebhooks().catch((error) => {
    logger.error("Failed to update Discord webhooks", { error: error.message });
  });
}

let updateTimer = null;

function startUpdateLoop(intervalMs) {
  // Store the interval in seconds for playtime calculations
  UPDATE_INTERVAL_SECONDS = Math.floor(intervalMs / 1000);
  logger.info(
    `Starting update loop with ${UPDATE_INTERVAL_SECONDS} second interval`,
  );

  updateLoop();
  updateTimer = setInterval(updateLoop, intervalMs);
}

function stopUpdateLoop() {
  clearInterval(updateTimer);
  updateTimer = null;
}

module.exports = { startUpdateLoop, stopUpdateLoop };
