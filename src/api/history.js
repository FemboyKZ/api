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
 * @swagger
 * /history/servers/{ip}/{port}:
 *   get:
 *     summary: Get historical data for a specific server
 *     description: Returns historical player count and status data for a specific server
 *     tags: [History]
 *     parameters:
 *       - in: path
 *         name: ip
 *         required: true
 *         schema:
 *           type: string
 *         description: Server IP address
 *       - in: path
 *         name: port
 *         required: true
 *         schema:
 *           type: integer
 *         description: Server port
 *       - in: query
 *         name: hours
 *         schema:
 *           type: integer
 *           default: 24
 *           maximum: 168
 *         description: Number of hours of history to retrieve (max 1 week)
 *       - in: query
 *         name: interval
 *         schema:
 *           type: integer
 *           default: 60
 *           minimum: 30
 *         description: Interval in seconds for downsampling data
 *     responses:
 *       200:
 *         description: Successful response with server history
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 total:
 *                   type: integer
 *                   description: Total number of data points
 *                 server:
 *                   type: string
 *                   description: Server identifier (ip:port)
 *                   example: "185.107.96.59:27015"
 *                 hours:
 *                   type: integer
 *                   description: Number of hours of history retrieved
 *                   example: 24
 *                 interval:
 *                   type: integer
 *                   description: Interval in seconds used for downsampling
 *                   example: 60
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *       400:
 *         description: Invalid IP address
 *       500:
 *         description: Server error
 */

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
        total: downsampled.length,
        server: `${ip}:${port}`,
        hours: hoursInt,
        interval: intervalInt,
        data: downsampled,
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
 * @swagger
 * /history/players/{steamid}:
 *   get:
 *     summary: Get player session history
 *     description: Returns historical session data for a specific player
 *     tags: [History]
 *     parameters:
 *       - in: path
 *         name: steamid
 *         required: true
 *         schema:
 *           type: string
 *         description: Player Steam ID
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Items per page
 *     responses:
 *       200:
 *         description: Successful response with player session history
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 total:
 *                   type: integer
 *                   description: Total number of sessions
 *                 steamid:
 *                   type: string
 *                   description: Player Steam ID
 *                   example: "76561198000000000"
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     page:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *                     totalPages:
 *                       type: integer
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *       500:
 *         description: Server error
 */

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
      const { page = 1, limit = 20 } = req.query;
      const { limit: validLimit, offset } = validatePagination(page, limit);

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
        [steamid, validLimit, offset],
      );

      const [[{ total }]] = await pool.query(
        "SELECT COUNT(*) as total FROM player_sessions WHERE steamid = ?",
        [steamid],
      );

      logger.logRequest(req, res, Date.now() - startTime);

      res.json({
        total: total,
        steamid: steamid,
        pagination: {
          page: parseInt(page, 10),
          limit: validLimit,
          totalPages: Math.ceil(total / validLimit),
        },
        data: sessions,
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
 * @swagger
 * /history/maps:
 *   get:
 *     summary: Get map rotation history
 *     description: Returns historical map rotation data across all servers
 *     tags: [History]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Items per page
 *       - in: query
 *         name: server
 *         schema:
 *           type: string
 *         description: Filter by server (format ip:port)
 *       - in: query
 *         name: map
 *         schema:
 *           type: string
 *         description: Filter by map name (partial match)
 *     responses:
 *       200:
 *         description: Successful response with map history
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 total:
 *                   type: integer
 *                   description: Total number of map records
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     page:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *                     totalPages:
 *                       type: integer
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *       500:
 *         description: Server error
 */

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
      const { page = 1, limit = 20, server, map } = req.query;
      const { limit: validLimit, offset } = validatePagination(page, limit);

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
      params.push(validLimit, offset);

      const [rows] = await pool.query(query, params);

      const [[{ total }]] = await pool.query(
        "SELECT COUNT(*) as total FROM map_history",
      );

      logger.logRequest(req, res, Date.now() - startTime);

      res.json({
        total: total,
        pagination: {
          page: parseInt(page, 10),
          limit: validLimit,
          totalPages: Math.ceil(total / validLimit),
        },
        data: rows,
      });
    } catch (error) {
      logger.error("Failed to fetch map history", { error: error.message });
      res.status(500).json({ error: "Failed to fetch map history" });
    }
  },
);

/**
 * @swagger
 * /history/trends/daily:
 *   get:
 *     summary: Get daily aggregated statistics
 *     description: Returns daily statistics aggregated by date
 *     tags: [History]
 *     parameters:
 *       - in: query
 *         name: days
 *         schema:
 *           type: integer
 *           default: 7
 *           maximum: 90
 *         description: Number of days to retrieve (max 90 days)
 *       - in: query
 *         name: server
 *         schema:
 *           type: string
 *         description: Filter by server (format ip:port)
 *     responses:
 *       200:
 *         description: Successful response with daily trends
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 total:
 *                   type: integer
 *                   description: Total number of data points
 *                 days:
 *                   type: integer
 *                   description: Number of days of data retrieved
 *                   example: 7
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *       500:
 *         description: Server error
 */

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
        total: rows.length,
        days: daysInt,
        data: rows,
      });
    } catch (error) {
      logger.error("Failed to fetch daily trends", { error: error.message });
      res.status(500).json({ error: "Failed to fetch daily trends" });
    }
  },
);

/**
 * @swagger
 * /history/trends/hourly:
 *   get:
 *     summary: Get hourly player count trends
 *     description: Returns hourly aggregated player statistics
 *     tags: [History]
 *     parameters:
 *       - in: query
 *         name: hours
 *         schema:
 *           type: integer
 *           default: 24
 *           maximum: 168
 *         description: Number of hours to retrieve (max 1 week)
 *       - in: query
 *         name: server
 *         schema:
 *           type: string
 *         description: Filter by server (format ip:port)
 *     responses:
 *       200:
 *         description: Successful response with hourly trends
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 total:
 *                   type: integer
 *                   description: Total number of data points
 *                 hours:
 *                   type: integer
 *                   description: Number of hours of data retrieved
 *                   example: 24
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *       500:
 *         description: Server error
 */

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
        total: rows.length,
        hours: hoursInt,
        data: rows,
      });
    } catch (error) {
      logger.error("Failed to fetch hourly trends", { error: error.message });
      res.status(500).json({ error: "Failed to fetch hourly trends" });
    }
  },
);

module.exports = router;
