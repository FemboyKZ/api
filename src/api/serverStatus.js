/**
 * Write path for plugin self-reports; api/servers.js is the read counterpart.
 * Mounted under adminAuth in app.js.
 *
 * Inner catches are deliberate:
 * optional side-effects (history rows, player IPs) are best-effort and must not fail the ingest.
 */

const express = require("express");
const router = express.Router();
const pool = require("../db");
const logger = require("../utils/logger");
const {
  isValidIP,
  parsePort,
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
const {
  trackPlayerSessions,
  trackMapChange,
} = require("../services/serverTracking");

/**
 * POST /servers/status
 *
 * Receives live server data from the gokz-realtime-status plugin.
 * Authenticated via adminAuth middleware (API key, IP whitelist, or localhost).
 *
 * Expected payload (from plugin BuildPayload):
 * {
 *   server: { hostname, ip, port, os, map, players, max_players, bot_count, version, tickrate, secure, mm_version, sm_version, gokz_loaded, cs2kz_loaded, plugins: [...] },
 *   players: [{ steamid, name, ip, time_on_server, in_game, gokz?: { mode, timer_running, paused, time, course, teleports }, cs2kz?: { ... }, playtime_modes?: { kz_vanilla, kz_simple, kz_timer } | { cs2kz_vnl, cs2kz_ckz } }]
 * }
 */
/**
 * @swagger
 * /servers/status:
 *   get:
 *     summary: Not supported
 *     description: This path only accepts POST; a GET always answers 405.
 *     tags: [Servers]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyHeader: []
 *     responses:
 *       405:
 *         description: Method not allowed, use POST
 *       401:
 *         description: Missing or invalid API key
 */
router.get("/", (req, res) => {
  res.status(405).json({ error: "Method not allowed. Use POST." });
});

/**
 * @swagger
 * /servers/status:
 *   post:
 *     summary: Ingest a status report from a server
 *     description: >
 *       Write path used by the game-server plugins to report themselves. The
 *       server must already be registered; unknown addresses are rejected.
 *       Optional side effects (history rows, player IPs) are best-effort and do
 *       not fail the ingest.
 *     tags: [Servers]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyHeader: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [server]
 *             properties:
 *               server:
 *                 type: object
 *                 required: [ip, port]
 *                 properties:
 *                   ip:
 *                     type: string
 *                   port:
 *                     type: integer
 *                   hostname:
 *                     type: string
 *                   map:
 *                     type: string
 *                   os:
 *                     type: string
 *                   version:
 *                     type: string
 *                   secure:
 *                     type: boolean
 *                   max_players:
 *                     type: integer
 *                   bot_count:
 *                     type: integer
 *                   tickrate:
 *                     type: integer
 *                   cs:
 *                     type: string
 *                     description: Game identifier reported by the plugin
 *                   gokz_loaded:
 *                     type: boolean
 *                   sm_version:
 *                     type: string
 *                   mm_version:
 *                     type: string
 *               players:
 *                 type: array
 *                 description: Currently connected players
 *                 items:
 *                   type: object
 *     responses:
 *       200:
 *         description: Status ingested
 *       400:
 *         description: Missing server data, or invalid ip/port
 *       401:
 *         description: Missing or invalid API key
 *       404:
 *         description: Server not registered
 *       500:
 *         description: Server error
 */
router.post("/", async (req, res) => {
  try {
    const payload = req.body;

    if (!payload || !payload.server) {
      return res.status(400).json({ error: "Missing server data" });
    }

    const srv = payload.server;
    const ip = srv.ip;
    const port = parsePort(srv.port);

    if (!ip || !isValidIP(ip) || !port) {
      return res.status(400).json({ error: "Invalid server ip/port" });
    }

    // Config metadata and previous status in one read; used for change detection below.
    const [configRows] = await pool.query(
      `SELECT game, region, domain, api_id, kzt_id, tickrate, status, map, player_count
       FROM servers WHERE ip = ? AND port = ?`,
      [ip, port],
    );

    if (configRows.length === 0) {
      return res.status(404).json({ error: "Server not registered" });
    }

    const serverConfig = configRows[0];
    const game = serverConfig.game;
    const previousServer = serverConfig;

    // Mark server as receiving live data so updater skips external queries
    markServerLive(ip, port);

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

    // Track player sessions and map rotation.
    const serverKey = `${ip}:${port}`;
    await trackPlayerSessions(
      ip,
      port,
      extensionPlayers.filter((p) => p.steamid && p.in_game),
    );
    await trackMapChange(ip, port, sanitizedMap, playerCount);

    // Update individual player stats
    // Use a reasonable increment, extension reports every ~10s, but we don't
    // want to assume. use the actual interval between reports for this server.
    const PLAYTIME_INCREMENT = 10; // seconds (matches extension default interval)

    const connectedPlayers = extensionPlayers.filter(
      (p) => p.steamid && p.in_game,
    );

    // One multi-row upsert instead of a round-trip per player.
    if (connectedPlayers.length > 0) {
      const rows = connectedPlayers.map((p) => [
        p.steamid,
        sanitizePlayerName(p.name) || "Unknown",
        game,
        PLAYTIME_INCREMENT,
        ip,
        port,
      ]);
      await pool.query(
        `INSERT INTO players (steamid, latest_name, latest_ip, game, playtime, server_ip, server_port, last_seen)
         VALUES ${rows.map(() => "(?, ?, NULL, ?, ?, ?, ?, NOW())").join(", ")}
         ON DUPLICATE KEY UPDATE 
           latest_name=VALUES(latest_name), 
           playtime=playtime+VALUES(playtime), 
           server_ip=VALUES(server_ip), 
           server_port=VALUES(server_port), 
           last_seen=NOW()`,
        rows.flat(),
      );
    }

    // Stored privately, never in the players table.
    const playersWithIp = connectedPlayers.filter((p) => p.ip);
    if (playersWithIp.length > 0) {
      try {
        const ipRows = playersWithIp.map((p) => [p.steamid, p.ip]);
        await pool.query(
          `INSERT INTO player_ips (steamid, ip, first_seen, last_seen)
           VALUES ${ipRows.map(() => "(?, ?, NOW(), NOW())").join(", ")}
           ON DUPLICATE KEY UPDATE last_seen = NOW()`,
          ipRows.flat(),
        );
      } catch (ipErr) {
        logger.error("Failed to store player IPs", { error: ipErr.message });
      }
    }

    for (const player of connectedPlayers) {
      const cleanName = sanitizePlayerName(player.name) || "Unknown";

      // Per-gamemode playtime:
      // merge-add the deltas the plugin reports for this interval.
      // `playtime` above stays the total.
      // cs2kz servers send no breakdown, so they keep total-only.
      const modeDeltas = player.playtime_modes;
      if (modeDeltas && typeof modeDeltas === "object") {
        // gokz (csgo): kz_vanilla / kz_simple / kz_timer.
        // cs2kz (counterstrike2): vnl / ckz.
        const ALLOWED_MODES = [
          "kz_vanilla",
          "kz_simple",
          "kz_timer",
          "cs2kz_vnl",
          "cs2kz_ckz",
        ];
        const setExprs = [];
        const setVals = [];
        for (const key of ALLOWED_MODES) {
          if (!(key in modeDeltas)) continue; // only modes the plugin reported
          const raw = Number(modeDeltas[key]);
          if (Number.isFinite(raw) && raw > 0) {
            // Clamp per report to guard against a buggy/abusive delta.
            const delta = Math.min(Math.round(raw), 3600);
            setExprs.push(
              `'$."${key}"', COALESCE(JSON_EXTRACT(playtime_modes, '$."${key}"'), 0) + ?`,
            );
            setVals.push(delta);
          } else {
            // No data yet: show the mode key with null, but never clobber a value already accrued.
            // JSON_EXTRACT returns the existing value, or SQL NULL (-> JSON null) when the key is absent.
            setExprs.push(
              `'$."${key}"', JSON_EXTRACT(playtime_modes, '$."${key}"')`,
            );
          }
        }
        if (setExprs.length > 0) {
          await pool.query(
            `UPDATE players
             SET playtime_modes = JSON_SET(COALESCE(playtime_modes, JSON_OBJECT()), ${setExprs.join(", ")})
             WHERE steamid = ? AND game = ?`,
            [...setVals, player.steamid, game],
          );
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

    await deleteCache("cache:servers:*");
    await deleteCache("cache:players:*");
    await deleteCache("cache:maps:*");

    res.json({ success: true });
  } catch (error) {
    logger.error(`Extension status ingest failed: ${error.message}`);
    res.status(500).json({ error: "Failed to process server status" });
  }
});

/**
 * POST /servers/status/hibernate
 *
 * Called by the plugin when the last player disconnects and the server is about to hibernate.
 * Clears the live flag so the updater immediately resumes polling via Steam Master Server on its next cycle.
 *
 * Expected payload: { ip: "1.2.3.4", port: 27015 }
 */
/**
 * @swagger
 * /servers/status/hibernate:
 *   post:
 *     summary: Mark a server as hibernating
 *     description: Clears the server's live state when it goes idle.
 *     tags: [Servers]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyHeader: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [ip, port]
 *             properties:
 *               ip:
 *                 type: string
 *               port:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Hibernate signal accepted
 *       400:
 *         description: Invalid ip/port
 *       401:
 *         description: Missing or invalid API key
 *       500:
 *         description: Server error
 */
router.post("/hibernate", async (req, res) => {
  try {
    const { ip, port } = req.body || {};
    const portNum = parsePort(port);

    if (!ip || !isValidIP(ip) || !portNum) {
      return res.status(400).json({ error: "Invalid ip/port" });
    }

    clearServerLive(ip, portNum);
    logger.info(
      `Server ${ip}:${portNum} hibernate signal received, updater will resume polling`,
    );

    res.json({ success: true });
  } catch (error) {
    logger.error(`Hibernate signal failed: ${error.message}`);
    res.status(500).json({ error: "Failed to process hibernate signal" });
  }
});

module.exports = router;
