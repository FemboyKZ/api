const express = require("express");
const router = express.Router();
const pool = require("../db");
const {
  isValidSteamID,
  convertToSteamID64,
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
 *         avatar:
 *           type: string
 *           description: Avatar URL (32x32, append _medium.jpg or _full.jpg for larger sizes)
 *           example: "https://avatars.steamstatic.com/abc123.jpg"
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
 *         avatar:
 *           type: string
 *           description: Avatar URL (32x32, append _medium.jpg or _full.jpg for larger sizes)
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

    // Optimized: Use SQL aggregation with JSON functions for better performance
    let query = `
      SELECT 
        steamid,
        MAX(latest_name) as name,
        MAX(avatar) as avatar,
        MAX(CASE WHEN game = 'csgo' THEN 
          JSON_OBJECT(
            'total_playtime', SUM(playtime),
            'last_seen', MAX(last_seen)
          )
        END) as csgo,
        MAX(CASE WHEN game = 'counterstrike2' THEN 
          JSON_OBJECT(
            'total_playtime', SUM(playtime),
            'last_seen', MAX(last_seen)
          )
        END) as counterstrike2,
        SUM(playtime) as _total_playtime,
        MAX(last_seen) as _last_seen
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

    query += " GROUP BY steamid";

    // Add SQL-based sorting instead of JavaScript sorting
    if (sortField === "total_playtime") {
      query += ` ORDER BY _total_playtime ${sortOrder}`;
    } else if (sortField === "last_seen") {
      query += ` ORDER BY _last_seen ${sortOrder}`;
    } else {
      query += ` ORDER BY steamid ${sortOrder}`;
    }

    // Add pagination in SQL
    query += " LIMIT ? OFFSET ?";
    params.push(validLimit, offset);

    const [rawPlayers] = await pool.query(query, params);

    // Parse JSON fields from SQL (MariaDB returns JSON as strings)
    const players = rawPlayers.map((row) => {
      const { _total_playtime, _last_seen, ...player } = row;

      // Parse JSON objects or set to empty objects
      player.csgo = row.csgo
        ? typeof row.csgo === "string"
          ? JSON.parse(row.csgo)
          : row.csgo
        : {};
      player.counterstrike2 = row.counterstrike2
        ? typeof row.counterstrike2 === "string"
          ? JSON.parse(row.counterstrike2)
          : row.counterstrike2
        : {};

      return player;
    });

    // Get total count (separate query for accuracy)
    let countQuery =
      "SELECT COUNT(DISTINCT steamid) as total FROM players WHERE 1=1";
    const countParams = [];
    if (game) {
      countQuery += " AND game = ?";
      countParams.push(sanitizeString(game, 50));
    }
    if (name) {
      countQuery += " AND latest_name LIKE ?";
      countParams.push(`%${sanitizeString(name, 100)}%`);
    }
    const [[{ total }]] = await pool.query(countQuery, countParams);

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
 * /players/online:
 *   get:
 *     summary: Get all currently online players
 *     description: Returns a list of all players currently connected to any server
 *     tags: [Players]
 *     parameters:
 *       - in: query
 *         name: game
 *         schema:
 *           type: string
 *         description: Filter by game type (csgo, counterstrike2)
 *         example: counterstrike2
 *       - in: query
 *         name: server
 *         schema:
 *           type: string
 *         description: Filter by server (format ip:port)
 *         example: "185.107.96.59:27015"
 *     responses:
 *       200:
 *         description: List of currently online players
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 total:
 *                   type: integer
 *                   description: Total number of online players
 *                   example: 24
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       userid:
 *                         type: integer
 *                         description: User ID on the server
 *                         example: 12
 *                       name:
 *                         type: string
 *                         description: Player name
 *                         example: "PlayerName"
 *                       steamid:
 *                         type: string
 *                         description: Player Steam ID
 *                         example: "76561198000000000"
 *                       time:
 *                         type: string
 *                         description: Time connected to server
 *                         example: "12:34"
 *                       ping:
 *                         type: integer
 *                         description: Player ping
 *                         example: 45
 *                       loss:
 *                         type: integer
 *                         description: Packet loss
 *                         example: 0
 *                       state:
 *                         type: string
 *                         description: Player state
 *                         example: "active"
 *                       bot:
 *                         type: boolean
 *                         description: Whether player is a bot
 *                         example: false
 *                       server:
 *                         type: string
 *                         description: Server the player is on
 *                         example: "185.107.96.59:27015"
 *                       server_name:
 *                         type: string
 *                         description: Server hostname
 *                         example: "FemboyKZ | EU"
 *                       game:
 *                         type: string
 *                         description: Game type
 *                         example: "counterstrike2"
 *                       map:
 *                         type: string
 *                         description: Current map on the server
 *                         example: "kz_synergy_x"
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Failed to fetch online players"
 */
// Cache for 10 seconds (shorter since it's real-time data)
router.get(
  "/online",
  cacheMiddleware(10, playersKeyGenerator),
  async (req, res) => {
    try {
      const { game, server } = req.query;

      // Build query to get online servers with players
      let query =
        "SELECT ip, port, game, hostname, map, players_list FROM servers WHERE status = 1";
      const params = [];

      if (game) {
        query += " AND game = ?";
        params.push(sanitizeString(game, 50));
      }

      if (server) {
        // Parse server format "ip:port"
        const [ip, port] = server.split(":");
        if (ip && port) {
          query += " AND ip = ? AND port = ?";
          params.push(ip);
          params.push(parseInt(port, 10));
        }
      }

      const [servers] = await pool.query(query, params);

      // Collect all online players from all servers
      const onlinePlayers = [];
      let serversWithPlayers = 0;

      for (const server of servers) {
        let playersList = [];

        // Parse players_list JSON column
        if (server.players_list) {
          try {
            playersList =
              typeof server.players_list === "string"
                ? JSON.parse(server.players_list)
                : server.players_list;
          } catch (e) {
            logger.error(
              `Failed to parse players_list for ${server.ip}:${server.port}`,
              { error: e.message },
            );
            continue;
          }
        }

        // Add server info to each player
        if (playersList.length > 0) {
          serversWithPlayers++;

          for (const player of playersList) {
            // Skip bots if they don't have steamid
            if (!player.steamid && player.bot) {
              continue;
            }

            onlinePlayers.push({
              userid: player.userid,
              name: player.name,
              steamid: player.steamid,
              time: player.time,
              ping: player.ping,
              loss: player.loss || 0,
              state: player.state,
              bot: player.bot || false,
              server: `${server.ip}:${server.port}`,
              server_name: server.hostname,
              game: server.game,
              map: server.map,
            });
          }
        }
      }

      // Sort by name for consistent output
      onlinePlayers.sort((a, b) => {
        if (!a.name) return 1;
        if (!b.name) return -1;
        return a.name.localeCompare(b.name);
      });

      res.json({
        total: onlinePlayers.length,
        data: onlinePlayers,
      });
    } catch (e) {
      logger.error(`Failed to fetch online players: ${e.message}`);
      res.status(500).json({ error: "Failed to fetch online players" });
    }
  },
);

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
 *               type: object
 *               properties:
 *                 total:
 *                   type: integer
 *                   description: Total number of players found (always 1)
 *                   example: 1
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/PlayerDetails'
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

    // Convert any SteamID format to SteamID64 for database lookup
    const steamid64 = convertToSteamID64(steamid);
    if (!steamid64) {
      return res.status(400).json({ error: "Failed to convert SteamID" });
    }

    let query = "SELECT * FROM players WHERE steamid = ?";
    const params = [steamid64];

    if (game) {
      query += " AND game = ?";
      params.push(sanitizeString(game, 50));
    }

    query += " ORDER BY last_seen DESC";

    const [rows] = await pool.query(query, params);
    if (rows.length === 0) {
      return res.status(404).json({ error: "Player not found" });
    }

    let statsQuery =
      "SELECT game, SUM(playtime) as total_playtime, MAX(last_seen) as last_seen FROM players WHERE steamid = ?";
    const statsParams = [steamid64];

    if (game) {
      statsQuery += " AND game = ?";
      statsParams.push(sanitizeString(game, 50));
    }

    statsQuery += " GROUP BY game";

    const [stats] = await pool.query(statsQuery, statsParams);

    // Structure response by game type
    const response = {
      steamid: steamid64, // Always return SteamID64 format
      avatar: null,
      csgo: {},
      counterstrike2: {},
    };

    // Get avatar from any row (they should all be the same for a steamid)
    if (rows.length > 0) {
      response.avatar = rows[0].avatar;
    }

    // Populate game-specific stats and sessions
    for (const stat of stats) {
      const gameKey = stat.game;

      if (gameKey === "csgo" || gameKey === "counterstrike2") {
        // Get sessions for this game
        const gameSessions = rows
          .filter((row) => row.game === gameKey)
          .map((session) => {
            const { latest_ip, name, ...sessionWithoutIp } = session;
            return sessionWithoutIp;
          });

        response[gameKey] = {
          total_playtime: parseInt(stat.total_playtime, 10) || 0,
          last_seen: stat.last_seen,
          sessions: gameSessions,
        };
      }
    }

    res.json({
      total: 1,
      data: [response],
    });
  } catch (e) {
    logger.error(`Player fetch error for ${req.params.steamid}: ${e.message}`);
    res.status(500).json({ error: "Player fetch error" });
  }
});

module.exports = router;
