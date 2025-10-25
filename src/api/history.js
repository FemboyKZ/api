const express = require("express");
const router = express.Router();
const pool = require("../db");
const logger = require("../utils/logger");
const { validatePagination, isValidIP } = require("../utils/validators");
const {
  cacheMiddleware,
  generateCacheKey,
} = require("../utils/cacheMiddleware");

/**
 * GET /history/servers/:ip/:port
 * Get historical data for a specific server
 */
router.get(
  "/servers/:ip/:port",
  cacheMiddleware(60, (req) =>
    generateCacheKey("history:server", req.params, req.query),
  ),
  async (req, res) => {
    const startTime = Date.now();
    try {
      const { ip, port } = req.params;
      const { hours = 24, interval = 60 } = req.query;

      if (!isValidIP(ip)) {
        return res.status(400).json({ error: "Invalid IP address" });
      }

      const hoursInt = Math.min(Math.max(parseInt(hours, 10) || 24, 1), 168); // Max 1 week
      const intervalInt = Math.max(parseInt(interval, 10) || 60, 30); // Min 30 seconds

      const query = `
        SELECT 
          server_ip,
          server_port,
          status,
          map,
          player_count,
          maxplayers,
          recorded_at
        FROM server_history
        WHERE server_ip = ? AND server_port = ?
          AND recorded_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)
        ORDER BY recorded_at DESC
      `;

      const [rows] = await pool.query(query, [
        ip,
        parseInt(port, 10),
        hoursInt,
      ]);

      // Downsample data based on interval
      const downsampled = [];
      let lastTimestamp = null;

      for (const row of rows.reverse()) {
        const timestamp = new Date(row.recorded_at).getTime();
        if (!lastTimestamp || timestamp - lastTimestamp >= intervalInt * 1000) {
          downsampled.push(row);
          lastTimestamp = timestamp;
        }
      }

      logger.logRequest(req, res, Date.now() - startTime);

      res.json({
        server: `${ip}:${port}`,
        hours: hoursInt,
        interval: intervalInt,
        dataPoints: downsampled.length,
        history: downsampled,
      });
    } catch (error) {
      logger.error("Failed to fetch server history", {
        error: error.message,
        ip: req.params.ip,
        port: req.params.port,
      });
      res.status(500).json({ error: "Failed to fetch server history" });
    }
  },
);

/**
 * GET /history/players/:steamid
 * Get player session history
 */
router.get(
  "/players/:steamid",
  cacheMiddleware(60, (req) =>
    generateCacheKey("history:player", req.params, req.query),
  ),
  async (req, res) => {
    const startTime = Date.now();
    try {
      const { steamid } = req.params;
      const { page, limit } = validatePagination(req.query);

      const offset = (page - 1) * limit;

      const [sessions] = await pool.query(
        `SELECT 
          steamid,
          name,
          server_ip,
          server_port,
          joined_at,
          left_at,
          duration
        FROM player_sessions
        WHERE steamid = ?
        ORDER BY joined_at DESC
        LIMIT ? OFFSET ?`,
        [steamid, limit, offset],
      );

      const [[{ total }]] = await pool.query(
        "SELECT COUNT(*) as total FROM player_sessions WHERE steamid = ?",
        [steamid],
      );

      logger.logRequest(req, res, Date.now() - startTime);

      res.json({
        steamid,
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        sessions,
      });
    } catch (error) {
      logger.error("Failed to fetch player history", {
        error: error.message,
        steamid: req.params.steamid,
      });
      res.status(500).json({ error: "Failed to fetch player history" });
    }
  },
);

/**
 * GET /history/maps
 * Get map rotation history across all servers
 */
router.get(
  "/maps",
  cacheMiddleware(60, (req) => generateCacheKey("history:maps", {}, req.query)),
  async (req, res) => {
    const startTime = Date.now();
    try {
      const { page, limit } = validatePagination(req.query);
      const { server, map } = req.query;

      const offset = (page - 1) * limit;
      let query = "SELECT * FROM map_history WHERE 1=1";
      const params = [];

      if (server) {
        const [ip, port] = server.split(":");
        if (ip && port) {
          query += " AND server_ip = ? AND server_port = ?";
          params.push(ip, parseInt(port, 10));
        }
      }

      if (map) {
        query += " AND map_name LIKE ?";
        params.push(`%${map}%`);
      }

      query += " ORDER BY started_at DESC LIMIT ? OFFSET ?";
      params.push(limit, offset);

      const [rows] = await pool.query(query, params);

      const [[{ total }]] = await pool.query(
        "SELECT COUNT(*) as total FROM map_history",
      );

      logger.logRequest(req, res, Date.now() - startTime);

      res.json({
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        maps: rows,
      });
    } catch (error) {
      logger.error("Failed to fetch map history", { error: error.message });
      res.status(500).json({ error: "Failed to fetch map history" });
    }
  },
);

/**
 * GET /history/trends/daily
 * Get daily aggregated statistics
 */
router.get(
  "/trends/daily",
  cacheMiddleware(300, (req) =>
    generateCacheKey("history:trends:daily", {}, req.query),
  ),
  async (req, res) => {
    const startTime = Date.now();
    try {
      const { days = 7, server } = req.query;
      const daysInt = Math.min(Math.max(parseInt(days, 10) || 7, 1), 90);

      let query = `
        SELECT 
          stat_date,
          server_ip,
          server_port,
          total_players,
          unique_players,
          peak_players,
          avg_players,
          uptime_minutes,
          total_maps_played
        FROM daily_stats
        WHERE stat_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
      `;
      const params = [daysInt];

      if (server) {
        const [ip, port] = server.split(":");
        if (ip && port) {
          query += " AND server_ip = ? AND server_port = ?";
          params.push(ip, parseInt(port, 10));
        }
      }

      query += " ORDER BY stat_date DESC, server_ip, server_port";

      const [rows] = await pool.query(query, params);

      logger.logRequest(req, res, Date.now() - startTime);

      res.json({
        days: daysInt,
        dataPoints: rows.length,
        stats: rows,
      });
    } catch (error) {
      logger.error("Failed to fetch daily trends", { error: error.message });
      res.status(500).json({ error: "Failed to fetch daily trends" });
    }
  },
);

/**
 * GET /history/trends/hourly
 * Get hourly player count trends
 */
router.get(
  "/trends/hourly",
  cacheMiddleware(60, (req) =>
    generateCacheKey("history:trends:hourly", {}, req.query),
  ),
  async (req, res) => {
    const startTime = Date.now();
    try {
      const { hours = 24, server } = req.query;
      const hoursInt = Math.min(Math.max(parseInt(hours, 10) || 24, 1), 168);

      let query = `
        SELECT 
          DATE_FORMAT(recorded_at, '%Y-%m-%d %H:00:00') as hour,
          server_ip,
          server_port,
          AVG(player_count) as avg_players,
          MAX(player_count) as peak_players,
          MIN(player_count) as min_players
        FROM server_history
        WHERE recorded_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)
      `;
      const params = [hoursInt];

      if (server) {
        const [ip, port] = server.split(":");
        if (ip && port) {
          query += " AND server_ip = ? AND server_port = ?";
          params.push(ip, parseInt(port, 10));
        }
      }

      query += " GROUP BY hour, server_ip, server_port ORDER BY hour DESC";

      const [rows] = await pool.query(query, params);

      logger.logRequest(req, res, Date.now() - startTime);

      res.json({
        hours: hoursInt,
        dataPoints: rows.length,
        trends: rows,
      });
    } catch (error) {
      logger.error("Failed to fetch hourly trends", { error: error.message });
      res.status(500).json({ error: "Failed to fetch hourly trends" });
    }
  },
);

module.exports = router;
