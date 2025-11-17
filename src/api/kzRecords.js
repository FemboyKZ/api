const express = require("express");
const router = express.Router();
const { getKzPool } = require("../db/kzRecords");
const {
  validatePagination,
  sanitizeString,
  isValidSteamID,
  convertToSteamID64,
} = require("../utils/validators");
const logger = require("../utils/logger");
const { cacheMiddleware, kzKeyGenerator } = require("../utils/cacheMiddleware");

/**
 * @swagger
 * /kzglobal/records:
 *   get:
 *     summary: Get KZ records
 *     description: Returns a paginated list of KZ records with filtering and sorting
 *     tags: [KZ Global]
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
 *         name: map
 *         schema:
 *           type: string
 *         description: Filter by map name (partial match)
 *       - in: query
 *         name: map_id
 *         schema:
 *           type: integer
 *         description: Filter by map (ID)
 *       - in: query
 *         name: player
 *         schema:
 *           type: string
 *         description: Filter by player steamid64 or name (partial match)
 *       - in: query
 *         name: mode
 *         schema:
 *           type: string
 *         description: Filter by mode (kz_timer, kz_simple, kz_vanilla)
 *       - in: query
 *         name: stage
 *         schema:
 *           type: integer
 *         description: Filter by stage (0 for map completion, 0< for bonuses)
 *       - in: query
 *         name: server
 *         schema:
 *           type: integer
 *         description: Filter by server ID
 *       - in: query
 *         name: teleports
 *         schema:
 *           type: string
 *           enum: [tp, true, pro, false]
 *         description: Filter by teleport usage (tp/true = >0, pro/false = 0)
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           enum: [time, created_on, points]
 *           default: created_on
 *         description: Sort field
 *       - in: query
 *         name: order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *         description: Sort order
 *       - in: query
 *         name: include_banned
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Include records from banned players
 *     responses:
 *       200:
 *         description: Successful response with records list
 *       500:
 *         description: Server error
 */
router.get("/", cacheMiddleware(30, kzKeyGenerator), async (req, res) => {
  try {
    const {
      page,
      limit,
      map,
      map_id,
      player,
      mode,
      stage,
      server,
      teleports,
      sort,
      order,
      include_banned,
    } = req.query;
    const { limit: validLimit, offset } = validatePagination(page, limit, 100);

    const validSortFields = ["time", "created_on", "points"];
    const sortField = validSortFields.includes(sort) ? sort : "created_on";
    const sortOrder = order === "asc" ? "ASC" : "DESC";

    let query = `
      SELECT 
        r.id, 
        r.original_id, 
        r.player_id,
        p.player_name,
        p.steamid64,
        p.is_banned,
        r.map_id,
        m.map_name,
        r.server_id,
        s.server_name,
        r.mode,
        r.stage,
        r.time,
        r.teleports,
        r.points,
        r.tickrate,
        r.record_filter_id,
        r.replay_id,
        r.created_on,
        r.updated_on
      FROM kz_records r
      LEFT JOIN kz_players p ON r.player_id = p.steamid64
      LEFT JOIN kz_maps m ON r.map_id = m.id
      LEFT JOIN kz_servers s ON r.server_id = s.id
      WHERE 1=1
    `;
    const params = [];

    // Filter out banned players by default
    if (include_banned !== "true" && include_banned !== true) {
      query += " AND (p.is_banned IS NULL OR p.is_banned = FALSE)";
    }

    // Apply filters
    if (map) {
      query += " AND m.map_name LIKE ?";
      params.push(`%${sanitizeString(map, 255)}%`);
    }

    if (map_id) {
      query += " AND r.map_id = ?";
      params.push(parseInt(map_id, 10));
    }

    if (player) {
      // Check if it's a SteamID or name
      if (isValidSteamID(player)) {
        const steamid64 = convertToSteamID64(player);
        query += " AND p.steamid64 = ?";
        params.push(steamid64);
      } else {
        query += " AND p.player_name LIKE ?";
        params.push(`%${sanitizeString(player, 100)}%`);
      }
    }

    if (mode) {
      query += " AND r.mode = ?";
      params.push(sanitizeString(mode, 32));
    }

    if (stage !== undefined) {
      query += " AND r.stage = ?";
      params.push(parseInt(stage, 10));
    }

    if (server) {
      query += " AND s.server_id = ?";
      params.push(parseInt(server, 10));
    }

    if (teleports) {
      if (teleports === "pro" || teleports === "false") {
        query += " AND r.teleports = 0";
      } else if (teleports === "tp" || teleports === "true") {
        query += " AND r.teleports > 0";
      }
    }

    // Get total count
    const countQuery = query.replace(
      /SELECT.*FROM/s,
      "SELECT COUNT(DISTINCT r.id) as total FROM",
    );
    const pool = getKzPool();
    const [countResult] = await pool.query(countQuery, params);
    const total = countResult[0].total;

    // Add sorting and pagination
    query += ` ORDER BY r.${sortField} ${sortOrder}`;
    query += ` LIMIT ? OFFSET ?`;
    params.push(validLimit, offset);

    const [records] = await pool.query(query, params);

    res.json({
      data: records,
      pagination: {
        page: parseInt(page, 10) || 1,
        limit: validLimit,
        total: total,
        totalPages: Math.ceil(total / validLimit),
      },
    });
  } catch (e) {
    logger.error(`Failed to fetch KZ records: ${e.message}`);
    res.status(500).json({ error: "Failed to fetch KZ records" });
  }
});

/**
 * @swagger
 * /kzglobal/records/leaderboard/{mapname}:
 *   get:
 *     summary: Get map leaderboard
 *     description: Returns the leaderboard for a specific map with best times
 *     tags: [KZ Global]
 *     parameters:
 *       - in: path
 *         name: mapname
 *         required: true
 *         schema:
 *           type: string
 *         description: Map name
 *       - in: query
 *         name: mode
 *         schema:
 *           type: string
 *           default: kz_timer
 *         description: Mode filter
 *       - in: query
 *         name: stage
 *         schema:
 *           type: integer
 *           default: 0
 *         description: Stage (0 for map completion)
 *       - in: query
 *         name: teleports
 *         schema:
 *           type: string
 *           enum: [tp, pro]
 *           default: pro
 *         description: Teleport filter (pro = 0 teleports, tp = >0)
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 100
 *           maximum: 1000
 *         description: Number of top records to return
 *       - in: query
 *         name: include_banned
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Include records from banned players
 *     responses:
 *       200:
 *         description: Leaderboard with best times
 *       404:
 *         description: Map not found
 *       500:
 *         description: Server error
 */
router.get(
  "/leaderboard/:mapname",
  cacheMiddleware(600, kzKeyGenerator), // 10 min - leaderboards change slowly
  async (req, res) => {
    try {
      const { mapname } = req.params;
      const {
        mode = "kz_timer",
        stage = 0,
        teleports = "pro",
        limit = 100,
        include_banned,
      } = req.query;

      const validLimit = Math.min(parseInt(limit, 10) || 100, 1000);
      const stageNum = parseInt(stage, 10) || 0;

      const pool = getKzPool();

      // First check if map exists
      const [mapCheck] = await pool.query(
        "SELECT id FROM kz_maps WHERE map_name = ?",
        [sanitizeString(mapname, 255)],
      );

      if (mapCheck.length === 0) {
        return res.status(404).json({ error: "Map not found" });
      }

      // Build leaderboard query with best time per player
      let query = `
        SELECT 
          r.id,
          r.original_id,
          p.player_name,
          p.steamid64,
          p.is_banned,
          r.time,
          r.teleports,
          r.points,
          r.tickrate,
          r.server_id,
          s.server_name,
          r.created_on,
          ROW_NUMBER() OVER (ORDER BY r.time ASC) as rank
        FROM kz_records r
        INNER JOIN (
          SELECT r2.player_id, MIN(r2.time) as best_time
          FROM kz_records r2
          INNER JOIN kz_maps m2 ON r2.map_id = m2.id
          LEFT JOIN kz_players p2 ON r2.player_id = p2.steamid64
          WHERE m2.map_name = ?
            AND r2.mode = ?
            AND r2.stage = ?
      `;

      const params = [
        sanitizeString(mapname, 255),
        sanitizeString(mode, 32),
        stageNum,
      ];

      // Filter banned players in subquery
      if (include_banned !== "true" && include_banned !== true) {
        query += " AND (p2.is_banned IS NULL OR p2.is_banned = FALSE)";
      }

      if (teleports === "pro") {
        query += " AND r2.teleports = 0";
      } else if (teleports === "tp") {
        query += " AND r2.teleports > 0";
      }

      query += `
          GROUP BY r2.player_id
        ) best ON r.player_id = best.player_id AND r.time = best.best_time
        LEFT JOIN kz_players p ON r.player_id = p.steamid64
        LEFT JOIN kz_maps m ON r.map_id = m.id
        LEFT JOIN kz_servers s ON r.server_id = s.id
        WHERE m.map_name = ?
          AND r.mode = ?
          AND r.stage = ?
      `;

      params.push(
        sanitizeString(mapname, 255),
        sanitizeString(mode, 32),
        stageNum,
      );

      // Filter banned players in main query
      if (include_banned !== "true" && include_banned !== true) {
        query += " AND (p.is_banned IS NULL OR p.is_banned = FALSE)";
      }

      if (teleports === "pro") {
        query += " AND r.teleports = 0";
      } else if (teleports === "tp") {
        query += " AND r.teleports > 0";
      }

      query += `
        ORDER BY r.time ASC
        LIMIT ?
      `;
      params.push(validLimit);

      const [leaderboard] = await pool.query(query, params);

      res.json({
        map: mapname,
        mode,
        stage: stageNum,
        teleports,
        data: leaderboard,
        total: leaderboard.length,
      });
    } catch (e) {
      logger.error(
        `Failed to fetch leaderboard for ${req.params.mapname}: ${e.message}`,
      );
      res.status(500).json({ error: "Failed to fetch leaderboard" });
    }
  },
);

/**
 * @swagger
 * /kzglobal/records/recent:
 *   get:
 *     summary: Get recent records
 *     description: Returns the most recently set records
 *     tags: [KZ Global]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *           maximum: 100
 *         description: Number of records to return
 *       - in: query
 *         name: mode
 *         schema:
 *           type: string
 *         description: Filter by mode
 *       - in: query
 *         name: teleports
 *         schema:
 *           type: string
 *           enum: [tp, pro]
 *         description: Filter by teleport usage
 *       - in: query
 *         name: include_banned
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Include records from banned players
 *     responses:
 *       200:
 *         description: List of recent records
 *       500:
 *         description: Server error
 */
router.get("/recent", cacheMiddleware(15, kzKeyGenerator), async (req, res) => {
  try {
    const { limit = 50, mode, teleports, include_banned } = req.query;
    const validLimit = Math.min(parseInt(limit, 10) || 50, 100);

    let query = `
        SELECT 
          r.id,
          r.original_id,
          p.player_name,
          p.steamid64,
          p.is_banned,
          m.map_name,
          r.mode,
          r.stage,
          r.time,
          r.teleports,
          r.points,
          s.server_name,
          r.created_on
        FROM kz_records r
        LEFT JOIN kz_players p ON r.player_id = p.steamid64
        LEFT JOIN kz_maps m ON r.map_id = m.id
        LEFT JOIN kz_servers s ON r.server_id = s.id
        WHERE 1=1
      `;
    const params = [];

    // Filter out banned players by default
    if (include_banned !== "true" && include_banned !== true) {
      query += " AND (p.is_banned IS NULL OR p.is_banned = FALSE)";
    }

    if (mode) {
      query += " AND r.mode = ?";
      params.push(sanitizeString(mode, 32));
    }

    if (teleports === "pro") {
      query += " AND r.teleports = 0";
    } else if (teleports === "tp") {
      query += " AND r.teleports > 0";
    }

    query += " ORDER BY r.created_on DESC LIMIT ?";
    params.push(validLimit);

    const pool = getKzPool();
    const [records] = await pool.query(query, params);

    res.json({
      data: records,
      total: records.length,
    });
  } catch (e) {
    logger.error(`Failed to fetch recent KZ records: ${e.message}`);
    res.status(500).json({ error: "Failed to fetch recent records" });
  }
});

/**
 * @swagger
 * /kzglobal/records/worldrecords:
 *   get:
 *     summary: Get world records
 *     description: Returns current world records across all maps
 *     tags: [KZ Global]
 *     parameters:
 *       - in: query
 *         name: mode
 *         schema:
 *           type: string
 *           default: kz_timer
 *         description: Filter by mode
 *       - in: query
 *         name: stage
 *         schema:
 *           type: integer
 *           default: 0
 *         description: Filter by stage (0 for map completion)
 *       - in: query
 *         name: teleports
 *         schema:
 *           type: string
 *           enum: [tp, pro]
 *           default: pro
 *         description: Teleport filter
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 100
 *           maximum: 1000
 *         description: Number of world records to return
 *       - in: query
 *         name: include_banned
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Include records from banned players
 *     responses:
 *       200:
 *         description: List of world records
 *       500:
 *         description: Server error
 */
router.get(
  "/worldrecords",
  cacheMiddleware(3600, kzKeyGenerator), // 1 hour - world records change infrequently
  async (req, res) => {
    try {
      const {
        mode = "kz_timer",
        stage = 0,
        teleports = "pro",
        limit = 100,
        include_banned,
      } = req.query;
      const validLimit = Math.min(parseInt(limit, 10) || 100, 1000);
      const stageNum = parseInt(stage, 10) || 0;

      // Use a more efficient query with proper joins
      let query = `
        SELECT 
          m.map_name,
          p.player_name,
          p.steamid64,
          p.is_banned,
          r.time,
          r.teleports,
          r.points,
          r.mode,
          r.stage,
          s.server_name,
          r.created_on
        FROM kz_records r
        INNER JOIN (
          -- Get minimum time per map first (much faster)
          SELECT map_id, MIN(time) as best_time
          FROM kz_records r2
          WHERE r2.mode = ?
            AND r2.stage = ?
      `;

      const params = [sanitizeString(mode, 32), stageNum];

      if (teleports === "pro") {
        query += " AND r2.teleports = 0";
      } else if (teleports === "tp") {
        query += " AND r2.teleports > 0";
      }

      // Add banned filter in subquery if needed
      if (include_banned !== "true" && include_banned !== true) {
        query += `
          AND EXISTS (
            SELECT 1 FROM kz_players p2 
            WHERE p2.steamid64 = r2.player_id 
            AND (p2.is_banned IS NULL OR p2.is_banned = FALSE)
          )`;
      }

      query += `
          GROUP BY map_id
        ) best ON r.map_id = best.map_id AND r.time = best.best_time
        INNER JOIN kz_maps m ON r.map_id = m.id
        LEFT JOIN kz_players p ON r.player_id = p.steamid64
        LEFT JOIN kz_servers s ON r.server_id = s.id
        WHERE r.mode = ?
          AND r.stage = ?
      `;

      params.push(sanitizeString(mode, 32), stageNum);

      if (teleports === "pro") {
        query += " AND r.teleports = 0";
      } else if (teleports === "tp") {
        query += " AND r.teleports > 0";
      }

      if (include_banned !== "true" && include_banned !== true) {
        query += " AND (p.is_banned IS NULL OR p.is_banned = FALSE)";
      }

      query += `
        ORDER BY r.time ASC
        LIMIT ?
      `;
      params.push(validLimit);

      const pool = getKzPool();
      const [records] = await pool.query(query, params);

      res.json({
        mode,
        stage: stageNum,
        teleports,
        data: records,
        total: records.length,
      });
    } catch (e) {
      logger.error(`Failed to fetch world records: ${e.message}`);
      res.status(500).json({ error: "Failed to fetch world records" });
    }
  },
);

/**
 * @swagger
 * /kzglobal/records/{id}:
 *   get:
 *     summary: Get a specific KZ record
 *     description: Returns detailed information about a specific record
 *     tags: [KZ Global]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Record ID (original_id from GlobalKZ API)
 *     responses:
 *       200:
 *         description: Successful response with record details
 *       404:
 *         description: Record not found
 *       500:
 *         description: Server error
 */
router.get("/:id", cacheMiddleware(1800, kzKeyGenerator), async (req, res) => {
  // 30 min - records are immutable
  try {
    const { id } = req.params;
    const recordId = parseInt(id, 10);

    if (isNaN(recordId)) {
      return res.status(400).json({ error: "Invalid record ID" });
    }

    const pool = getKzPool();
    const [records] = await pool.query(
      `
      SELECT 
        r.id, 
        r.original_id, 
        r.player_id,
        p.player_name,
        p.steamid64,
        p.steam_id,
        r.map_id,
        m.map_name,
        m.difficulty,
        m.validated,
        m.workshop_url,
        r.server_id,
        s.server_name,
        s.ip,
        s.port,
        r.mode,
        r.stage,
        r.time,
        r.teleports,
        r.points,
        r.tickrate,
        r.record_filter_id,
        r.replay_id,
        r.updated_by,
        r.created_on,
        r.updated_on,
        r.inserted_at
      FROM kz_records r
      LEFT JOIN kz_players p ON r.player_id = p.steamid64
      LEFT JOIN kz_maps m ON r.map_id = m.id
      LEFT JOIN kz_servers s ON r.server_id = s.id
      WHERE r.original_id = ?
    `,
      [recordId],
    );

    if (records.length === 0) {
      return res.status(404).json({ error: "Record not found" });
    }

    res.json({
      data: records[0],
    });
  } catch (e) {
    logger.error(`Failed to fetch KZ record ${req.params.id}: ${e.message}`);
    res.status(500).json({ error: "Failed to fetch KZ record" });
  }
});

module.exports = router;
