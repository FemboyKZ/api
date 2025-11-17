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
const {
  cacheMiddleware,
  kzKeyGenerator,
} = require("../utils/cacheMiddleware");

/**
 * @swagger
 * /kzglobal/players:
 *   get:
 *     summary: Get KZ players
 *     description: Returns a paginated list of KZ players with statistics
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
 *         name: name
 *         schema:
 *           type: string
 *         description: Filter by player name (partial match)
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           enum: [records, points, name]
 *           default: records
 *         description: Sort field
 *       - in: query
 *         name: order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *         description: Sort order
 *       - in: query
 *         name: banned
 *         schema:
 *           type: boolean
 *         description: Filter by ban status
 *     responses:
 *       200:
 *         description: Successful response with players list
 *       500:
 *         description: Server error
 */
router.get("/", cacheMiddleware(60, kzKeyGenerator), async (req, res) => {
  try {
    const { page, limit, name, sort, order, banned } = req.query;
    const { limit: validLimit, offset } = validatePagination(page, limit, 100);

    const validSortFields = ["records", "points", "name"];
    const sortField = validSortFields.includes(sort) ? sort : "records";
    const sortOrder = order === "asc" ? "ASC" : "DESC";

    // Build query with aggregated stats
    let query = `
      SELECT 
        p.id,
        p.steamid64,
        p.steam_id,
        p.player_name,
        p.is_banned,
        COUNT(DISTINCT r.id) as records,
        SUM(r.points) as points,
        COUNT(DISTINCT r.map_id) as maps_completed,
        MIN(r.time) as best_time,
        MAX(r.created_on) as last_record,
        p.created_at,
        p.updated_at
      FROM kz_players p
      LEFT JOIN kz_records r ON p.steamid64 = r.player_id
      WHERE 1=1
    `;
    const params = [];

    if (name) {
      query += " AND p.player_name LIKE ?";
      params.push(`%${sanitizeString(name, 100)}%`);
    }

    if (banned !== undefined) {
      const isBanned = banned === "true" || banned === true;
      query += " AND p.is_banned = ?";
      params.push(isBanned);
    }

    query += " GROUP BY p.id, p.steamid64, p.steam_id, p.player_name, p.is_banned, p.created_at, p.updated_at";

    // Get total count
    const countQuery = `SELECT COUNT(DISTINCT p.id) as total FROM kz_players p WHERE 1=1${
      name ? " AND p.player_name LIKE ?" : ""
    }${banned !== undefined ? " AND p.is_banned = ?" : ""}`;
    const countParams = [];
    if (name) countParams.push(`%${sanitizeString(name, 100)}%`);
    if (banned !== undefined)
      countParams.push(banned === "true" || banned === true);

    const pool = getKzPool();
    const [countResult] = await pool.query(countQuery, countParams);
    const total = countResult[0].total;

    // Map sort field to actual column
    const sortColumn =
      sortField === "name"
        ? "p.player_name"
        : sortField === "points"
          ? "points"
          : "records";

    query += ` ORDER BY ${sortColumn} ${sortOrder}`;
    query += ` LIMIT ? OFFSET ?`;
    params.push(validLimit, offset);

    const [players] = await pool.query(query, params);

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
    logger.error(`Failed to fetch KZ players: ${e.message}`);
    res.status(500).json({ error: "Failed to fetch KZ players" });
  }
});

/**
 * @swagger
 * /kzglobal/players/top/records:
 *   get:
 *     summary: Get top players by record count
 *     description: Returns leaderboard of players ranked by number of records
 *     tags: [KZ Global]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 100
 *           maximum: 1000
 *       - in: query
 *         name: mode
 *         schema:
 *           type: string
 *         description: Filter by mode
 *     responses:
 *       200:
 *         description: Top players leaderboard
 *       500:
 *         description: Server error
 */
router.get(
  "/top/records",
  cacheMiddleware(300, kzKeyGenerator),
  async (req, res) => {
    try {
      const { limit = 100, mode } = req.query;
      const validLimit = Math.min(parseInt(limit, 10) || 100, 1000);

      let query = `
        SELECT 
          p.steamid64,
          p.player_name,
          p.is_banned,
          COUNT(DISTINCT r.id) as total_records,
          SUM(r.points) as total_points,
          COUNT(DISTINCT r.map_id) as maps_completed,
          MAX(r.created_on) as last_record
        FROM kz_players p
        INNER JOIN kz_records r ON p.steamid64 = r.player_id
        WHERE p.is_banned = FALSE
      `;
      const params = [];

      if (mode) {
        query += " AND r.mode = ?";
        params.push(sanitizeString(mode, 32));
      }

      query += `
        GROUP BY p.steamid64, p.player_name, p.is_banned
        ORDER BY total_records DESC
        LIMIT ?
      `;
      params.push(validLimit);

      const pool = getKzPool();
      const [players] = await pool.query(query, params);

      const rankedPlayers = players.map((player, index) => ({
        rank: index + 1,
        ...player,
      }));

      res.json({
        data: rankedPlayers,
        total: rankedPlayers.length,
      });
    } catch (e) {
      logger.error(`Failed to fetch top players by records: ${e.message}`);
      res.status(500).json({ error: "Failed to fetch top players" });
    }
  },
);

/**
 * @swagger
 * /kzglobal/players/{steamid}:
 *   get:
 *     summary: Get player details
 *     description: Returns detailed statistics for a specific player
 *     tags: [KZ Global]
 *     parameters:
 *       - in: path
 *         name: steamid
 *         required: true
 *         schema:
 *           type: string
 *         description: Player Steam ID (SteamID64, SteamID3, or SteamID2 format)
 *     responses:
 *       200:
 *         description: Successful response with player details
 *       400:
 *         description: Invalid Steam ID
 *       404:
 *         description: Player not found
 *       500:
 *         description: Server error
 */
router.get("/:steamid", cacheMiddleware(60, kzKeyGenerator), async (req, res) => {
  try {
    const { steamid } = req.params;

    if (!isValidSteamID(steamid)) {
      return res.status(400).json({ error: "Invalid SteamID format" });
    }

    const steamid64 = convertToSteamID64(steamid);
    if (!steamid64) {
      return res.status(400).json({ error: "Failed to convert SteamID" });
    }

    const pool = getKzPool();

    // Get player info
    const [players] = await pool.query(
      "SELECT * FROM kz_players WHERE steamid64 = ?",
      [steamid64],
    );

    if (players.length === 0) {
      return res.status(404).json({ error: "Player not found" });
    }

    const player = players[0];

    // Get record statistics
    const [stats] = await pool.query(
      `
      SELECT 
        COUNT(DISTINCT r.id) as total_records,
        COUNT(DISTINCT r.map_id) as maps_completed,
        SUM(r.points) as total_points,
        AVG(r.time) as avg_time,
        MIN(r.time) as best_time,
        MAX(r.time) as worst_time,
        SUM(CASE WHEN r.teleports = 0 THEN 1 ELSE 0 END) as pro_records,
        SUM(CASE WHEN r.teleports > 0 THEN 1 ELSE 0 END) as tp_records,
        MIN(r.created_on) as first_record,
        MAX(r.created_on) as last_record
      FROM kz_records r
      WHERE r.player_id = ?
    `,
      [steamid64],
    );

    // Get world records count (best time per map/mode/stage combination)
    const [wrStats] = await pool.query(
      `
      SELECT COUNT(*) as world_records
      FROM (
        SELECT r.map_id, r.mode, r.stage, MIN(r.time) as best_time
        FROM kz_records r
        GROUP BY r.map_id, r.mode, r.stage
        HAVING MIN(r.time) IN (
          SELECT r2.time
          FROM kz_records r2
          WHERE r2.player_id = ?
            AND r2.map_id = r.map_id
            AND r2.mode = r.mode
            AND r2.stage = r.stage
        )
      ) wr
    `,
      [steamid64],
    );

    // Get mode breakdown
    const [modeStats] = await pool.query(
      `
      SELECT 
        mode,
        COUNT(*) as records,
        SUM(points) as points,
        AVG(time) as avg_time,
        MIN(time) as best_time
      FROM kz_records
      WHERE player_id = ?
      GROUP BY mode
    `,
      [steamid64],
    );

    // Get recent records
    const [recentRecords] = await pool.query(
      `
      SELECT 
        r.id,
        r.original_id,
        m.map_name,
        r.mode,
        r.stage,
        r.time,
        r.teleports,
        r.points,
        s.server_name,
        r.created_on
      FROM kz_records r
      LEFT JOIN kz_maps m ON r.map_id = m.id
      LEFT JOIN kz_servers s ON r.server_id = s.id
      WHERE r.player_id = ?
      ORDER BY r.created_on DESC
      LIMIT 10
    `,
      [steamid64],
    );

    res.json({
      player: {
        steamid64: player.steamid64,
        steam_id: player.steam_id,
        player_name: player.player_name,
        is_banned: player.is_banned,
        created_at: player.created_at,
        updated_at: player.updated_at,
      },
      statistics: {
        ...stats[0],
        world_records: wrStats[0].world_records,
        mode_breakdown: modeStats,
      },
      recent_records: recentRecords,
    });
  } catch (e) {
    logger.error(`Failed to fetch KZ player ${req.params.steamid}: ${e.message}`);
    res.status(500).json({ error: "Failed to fetch KZ player" });
  }
});

/**
 * @swagger
 * /kzglobal/players/{steamid}/records:
 *   get:
 *     summary: Get player records
 *     description: Returns all records for a specific player
 *     tags: [KZ Global]
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
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *           maximum: 100
 *       - in: query
 *         name: map
 *         schema:
 *           type: string
 *         description: Filter by map name
 *       - in: query
 *         name: mode
 *         schema:
 *           type: string
 *         description: Filter by mode
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           enum: [time, created_on, points]
 *           default: created_on
 *     responses:
 *       200:
 *         description: Player records list
 *       400:
 *         description: Invalid Steam ID
 *       500:
 *         description: Server error
 */
router.get(
  "/:steamid/records",
  cacheMiddleware(30, kzKeyGenerator),
  async (req, res) => {
    try {
      const { steamid } = req.params;
      const { page, limit, map, mode, sort = "created_on", order = "desc" } = req.query;

      if (!isValidSteamID(steamid)) {
        return res.status(400).json({ error: "Invalid SteamID format" });
      }

      const steamid64 = convertToSteamID64(steamid);
      const { limit: validLimit, offset } = validatePagination(page, limit, 100);

      const validSortFields = ["time", "created_on", "points"];
      const sortField = validSortFields.includes(sort) ? sort : "created_on";
      const sortOrder = order === "asc" ? "ASC" : "DESC";

      let query = `
        SELECT 
          r.id,
          r.original_id,
          m.map_name,
          r.mode,
          r.stage,
          r.time,
          r.teleports,
          r.points,
          r.tickrate,
          s.server_name,
          r.created_on
        FROM kz_records r
        LEFT JOIN kz_maps m ON r.map_id = m.id
        LEFT JOIN kz_servers s ON r.server_id = s.id
        WHERE r.player_id = ?
      `;
      const params = [steamid64];

      if (map) {
        query += " AND m.map_name LIKE ?";
        params.push(`%${sanitizeString(map, 255)}%`);
      }

      if (mode) {
        query += " AND r.mode = ?";
        params.push(sanitizeString(mode, 32));
      }

      // Count total
      const countQuery = query.replace(
        /SELECT.*FROM/s,
        "SELECT COUNT(*) as total FROM",
      );
      const pool = getKzPool();
      const [countResult] = await pool.query(countQuery, params);
      const total = countResult[0].total;

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
      logger.error(
        `Failed to fetch records for player ${req.params.steamid}: ${e.message}`,
      );
      res.status(500).json({ error: "Failed to fetch player records" });
    }
  },
);

module.exports = router;
