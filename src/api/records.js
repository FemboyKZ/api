const express = require("express");
const router = express.Router();
const pool = require("../db");
const { fetchRecentRecordsForServers } = require("../services/cs2kzRecords");
const logger = require("../utils/logger");
const { cacheMiddleware } = require("../utils/cacheMiddleware");

/**
 * @swagger
 * /records:
 *   get:
 *     summary: Records API information
 *     description: Returns available records endpoints
 *     tags: [Records]
 *     responses:
 *       200:
 *         description: List of available endpoints
 */
router.get("/", (req, res) => {
  res.json({
    endpoints: {
      "/records/recent": "Get recent records from all CS2 servers",
      "/records/server/:ip/:port": "Get recent records for a specific server",
    },
    documentation: "/docs",
  });
});

/**
 * @swagger
 * components:
 *   schemas:
 *     CS2KZRecord:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           description: Record ID
 *         player_id:
 *           type: integer
 *           description: CS2KZ player ID
 *         player_name:
 *           type: string
 *           description: Player name
 *         steam_id:
 *           type: string
 *           description: Player Steam ID
 *         map_id:
 *           type: integer
 *           description: Map ID
 *         map_name:
 *           type: string
 *           description: Map name
 *         course_id:
 *           type: integer
 *           description: Course ID
 *         mode_id:
 *           type: integer
 *           description: Mode ID (1=KZT, 2=SKZ, 3=VNL)
 *         style_id:
 *           type: integer
 *           description: Style ID (1=Normal, 2=Low-Grav, etc.)
 *         teleports:
 *           type: integer
 *           description: Number of teleports used
 *         time:
 *           type: number
 *           description: Record time in seconds
 *         created_on:
 *           type: string
 *           format: date-time
 *           description: Record submission date
 *     ServerRecords:
 *       type: object
 *       properties:
 *         apiId:
 *           type: integer
 *           description: CS2KZ API server ID
 *         records:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/CS2KZRecord'
 */

/**
 * @swagger
 * /records/recent:
 *   get:
 *     summary: Get recent records from all CS2 servers
 *     description: Fetches the most recent records from CS2KZ API for all configured CS2 servers
 *     tags: [Records]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *           minimum: 1
 *           maximum: 100
 *         description: Maximum number of records per server
 *     responses:
 *       200:
 *         description: Successful response with recent records per server
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties:
 *                 $ref: '#/components/schemas/ServerRecords'
 *             example:
 *               "37.27.107.76:27015":
 *                 apiId: 4
 *                 records:
 *                   - id: 123456
 *                     player_name: "Joee"
 *                     map_name: "kz_checkmate"
 *                     time: 185.42
 *                     created_on: "2025-01-15T14:32:10Z"
 *       500:
 *         description: Server error
 */
// Cache for 60 seconds
router.get("/recent", cacheMiddleware(60), async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 100);

    // Get all servers from database
    const [servers] = await pool.query(
      "SELECT ip, port, game, api_id as apiId FROM servers WHERE status = 1 AND game = 'counterstrike2' AND api_id IS NOT NULL"
    );

    if (servers.length === 0) {
      return res.json({});
    }

    // Fetch recent records for all servers
    const records = await fetchRecentRecordsForServers(servers, limit);

    res.json(records);
  } catch (e) {
    logger.error(`Failed to fetch recent records: ${e.message}`);
    res.status(500).json({ error: "Failed to fetch recent records" });
  }
});

/**
 * @swagger
 * /records/server/{ip}/{port}:
 *   get:
 *     summary: Get recent records for a specific server
 *     description: Fetches the most recent records from CS2KZ API for a specific CS2 server
 *     tags: [Records]
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
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *           minimum: 1
 *           maximum: 100
 *         description: Maximum number of records to fetch
 *     responses:
 *       200:
 *         description: Successful response with recent records
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ServerRecords'
 *       404:
 *         description: Server not found or no apiId configured
 *       500:
 *         description: Server error
 */
router.get("/server/:ip/:port", cacheMiddleware(60), async (req, res) => {
  try {
    const { ip, port } = req.params;
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 100);

    // Get server from database
    const [servers] = await pool.query(
      "SELECT ip, port, game, api_id as apiId FROM servers WHERE ip = ? AND port = ?",
      [ip, parseInt(port)]
    );

    if (servers.length === 0) {
      return res.status(404).json({ error: "Server not found" });
    }

    const server = servers[0];

    if (server.game !== "counterstrike2") {
      return res.status(400).json({ error: "Records are only available for CS2 servers" });
    }

    if (!server.apiId) {
      return res.status(404).json({ error: "Server does not have a CS2KZ API ID configured" });
    }

    // Fetch recent records
    const records = await fetchRecentRecordsForServers([server], limit);
    const serverKey = `${ip}:${port}`;

    res.json(records[serverKey] || { apiId: server.apiId, records: [] });
  } catch (e) {
    logger.error(`Failed to fetch server records: ${e.message}`);
    res.status(500).json({ error: "Failed to fetch server records" });
  }
});

module.exports = router;
