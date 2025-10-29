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
      "SELECT name, game, SUM(playtime) AS total_playtime, MAX(globalInfo) as globalInfo FROM maps WHERE 1=1";
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

    // Parse globalInfo JSON for each map
    const parsedMaps = maps.map(map => {
      let globalInfo = null;
      if (map.globalInfo) {
        try {
          globalInfo = typeof map.globalInfo === 'string' 
            ? JSON.parse(map.globalInfo) 
            : map.globalInfo;
        } catch (e) {
          logger.error(`Failed to parse globalInfo for map ${map.name}: ${e.message}`);
        }
      }
      
      return {
        name: map.name,
        game: map.game,
        total_playtime: map.total_playtime,
        globalInfo: globalInfo,
      };
    });

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
      data: parsedMaps,
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

/**
 * @swagger
 * /maps/{mapname}:
 *   get:
 *     summary: Get map by name
 *     description: Returns detailed statistics for a specific map
 *     tags: [Maps]
 *     parameters:
 *       - in: path
 *         name: mapname
 *         required: true
 *         schema:
 *           type: string
 *         description: Map name
 *         example: "kz_synergy_x"
 *       - in: query
 *         name: game
 *         schema:
 *           type: string
 *         description: Filter by game type
 *         example: csgo
 *     responses:
 *       200:
 *         description: Successful response with map details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 name:
 *                   type: string
 *                   description: Map name
 *                 stats:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       game:
 *                         type: string
 *                       total_playtime:
 *                         type: integer
 *                       last_played:
 *                         type: string
 *                         format: date-time
 *                 sessions:
 *                   type: array
 *                   description: Individual play sessions for this map
 *                   items:
 *                     type: object
 *       404:
 *         description: Map not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Map not found"
 *       500:
 *         description: Server error
 */
router.get("/:mapname", async (req, res) => {
  try {
    const { mapname } = req.params;
    const { game } = req.query;

    // Validate and sanitize map name
    const sanitizedMapName = sanitizeString(mapname, 100);

    let query = "SELECT * FROM maps WHERE name = ?";
    const params = [sanitizedMapName];

    if (game) {
      query += " AND game = ?";
      params.push(sanitizeString(game, 50));
    }

    query += " ORDER BY last_played DESC";

    const [rows] = await pool.query(query, params);
    if (rows.length === 0) {
      return res.status(404).json({ error: "Map not found" });
    }

    let statsQuery = "SELECT game, SUM(playtime) as total_playtime, MAX(last_played) as last_played FROM maps WHERE name = ?";
    const statsParams = [sanitizedMapName];

    if (game) {
      statsQuery += " AND game = ?";
      statsParams.push(sanitizeString(game, 50));
    }

    statsQuery += " GROUP BY game";

    const [stats] = await pool.query(statsQuery, statsParams);

    // Parse globalInfo for each stat entry
    const parsedStats = stats.map(s => {
      let globalInfo = null;
      
      // Get globalInfo from the first matching row
      const rowWithGlobalInfo = rows.find(r => r.game === s.game && r.globalInfo);
      if (rowWithGlobalInfo && rowWithGlobalInfo.globalInfo) {
        try {
          globalInfo = typeof rowWithGlobalInfo.globalInfo === 'string'
            ? JSON.parse(rowWithGlobalInfo.globalInfo)
            : rowWithGlobalInfo.globalInfo;
        } catch (e) {
          logger.error(`Failed to parse globalInfo for ${sanitizedMapName}: ${e.message}`);
        }
      }
      
      return {
        game: s.game,
        total_playtime: s.total_playtime || 0,
        last_played: s.last_played,
        globalInfo: globalInfo,
      };
    });

    res.json({
      name: sanitizedMapName,
      stats: parsedStats,
      sessions: rows,
    });
  } catch (e) {
    logger.error(`Map fetch error for ${req.params.mapname}: ${e.message}`);
    res.status(500).json({ error: "Map fetch error" });
  }
});

module.exports = router;
