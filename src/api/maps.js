const express = require("express");
const router = express.Router();
const pool = require("../db");
const {
  validatePagination,
  sanitizeString,
  isValidIP,
  isValidPort,
} = require("../utils/validators");
const logger = require("../utils/logger");
const {
  cacheMiddleware,
  mapsKeyGenerator,
} = require("../utils/cacheMiddleware");

/**
 * @swagger
 * components:
 *   schemas:
 *     Map:
 *       type: object
 *       properties:
 *         name:
 *           type: string
 *           description: Map name
 *           example: "kz_synergy_x"
 *         game:
 *           type: string
 *           description: Game type
 *           example: "csgo"
 *         total_playtime:
 *           type: integer
 *           description: Total playtime in minutes
 *           example: 54320
 */

/**
 * @swagger
 * /maps:
 *   get:
 *     summary: Get all maps
 *     description: Returns a paginated list of maps with their total playtime
 *     tags: [Maps]
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
 *           default: 50
 *           maximum: 100
 *         description: Items per page
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           enum: [total_playtime, name]
 *           default: total_playtime
 *         description: Sort field
 *       - in: query
 *         name: order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *         description: Sort order
 *       - in: query
 *         name: game
 *         schema:
 *           type: string
 *         description: Filter by game type
 *         example: csgo
 *       - in: query
 *         name: name
 *         schema:
 *           type: string
 *         description: Filter by map name (partial match)
 *       - in: query
 *         name: server
 *         schema:
 *           type: string
 *         description: Filter by server (format ip:port)
 *         example: "185.107.96.59:27015"
 *     responses:
 *       200:
 *         description: Successful response with map list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 maps:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Map'
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                     page:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *                     totalPages:
 *                       type: integer
 *       500:
 *         description: Server error
 */
// Cache for 30 seconds
router.get("/", cacheMiddleware(30, mapsKeyGenerator), async (req, res) => {
  try {
    const { page, limit, sort, order, server, name, game } = req.query;
    const { limit: validLimit, offset } = validatePagination(page, limit, 100);

    const validSortFields = ["total_playtime", "name"];
    const sortField = validSortFields.includes(sort) ? sort : "total_playtime";
    const sortOrder = order === "asc" ? "ASC" : "DESC";

    let query =
      "SELECT name, game, SUM(playtime) AS total_playtime FROM maps WHERE 1=1";
    const params = [];

    if (game) {
      query += " AND game = ?";
      params.push(sanitizeString(game, 50));
    }

    if (server) {
      const [ip, port] = server.split(":");
      if (ip && port && isValidIP(ip) && isValidPort(port)) {
        query += " AND server_ip = ? AND server_port = ?";
        params.push(ip, parseInt(port, 10));
      }
    }

    if (name) {
      query += " AND name LIKE ?";
      params.push(`%${sanitizeString(name, 100)}%`);
    }

    query += ` GROUP BY name, game ORDER BY ${sortField} ${sortOrder} LIMIT ? OFFSET ?`;
    params.push(validLimit, offset);

    const [maps] = await pool.query(query, params);

    let countQuery = "SELECT COUNT(DISTINCT CONCAT(name, '-', game)) as total FROM maps WHERE 1=1";
    const countParams = [];
    if (game) {
      countQuery += " AND game = ?";
      countParams.push(sanitizeString(game, 50));
    }
    if (server) {
      const [ip, port] = server.split(":");
      if (ip && port && isValidIP(ip) && isValidPort(port)) {
        countQuery += " AND server_ip = ? AND server_port = ?";
        countParams.push(ip, parseInt(port, 10));
      }
    }
    if (name) {
      countQuery += " AND name LIKE ?";
      countParams.push(`%${sanitizeString(name, 100)}%`);
    }

    const [countResult] = await pool.query(countQuery, countParams);

    res.json({
      data: maps,
      pagination: {
        page: parseInt(page, 10) || 1,
        limit: validLimit,
        total: countResult[0].total,
        totalPages: Math.ceil(countResult[0].total / validLimit),
      },
    });
  } catch (e) {
    logger.error(`Failed to fetch maps: ${e.message}`);
    res.status(500).json({ error: "Failed to fetch maps" });
  }
});

module.exports = router;
