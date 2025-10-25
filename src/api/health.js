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
    const [serverStats] = await pool.query(
      "SELECT COUNT(*) as total, SUM(CASE WHEN status=1 THEN 1 ELSE 0 END) as online, SUM(CASE WHEN status=0 THEN 1 ELSE 0 END) as offline FROM servers",
    );

    const [playerStats] = await pool.query(
      "SELECT COUNT(DISTINCT steamid) as total FROM players",
    );

    const [activePlayersStats] = await pool.query(
      "SELECT COUNT(DISTINCT steamid) as active_24h FROM players WHERE last_seen >= DATE_SUB(NOW(), INTERVAL 24 HOUR)",
    );

    const [mapStats] = await pool.query(
      "SELECT COUNT(DISTINCT name) as total FROM maps",
    );

    const uptime = process.uptime();
    const wsStats = getWebSocketStats();

    res.json({
      servers: {
        total: serverStats[0].total,
        online: serverStats[0].online,
        offline: serverStats[0].offline,
      },
      players: {
        total: playerStats[0].total,
        active_24h: activePlayersStats[0].active_24h,
      },
      maps: {
        total: mapStats[0].total,
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
