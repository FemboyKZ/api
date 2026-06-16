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
const { getPlayerSummary } = require("../services/steamQuery");

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
 *             playtime_modes:
 *               type: object
 *               nullable: true
 *               description: Per-gamemode playtime in seconds (gokz keys kz_vanilla/kz_simple/kz_timer). Null if the player has no row for this game.
 *               example: { "kz_vanilla": 1200, "kz_simple": 8400, "kz_timer": 2850 }
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
 *             playtime_modes:
 *               type: object
 *               nullable: true
 *               description: Per-gamemode playtime in seconds (cs2kz keys cs2kz_vnl/cs2kz_ckz). Null if the player has no row for this game.
 *               example: { "cs2kz_vnl": null, "cs2kz_ckz": null }
 *     PlayerDetails:
 *       type: object
 *       properties:
 *         steamid:
 *           type: string
 *         name:
 *           type: string
 *           description: Player name (from Steam or latest session)
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
 *             playtime_modes:
 *               type: object
 *               nullable: true
 *               description: Per-gamemode playtime in seconds. gokz keys kz_vanilla/kz_simple/kz_timer; cs2kz keys cs2kz_vnl/cs2kz_ckz.
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
 *             playtime_modes:
 *               type: object
 *               nullable: true
 *               description: Per-gamemode playtime in seconds. gokz keys kz_vanilla/kz_simple/kz_timer; cs2kz keys cs2kz_vnl/cs2kz_ckz.
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
        p.steamid,
        MAX(p.latest_name) as name,
        MAX(p.avatar) as avatar,
        JSON_OBJECT(
          'total_playtime', SUM(CASE WHEN p.game = 'csgo' THEN p.playtime ELSE 0 END),
          'last_seen', MAX(CASE WHEN p.game = 'csgo' THEN p.last_seen END)
        ) as csgo,
        JSON_OBJECT(
          'total_playtime', SUM(CASE WHEN p.game = 'counterstrike2' THEN p.playtime ELSE 0 END),
          'last_seen', MAX(CASE WHEN p.game = 'counterstrike2' THEN p.last_seen END)
        ) as counterstrike2,
        MAX(CASE WHEN p.game = 'csgo' THEN CAST(p.playtime_modes AS CHAR) END) as _csgo_modes,
        MAX(CASE WHEN p.game = 'counterstrike2' THEN CAST(p.playtime_modes AS CHAR) END) as _cs2_modes,
        SUM(p.playtime) as _total_playtime,
        MAX(p.last_seen) as _last_seen,
        MAX(pm.discord_id) as discord_id,
        MAX(pm.permissions) as _permissions,
        MAX(pm.whitelisted) as whitelisted
      FROM players p
      LEFT JOIN player_meta pm ON p.steamid = pm.steamid
      WHERE 1=1
    `;
    const params = [];

    if (game) {
      query += " AND p.game = ?";
      params.push(sanitizeString(game, 50));
    }

    if (name) {
      query += " AND p.latest_name LIKE ?";
      params.push(`%${sanitizeString(name, 100)}%`);
    }

    query += " GROUP BY p.steamid";

    // Add SQL-based sorting instead of JavaScript sorting
    if (sortField === "total_playtime") {
      query += ` ORDER BY _total_playtime ${sortOrder}`;
    } else if (sortField === "last_seen") {
      query += ` ORDER BY _last_seen ${sortOrder}`;
    } else {
      query += ` ORDER BY p.steamid ${sortOrder}`;
    }

    // Add pagination in SQL
    query += " LIMIT ? OFFSET ?";
    params.push(validLimit, offset);

    const [rawPlayers] = await pool.query(query, params);

    // Parse JSON fields from SQL (MariaDB/MySQL returns JSON as strings or buffers)
    const players = rawPlayers.map((row) => {
      const {
        _total_playtime,
        _last_seen,
        _permissions,
        whitelisted,
        _csgo_modes,
        _cs2_modes,
        ...player
      } = row;

      // Helper to parse JSON from various formats
      const parseJson = (value) => {
        if (!value) return {};
        if (typeof value === "string") return JSON.parse(value);
        if (Buffer.isBuffer(value)) return JSON.parse(value.toString("utf8"));
        if (typeof value === "object") return value;
        return {};
      };

      // Per-mode playtime is null when the player has no row for that game.
      const parseModes = (value) => {
        if (!value) return null;
        if (typeof value === "string") return JSON.parse(value);
        if (Buffer.isBuffer(value)) return JSON.parse(value.toString("utf8"));
        if (typeof value === "object") return value;
        return null;
      };

      player.csgo = parseJson(row.csgo);
      player.counterstrike2 = parseJson(row.counterstrike2);
      // Annotate only a game the player has actually played (leave {} otherwise).
      if (Object.keys(player.csgo).length > 0) {
        player.csgo.playtime_modes = parseModes(_csgo_modes);
      }
      if (Object.keys(player.counterstrike2).length > 0) {
        player.counterstrike2.playtime_modes = parseModes(_cs2_modes);
      }
      player.discord_id = player.discord_id || null;
      player.permissions = _permissions ? parseJson(_permissions) : null;
      player.whitelisted = Boolean(whitelisted);

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
 *         description: Successful response with player details grouped by game type. If player is not in our database but exists on Steam, their profile will be fetched from Steam API and saved.
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
 *         description: Player not found (invalid Steam ID or Steam API unavailable)
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

    // If player not found in database, try to fetch from Steam API
    if (rows.length === 0) {
      // Try to get player info from Steam and save to database
      const steamPlayer = await getPlayerSummary(steamid64, true);

      if (!steamPlayer) {
        return res.status(404).json({ error: "Player not found" });
      }

      // Return a player with no playtime data
      const response = {
        steamid: steamid64,
        name: steamPlayer.name,
        avatar: steamPlayer.avatar,
        discord_id: null,
        permissions: null,
        csgo: {
          total_playtime: 0,
          playtime_modes: null,
          last_seen: null,
          sessions: [],
        },
        counterstrike2: {
          total_playtime: 0,
          playtime_modes: null,
          last_seen: null,
          sessions: [],
        },
      };

      return res.json({
        total: 1,
        data: [response],
      });
    }

    let statsQuery =
      "SELECT game, SUM(playtime) as total_playtime, MAX(CAST(playtime_modes AS CHAR)) as playtime_modes, MAX(last_seen) as last_seen FROM players WHERE steamid = ?";
    const statsParams = [steamid64];

    if (game) {
      statsQuery += " AND game = ?";
      statsParams.push(sanitizeString(game, 50));
    }

    statsQuery += " GROUP BY game";

    const [stats] = await pool.query(statsQuery, statsParams);

    // Fetch discord_id, permissions, and whitelisted from player_meta
    const [[meta]] = await pool.query(
      "SELECT discord_id, permissions, whitelisted FROM player_meta WHERE steamid = ?",
      [steamid64],
    );

    const parseMetaJson = (value) => {
      if (!value) return null;
      if (typeof value === "string") return JSON.parse(value);
      if (Buffer.isBuffer(value)) return JSON.parse(value.toString("utf8"));
      if (typeof value === "object") return value;
      return null;
    };

    // Structure response by game type
    const response = {
      steamid: steamid64, // Always return SteamID64 format
      name: null,
      avatar: null,
      discord_id: meta?.discord_id || null,
      permissions: parseMetaJson(meta?.permissions),
      whitelisted: Boolean(meta?.whitelisted),
      csgo: {},
      counterstrike2: {},
    };

    // Get name and avatar from any row (they should all be the same for a steamid)
    if (rows.length > 0) {
      response.name = rows[0].name;
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
            const { latest_ip, name, playtime_modes, ...sessionWithoutIp } =
              session;
            return sessionWithoutIp;
          });

        response[gameKey] = {
          total_playtime: parseInt(stat.total_playtime, 10) || 0,
          playtime_modes: parseMetaJson(stat.playtime_modes),
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
