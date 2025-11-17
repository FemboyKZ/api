const express = require("express");
const router = express.Router();
const pool = require("../db");
const logger = require("../utils/logger");
const { isRedisConnected } = require("../db/redis");
const { getWebSocketStats } = require("../services/websocket");

router.get("/", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    const wsStats = getWebSocketStats();
    const redisStatus = isRedisConnected();

    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      database: "connected",
      redis: redisStatus ? "connected" : "disconnected",
      websocket: wsStats.connected ? "active" : "inactive",
      websocketClients: wsStats.clients,
    });
  } catch (e) {
    logger.error(`Health check failed: ${e.message}`);
    res.status(503).json({
      status: "error",
      timestamp: new Date().toISOString(),
      database: "disconnected",
      error: e.message,
    });
  }
});

router.get("/stats", async (req, res) => {
  try {
    // Optimized: Combine all stats into a single query
    const [stats] = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM servers) as server_total,
        (SELECT SUM(CASE WHEN status=1 THEN 1 ELSE 0 END) FROM servers) as server_online,
        (SELECT SUM(CASE WHEN status=0 THEN 1 ELSE 0 END) FROM servers) as server_offline,
        (SELECT COUNT(DISTINCT steamid) FROM players) as player_total,
        (SELECT COUNT(DISTINCT steamid) FROM players WHERE last_seen >= DATE_SUB(NOW(), INTERVAL 24 HOUR)) as players_active_24h,
        (SELECT COUNT(DISTINCT name) FROM maps) as map_total
    `);

    const result = stats[0];

    const uptime = process.uptime();
    const wsStats = getWebSocketStats();

    res.json({
      servers: {
        total: result.server_total,
        online: result.server_online,
        offline: result.server_offline,
      },
      players: {
        total: result.player_total,
        active_24h: result.players_active_24h,
      },
      maps: {
        total: result.map_total,
      },
      websocket: {
        connected: wsStats.connected,
        clients: wsStats.clients,
      },
      cache: {
        enabled: isRedisConnected(),
      },
      uptime: Math.floor(uptime),
    });
  } catch (e) {
    logger.error(`Failed to fetch stats: ${e.message}`);
    res.status(500).json({ error: "Failed to fetch statistics" });
  }
});

module.exports = router;
