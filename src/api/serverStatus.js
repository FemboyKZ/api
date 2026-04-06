const express = require("express");
const router = express.Router();
const pool = require("../db");
const logger = require("../utils/logger");
const {
  isValidIP,
  sanitizeMapName,
  sanitizePlayerName,
} = require("../utils/validators");
const { markServerLive, clearServerLive } = require("../services/liveServers");
const { deleteCache } = require("../db/redis");
const {
  emitServerUpdate,
  emitServerStatusChange,
  emitPlayerUpdate,
  emitMapUpdate,
} = require("../services/websocket");

// In-memory state for session/map tracking (mirrors updater's tracking)
const previousServerStates = new Map();
const currentMapStates = new Map();

/**
 * POST /servers/status
 *
 * Receives live server data from the gokz-realtime-status plugin.
 * Authenticated via adminAuth middleware (API key, IP whitelist, or localhost).
 *
 * Expected payload (from plugin BuildPayload):
 * {
 *   server: { hostname, ip, port, os, map, players, max_players, bot_count, version, tickrate, secure, mm_version, sm_version, gokz_loaded, cs2kz_loaded, plugins: [...] },
 *   players: [{ steamid, name, ip, time_on_server, in_game, gokz?: { mode, timer_running, paused, time, course, teleports }, cs2kz?: { ... } }]
 * }
 */
router.get("/", (req, res) => {
  res.status(405).json({ error: "Method not allowed. Use POST." });
});

router.post("/", async (req, res) => {
  try {
    const payload = req.body;

    if (!payload || !payload.server) {
      return res.status(400).json({ error: "Missing server data" });
    }

    const srv = payload.server;
    const ip = srv.ip;
    const port = parseInt(srv.port, 10);

    if (!ip || !isValidIP(ip) || !port || port < 1 || port > 65535) {
      return res.status(400).json({ error: "Invalid server ip/port" });
    }

    // Look up this server in our config to get game type and metadata
    const [configRows] = await pool.query(
      "SELECT game, region, domain, api_id, kzt_id, tickrate FROM servers WHERE ip = ? AND port = ?",
      [ip, port],
    );

    if (configRows.length === 0) {
      return res.status(404).json({ error: "Server not registered" });
    }

    const serverConfig = configRows[0];
    const game = serverConfig.game;

    // Mark server as receiving live data so updater skips external queries
    markServerLive(ip, port);

    // Get previous server status for change detection
    const [prevStatus] = await pool.query(
      "SELECT status, map, player_count FROM servers WHERE ip = ? AND port = ?",
      [ip, port],
    );
    const previousServer = prevStatus[0] || null;

    const sanitizedMap = srv.map ? sanitizeMapName(srv.map) : "";
    const playerCount = parseInt(srv.players, 10) || 0;
    const maxPlayers = parseInt(srv.max_players, 10) || 0;
    const botCount = parseInt(srv.bot_count, 10) || 0;
    const tickrate =
      parseInt(srv.tickrate, 10) || serverConfig.tickrate || null;

    // strip IPs before storing in players_list
    const extensionPlayers = Array.isArray(payload.players)
      ? payload.players
      : [];
    const playersListForStorage = extensionPlayers
      .filter((p) => p.steamid && p.in_game)
      .map((p) => ({
        name: sanitizePlayerName(p.name) || "Unknown",
        steamid: p.steamid,
        time: p.time_on_server ? `${Math.floor(p.time_on_server)}s` : null,
        gokz: p.gokz || null,
        cs2kz: p.cs2kz || null,
      }));

    await pool.query(
      `INSERT INTO servers (ip, port, game, version, mm_version, sm_version, gokz_loaded, cs2kz_loaded, hostname, os, secure, status, map, player_count, maxplayers, bot_count, players_list, region, domain, api_id, kzt_id, tickrate)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE version=IF(VALUES(version)='', version, VALUES(version)), mm_version=VALUES(mm_version), sm_version=VALUES(sm_version), gokz_loaded=VALUES(gokz_loaded), cs2kz_loaded=VALUES(cs2kz_loaded), hostname=VALUES(hostname), os=VALUES(os), secure=VALUES(secure), status=1, map=VALUES(map), player_count=VALUES(player_count), maxplayers=VALUES(maxplayers), bot_count=VALUES(bot_count), players_list=VALUES(players_list), tickrate=COALESCE(VALUES(tickrate), tickrate), last_update=NOW()`,
      [
        ip,
        port,
        game,
        srv.version || "",
        srv.mm_version || null,
        srv.sm_version || null,
        srv.gokz_loaded != null ? (srv.gokz_loaded ? 1 : 0) : null,
        srv.cs2kz_loaded != null ? (srv.cs2kz_loaded ? 1 : 0) : null,
        srv.hostname || null,
        srv.os || null,
        srv.secure != null ? (srv.secure ? 1 : 0) : null,
        sanitizedMap,
        playerCount,
        maxPlayers,
        botCount,
        JSON.stringify(playersListForStorage),
        serverConfig.region,
        serverConfig.domain,
        serverConfig.api_id,
        serverConfig.kzt_id,
        tickrate,
      ],
    );

    // Record history snapshot
    try {
      await pool.query(
        `INSERT INTO server_history 
         (server_ip, server_port, game, status, map, player_count, maxplayers, version)
         VALUES (?, ?, ?, 1, ?, ?, ?, ?)`,
        [
          ip,
          port,
          game,
          sanitizedMap,
          playerCount,
          maxPlayers,
          srv.version || "",
        ],
      );
    } catch (histErr) {
      logger.error("Failed to record server history from extension", {
        error: histErr.message,
      });
    }

    // Track player sessions
    const serverKey = `${ip}:${port}`;
    const previousPlayers = previousServerStates.get(serverKey) || new Set();
    const currentPlayerIds = new Set();

    for (const player of extensionPlayers) {
      if (!player.steamid || !player.in_game) continue;
      currentPlayerIds.add(player.steamid);

      if (!previousPlayers.has(player.steamid)) {
        try {
          const cleanName = sanitizePlayerName(player.name) || "Unknown";
          await pool.query(
            `INSERT INTO player_sessions (steamid, name, server_ip, server_port, joined_at)
             VALUES (?, ?, ?, ?, NOW())`,
            [player.steamid, cleanName, ip, port],
          );
        } catch (sessErr) {
          logger.error("Failed to track player join", {
            error: sessErr.message,
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
             SET left_at = NOW(), duration = TIMESTAMPDIFF(SECOND, joined_at, NOW())
             WHERE steamid = ? AND server_ip = ? AND server_port = ? AND left_at IS NULL`,
            [playerId, ip, port],
          );
        } catch (sessErr) {
          logger.error("Failed to track player leave", {
            error: sessErr.message,
          });
        }
      }
    }
    previousServerStates.set(serverKey, currentPlayerIds);

    // Track map changes
    const currentMap = currentMapStates.get(serverKey);
    if (currentMap && currentMap.name !== sanitizedMap) {
      try {
        await pool.query(
          `UPDATE map_history SET ended_at = NOW(), duration = TIMESTAMPDIFF(SECOND, started_at, NOW())
           WHERE server_ip = ? AND server_port = ? AND ended_at IS NULL`,
          [ip, port],
        );
        await pool.query(
          `INSERT INTO map_history (server_ip, server_port, map_name, started_at, player_count_avg, player_count_peak)
           VALUES (?, ?, ?, NOW(), ?, ?)`,
          [ip, port, sanitizedMap, playerCount, playerCount],
        );
      } catch (mapErr) {
        logger.error("Failed to track map change", { error: mapErr.message });
      }
    } else if (!currentMap && sanitizedMap) {
      try {
        await pool.query(
          `INSERT INTO map_history (server_ip, server_port, map_name, started_at, player_count_avg, player_count_peak)
           VALUES (?, ?, ?, NOW(), ?, ?)`,
          [ip, port, sanitizedMap, playerCount, playerCount],
        );
      } catch (mapErr) {
        logger.error("Failed to init map tracking", { error: mapErr.message });
      }
    } else if (currentMap && currentMap.name === sanitizedMap) {
      try {
        await pool.query(
          `UPDATE map_history 
           SET player_count_peak = GREATEST(player_count_peak, ?), player_count_avg = (player_count_avg + ?) / 2
           WHERE server_ip = ? AND server_port = ? AND ended_at IS NULL`,
          [playerCount, playerCount, ip, port],
        );
      } catch (mapErr) {
        logger.error("Failed to update map player counts", {
          error: mapErr.message,
        });
      }
    }
    currentMapStates.set(serverKey, { name: sanitizedMap, playerCount });

    // Update individual player stats
    // Use a reasonable increment, extension reports every ~10s, but we don't
    // want to assume. use the actual interval between reports for this server.
    const PLAYTIME_INCREMENT = 10; // seconds (matches extension default interval)

    for (const player of extensionPlayers) {
      if (!player.steamid || !player.in_game) continue;

      const cleanName = sanitizePlayerName(player.name) || "Unknown";

      // Upsert player record
      await pool.query(
        `INSERT INTO players (steamid, latest_name, latest_ip, game, playtime, server_ip, server_port, last_seen)
         VALUES (?, ?, NULL, ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE 
           latest_name=VALUES(latest_name), 
           playtime=playtime+?, 
           server_ip=VALUES(server_ip), 
           server_port=VALUES(server_port), 
           last_seen=NOW()`,
        [
          player.steamid,
          cleanName,
          game,
          PLAYTIME_INCREMENT,
          ip,
          port,
          PLAYTIME_INCREMENT,
        ],
      );

      // Store player IP privately (not in players table)
      if (player.ip) {
        try {
          await pool.query(
            `INSERT INTO player_ips (steamid, ip, first_seen, last_seen)
             VALUES (?, ?, NOW(), NOW())
             ON DUPLICATE KEY UPDATE last_seen = NOW()`,
            [player.steamid, player.ip],
          );
        } catch (ipErr) {
          logger.error("Failed to store player IP", { error: ipErr.message });
        }
      }

      emitPlayerUpdate({
        steamid: player.steamid,
        name: cleanName,
        server: serverKey,
      });
    }

    // Track map playtime
    if (sanitizedMap) {
      await pool.query(
        `INSERT INTO maps (name, game, playtime, server_ip, server_port, last_played)
         VALUES (?, ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE 
           playtime=playtime+?, 
           server_ip=VALUES(server_ip), 
           server_port=VALUES(server_port), 
           last_played=NOW()`,
        [sanitizedMap, game, PLAYTIME_INCREMENT, ip, port, PLAYTIME_INCREMENT],
      );
    }

    // Emit WebSocket events
    const serverData = {
      ip,
      port,
      game,
      status: 1,
      map: sanitizedMap,
      players: playerCount,
      version: srv.sm_version || "",
    };
    emitServerUpdate(serverData);

    if (!previousServer || previousServer.status === 0) {
      emitServerStatusChange({ ...serverData, statusChange: "online" });
    }
    if (previousServer && previousServer.map !== sanitizedMap) {
      emitMapUpdate({
        server: serverKey,
        oldMap: previousServer.map,
        newMap: sanitizedMap,
      });
    }

    // Invalidate caches
    await deleteCache("cache:servers:*");
    await deleteCache("cache:players:*");
    await deleteCache("cache:maps:*");

    res.json({ ok: true });
  } catch (e) {
    logger.error(`Extension status ingest failed: ${e.message}`);
    res.status(500).json({ error: "Failed to process server status" });
  }
});

/**
 * POST /servers/status/hibernate
 *
 * Called by the plugin when the last player disconnects and the server
 * is about to hibernate. Clears the live flag so the updater immediately
 * resumes polling via Steam Master Server on its next cycle.
 *
 * Expected payload: { ip: "1.2.3.4", port: 27015 }
 */
router.post("/hibernate", async (req, res) => {
  try {
    const { ip, port } = req.body || {};
    const portNum = parseInt(port, 10);

    if (!ip || !isValidIP(ip) || !portNum || portNum < 1 || portNum > 65535) {
      return res.status(400).json({ error: "Invalid ip/port" });
    }

    clearServerLive(ip, portNum);
    logger.info(
      `Server ${ip}:${portNum} hibernate signal received, updater will resume polling`,
    );

    res.json({ ok: true });
  } catch (e) {
    logger.error(`Hibernate signal failed: ${e.message}`);
    res.status(500).json({ error: "Failed to process hibernate signal" });
  }
});

module.exports = router;
