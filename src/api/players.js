const express = require("express");
const router = express.Router();
const pool = require("../db");
const {
  isValidSteamID,
  validatePagination,
  sanitizeString,
} = require("../utils/validators");
const logger = require("../utils/logger");
const {
  cacheMiddleware,
  playersKeyGenerator,
} = require("../utils/cacheMiddleware");

/**
 * @swagger
 * components:
 *   schemas:
 *     Player:
 *       type: object
 *       properties:
 *         steamid:
 *           type: string
 *           description: Player Steam ID
 *           example: "76561198000000000"
 *         game:
 *           type: string
 *           description: Game type
 *           example: "csgo"
 *         total_playtime:
 *           type: integer
 *           description: Total playtime in minutes
 *           example: 12450
 *     PlayerDetails:
 *       type: object
 *       properties:
 *         steamid:
 *           type: string
 *         stats:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               game:
 *                 type: string
 *               total_playtime:
 *                 type: integer
 *               last_seen:
 *                 type: string
 *                 format: date-time
 */

/**
 * @swagger
 * /players:
 *   get:
 *     summary: Get all players
 *     description: Returns a paginated list of players with their total playtime per game
 *     tags: [Players]
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
 *           enum: [total_playtime, steamid]
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
 *         description: Filter by player name (partial match)
 *     responses:
 *       200:
 *         description: Successful response with player list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 players:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Player'
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
router.get("/", cacheMiddleware(30, playersKeyGenerator), async (req, res) => {
  try {
    const { page, limit, sort, order, name, game } = req.query;
    const { limit: validLimit, offset } = validatePagination(page, limit, 100);

    const validSortFields = ["total_playtime", "steamid"];
    const sortField = validSortFields.includes(sort) ? sort : "total_playtime";
    const sortOrder = order === "asc" ? "ASC" : "DESC";

    let query = "SELECT steamid, game, SUM(playtime) as total_playtime FROM players WHERE 1=1";
    const params = [];

    if (game) {
      query += " AND game = ?";
      params.push(sanitizeString(game, 50));
    }

    if (name) {
      query += " AND name LIKE ?";
      params.push(`%${sanitizeString(name, 100)}%`);
    }

    query += ` GROUP BY steamid, game ORDER BY ${sortField} ${sortOrder} LIMIT ? OFFSET ?`;
    params.push(validLimit, offset);

    const [players] = await pool.query(query, params);

    let countQuery = "SELECT COUNT(DISTINCT CONCAT(steamid, '-', game)) as total FROM players WHERE 1=1";
    const countParams = [];
    if (game) {
      countQuery += " AND game = ?";
      countParams.push(sanitizeString(game, 50));
    }
    if (name) {
      countQuery += " AND name LIKE ?";
      countParams.push(`%${sanitizeString(name, 100)}%`);
    }
    const [countResult] = await pool.query(countQuery, countParams);

    res.json({
      data: players,
      pagination: {
        page: parseInt(page, 10) || 1,
        limit: validLimit,
        total: countResult[0].total,
        totalPages: Math.ceil(countResult[0].total / validLimit),
      },
    });
  } catch (e) {
    logger.error(`Failed to fetch players: ${e.message}`);
    res.status(500).json({ error: "Failed to fetch players" });
  }
});

/**
 * @swagger
 * /players/{steamid}:
 *   get:
 *     summary: Get player by Steam ID
 *     description: Returns detailed statistics for a specific player
 *     tags: [Players]
 *     parameters:
 *       - in: path
 *         name: steamid
 *         required: true
 *         schema:
 *           type: string
 *         description: Player Steam ID (SteamID64, SteamID3, or SteamID2 format)
 *         example: "76561198000000000"
 *       - in: query
 *         name: game
 *         schema:
 *           type: string
 *         description: Filter by game type
 *         example: csgo
 *     responses:
 *       200:
 *         description: Successful response with player details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PlayerDetails'
 *       400:
 *         description: Invalid Steam ID format
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Invalid SteamID format"
 *       404:
 *         description: Player not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Player not found"
 *       500:
 *         description: Server error
 */
router.get("/:steamid", async (req, res) => {
  try {
    const { steamid } = req.params;
    const { game } = req.query;

    if (!isValidSteamID(steamid)) {
      return res.status(400).json({ error: "Invalid SteamID format" });
    }

    let query = "SELECT * FROM players WHERE steamid = ?";
    const params = [steamid];

    if (game) {
      query += " AND game = ?";
      params.push(sanitizeString(game, 50));
    }

    query += " ORDER BY last_seen DESC";

    const [rows] = await pool.query(query, params);
    if (rows.length === 0) {
      return res.status(404).json({ error: "Player not found" });
    }

    let statsQuery = "SELECT game, SUM(playtime) as total_playtime, MAX(last_seen) as last_seen FROM players WHERE steamid = ?";
    const statsParams = [steamid];

    if (game) {
      statsQuery += " AND game = ?";
      statsParams.push(sanitizeString(game, 50));
    }

    statsQuery += " GROUP BY game";

    const [stats] = await pool.query(statsQuery, statsParams);

    res.json({
      steamid,
      stats: stats.map(s => ({
        game: s.game,
        total_playtime: s.total_playtime || 0,
        last_seen: s.last_seen,
      })),
      sessions: rows,
    });
  } catch (e) {
    logger.error(`Player fetch error for ${req.params.steamid}: ${e.message}`);
    res.status(500).json({ error: "Player fetch error" });
  }
});

module.exports = router;
