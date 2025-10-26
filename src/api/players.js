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
 *         name:
 *           type: string
 *           description: Player name (latest seen across all games)
 *           example: "PlayerName"
 *         csgo:
 *           type: object
 *           description: CS:GO statistics (empty object if player hasn't played CS:GO)
 *           properties:
 *             total_playtime:
 *               type: integer
 *               description: Total playtime in seconds
 *               example: 12450
 *             last_seen:
 *               type: string
 *               format: date-time
 *               example: "2025-10-26T12:00:00Z"
 *         counterstrike2:
 *           type: object
 *           description: CS2 statistics (empty object if player hasn't played CS2)
 *           properties:
 *             total_playtime:
 *               type: integer
 *               description: Total playtime in seconds
 *               example: 8200
 *             last_seen:
 *               type: string
 *               format: date-time
 *               example: "2025-10-26T14:30:00Z"
 *     PlayerDetails:
 *       type: object
 *       properties:
 *         steamid:
 *           type: string
 *         csgo:
 *           type: object
 *           properties:
 *             total_playtime:
 *               type: integer
 *             last_seen:
 *               type: string
 *               format: date-time
 *             sessions:
 *               type: array
 *               items:
 *                 type: object
 *         counterstrike2:
 *           type: object
 *           properties:
 *             total_playtime:
 *               type: integer
 *             last_seen:
 *               type: string
 *               format: date-time
 *             sessions:
 *               type: array
 *               items:
 *                 type: object
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
 *         description: Filter by game type (only returns players who have played this game)
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

    const validSortFields = ["total_playtime", "steamid", "last_seen"];
    const sortField = validSortFields.includes(sort) ? sort : "total_playtime";
    const sortOrder = order === "asc" ? "ASC" : "DESC";

    // Get all player data grouped by steamid and game
    let query = `
      SELECT 
        steamid, 
        latest_name as name, 
        game, 
        SUM(playtime) as total_playtime,
        MAX(last_seen) as last_seen
      FROM players 
      WHERE 1=1
    `;
    const params = [];

    if (game) {
      query += " AND game = ?";
      params.push(sanitizeString(game, 50));
    }

    if (name) {
      query += " AND latest_name LIKE ?";
      params.push(`%${sanitizeString(name, 100)}%`);
    }

    query += " GROUP BY steamid, game";

    const [rawPlayers] = await pool.query(query, params);

    // Group by steamid and structure data by game
    const playerMap = new Map();
    
    for (const row of rawPlayers) {
      if (!playerMap.has(row.steamid)) {
        playerMap.set(row.steamid, {
          steamid: row.steamid,
          name: row.name, // Will be updated to most recent
          csgo: {},
          counterstrike2: {},
          _lastSeen: null, // For sorting
          _totalPlaytime: 0, // For sorting
        });
      }
      
      const player = playerMap.get(row.steamid);
      
      // Update name to most recent across all games
      if (!player._lastSeen || new Date(row.last_seen) > new Date(player._lastSeen)) {
        player.name = row.name;
        player._lastSeen = row.last_seen;
      }
      
      // Add game-specific stats
      if (row.game === 'csgo') {
        player.csgo = {
          total_playtime: row.total_playtime || 0,
          last_seen: row.last_seen,
        };
      } else if (row.game === 'counterstrike2') {
        player.counterstrike2 = {
          total_playtime: row.total_playtime || 0,
          last_seen: row.last_seen,
        };
      }
      
      // Track combined playtime for sorting
      player._totalPlaytime += row.total_playtime || 0;
    }

    // Convert map to array and remove internal sorting fields
    let players = Array.from(playerMap.values()).map(p => {
      const { _lastSeen, _totalPlaytime, ...playerData } = p;
      return playerData;
    });

    // Sort based on requested field
    players.sort((a, b) => {
      let aVal, bVal;
      
      if (sortField === 'total_playtime') {
        // Sum playtime across both games for sorting
        aVal = (a.csgo.total_playtime || 0) + (a.counterstrike2.total_playtime || 0);
        bVal = (b.csgo.total_playtime || 0) + (b.counterstrike2.total_playtime || 0);
      } else if (sortField === 'last_seen') {
        // Get most recent last_seen across both games
        const aDate = [a.csgo.last_seen, a.counterstrike2.last_seen].filter(d => d).sort().reverse()[0] || '';
        const bDate = [b.csgo.last_seen, b.counterstrike2.last_seen].filter(d => d).sort().reverse()[0] || '';
        aVal = aDate;
        bVal = bDate;
      } else {
        aVal = a[sortField];
        bVal = b[sortField];
      }
      
      if (sortOrder === 'DESC') {
        return aVal > bVal ? -1 : aVal < bVal ? 1 : 0;
      } else {
        return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      }
    });

    // Apply pagination
    const total = players.length;
    players = players.slice(offset, offset + validLimit);

    res.json({
      data: players,
      pagination: {
        page: parseInt(page, 10) || 1,
        limit: validLimit,
        total: total,
        totalPages: Math.ceil(total / validLimit),
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
 *         description: Filter stats to specific game type (returns only that game's data)
 *         example: csgo
 *     responses:
 *       200:
 *         description: Successful response with player details grouped by game type
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

    // Structure response by game type
    const response = {
      steamid,
      csgo: {},
      counterstrike2: {},
    };

    // Populate game-specific stats and sessions
    for (const stat of stats) {
      const gameKey = stat.game;
      
      if (gameKey === 'csgo' || gameKey === 'counterstrike2') {
        // Get sessions for this game
        const gameSessions = rows
          .filter(row => row.game === gameKey)
          .map(session => {
            const { latest_ip, name, ...sessionWithoutIp } = session;
            return sessionWithoutIp;
          });

        response[gameKey] = {
          total_playtime: stat.total_playtime || 0,
          last_seen: stat.last_seen,
          sessions: gameSessions,
        };
      }
    }

    res.json(response);
  } catch (e) {
    logger.error(`Player fetch error for ${req.params.steamid}: ${e.message}`);
    res.status(500).json({ error: "Player fetch error" });
  }
});

module.exports = router;
