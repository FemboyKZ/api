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
 * /kzglobal/bans:
 *   get:
 *     summary: Get KZ bans
 *     description: Returns a paginated list of player bans from GlobalKZ
 *     tags: [KZ Global]
 *     parameters:
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
 *         name: steamid
 *         schema:
 *           type: string
 *         description: Filter by player SteamID
 *       - in: query
 *         name: ban_type
 *         schema:
 *           type: string
 *         description: Filter by ban type
 *       - in: query
 *         name: server_id
 *         schema:
 *           type: integer
 *         description: Filter by server ID
 *       - in: query
 *         name: active
 *         schema:
 *           type: boolean
 *         description: Filter active bans only (not expired)
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           enum: [created_on, expires_on]
 *           default: created_on
 *       - in: query
 *         name: order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *     responses:
 *       200:
 *         description: Successful response with bans list
 *       500:
 *         description: Server error
 */
router.get("/", cacheMiddleware(60, kzKeyGenerator), async (req, res) => {
  try {
    const {
      page,
      limit,
      steamid,
      ban_type,
      server_id,
      active,
      sort = "created_on",
      order = "desc",
    } = req.query;
    const { limit: validLimit, offset } = validatePagination(page, limit, 100);

    const validSortFields = ["created_on", "expires_on"];
    const sortField = validSortFields.includes(sort) ? sort : "created_on";
    const sortOrder = order === "asc" ? "ASC" : "DESC";

    let query = `
      SELECT 
        b.id,
        b.ban_type,
        b.expires_on,
        b.steamid64,
        b.player_name,
        b.steam_id,
        b.notes,
        b.server_id,
        s.server_name,
        b.updated_by_id,
        b.created_on,
        b.updated_on,
        CASE 
          WHEN b.expires_on IS NULL THEN TRUE
          WHEN b.expires_on > NOW() THEN TRUE
          ELSE FALSE
        END as is_active
      FROM kz_bans b
      LEFT JOIN kz_servers s ON b.server_id = s.server_id
      WHERE 1=1
    `;
    const params = [];

    if (steamid) {
      if (isValidSteamID(steamid)) {
        const steamid64 = convertToSteamID64(steamid);
        query += " AND b.steamid64 = ?";
        params.push(steamid64);
      } else {
        return res.status(400).json({ error: "Invalid SteamID format" });
      }
    }

    if (ban_type) {
      query += " AND b.ban_type = ?";
      params.push(sanitizeString(ban_type, 50));
    }

    if (server_id) {
      query += " AND b.server_id = ?";
      params.push(parseInt(server_id, 10));
    }

    if (active !== undefined) {
      const isActive = active === "true" || active === true;
      if (isActive) {
        query += " AND (b.expires_on IS NULL OR b.expires_on > NOW())";
      } else {
        query += " AND b.expires_on IS NOT NULL AND b.expires_on <= NOW()";
      }
    }

    // Get total count
    const countQuery = query.replace(
      /SELECT.*FROM/s,
      "SELECT COUNT(*) as total FROM",
    );
    const pool = getKzPool();
    const [countResult] = await pool.query(countQuery, params);
    const total = countResult[0].total;

    query += ` ORDER BY b.${sortField} ${sortOrder}`;
    query += ` LIMIT ? OFFSET ?`;
    params.push(validLimit, offset);

    const [bans] = await pool.query(query, params);

    res.json({
      data: bans,
      pagination: {
        page: parseInt(page, 10) || 1,
        limit: validLimit,
        total: total,
        totalPages: Math.ceil(total / validLimit),
      },
    });
  } catch (e) {
    logger.error(`Failed to fetch KZ bans: ${e.message}`);
    res.status(500).json({ error: "Failed to fetch KZ bans" });
  }
});

/**
 * @swagger
 * /kzglobal/bans/active:
 *   get:
 *     summary: Get all active bans
 *     description: Returns currently active bans (not expired)
 *     tags: [KZ Global]
 *     parameters:
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
 *         name: ban_type
 *         schema:
 *           type: string
 *         description: Filter by ban type
 *     responses:
 *       200:
 *         description: Active bans list
 *       500:
 *         description: Server error
 */
router.get("/active", cacheMiddleware(60, kzKeyGenerator), async (req, res) => {
  try {
    const { page, limit, ban_type } = req.query;
    const { limit: validLimit, offset } = validatePagination(page, limit, 100);

    let query = `
        SELECT 
          b.id,
          b.ban_type,
          b.expires_on,
          b.steamid64,
          b.player_name,
          b.notes,
          b.server_id,
          s.server_name,
          b.created_on,
          b.updated_on
        FROM kz_bans b
        LEFT JOIN kz_servers s ON b.server_id = s.server_id
        WHERE (b.expires_on IS NULL OR b.expires_on > NOW())
      `;
    const params = [];

    if (ban_type) {
      query += " AND b.ban_type = ?";
      params.push(sanitizeString(ban_type, 50));
    }

    // Count total
    const countQuery = query.replace(
      /SELECT.*FROM/s,
      "SELECT COUNT(*) as total FROM",
    );
    const pool = getKzPool();
    const [countResult] = await pool.query(countQuery, params);
    const total = countResult[0].total;

    query += " ORDER BY b.created_on DESC";
    query += " LIMIT ? OFFSET ?";
    params.push(validLimit, offset);

    const [bans] = await pool.query(query, params);

    res.json({
      data: bans,
      pagination: {
        page: parseInt(page, 10) || 1,
        limit: validLimit,
        total: total,
        totalPages: Math.ceil(total / validLimit),
      },
    });
  } catch (e) {
    logger.error(`Failed to fetch active bans: ${e.message}`);
    res.status(500).json({ error: "Failed to fetch active bans" });
  }
});

/**
 * @swagger
 * /kzglobal/bans/stats:
 *   get:
 *     summary: Get ban statistics
 *     description: Returns overview statistics about bans
 *     tags: [KZ Global]
 *     responses:
 *       200:
 *         description: Ban statistics
 *       500:
 *         description: Server error
 */
router.get("/stats", cacheMiddleware(300, kzKeyGenerator), async (req, res) => {
  try {
    const pool = getKzPool();

    // Get overall stats
    const [overallStats] = await pool.query(`
        SELECT 
          COUNT(*) as total_bans,
          SUM(CASE WHEN expires_on IS NULL OR expires_on > NOW() THEN 1 ELSE 0 END) as active_bans,
          SUM(CASE WHEN expires_on IS NOT NULL AND expires_on <= NOW() THEN 1 ELSE 0 END) as expired_bans,
          COUNT(DISTINCT steamid64) as unique_players_banned
        FROM kz_bans
      `);

    // Get ban type breakdown
    const [banTypes] = await pool.query(`
        SELECT 
          ban_type,
          COUNT(*) as count,
          SUM(CASE WHEN expires_on IS NULL OR expires_on > NOW() THEN 1 ELSE 0 END) as active
        FROM kz_bans
        GROUP BY ban_type
        ORDER BY count DESC
      `);

    // Get recent bans
    const [recentBans] = await pool.query(`
        SELECT 
          b.id,
          b.ban_type,
          b.steamid64,
          b.player_name,
          b.created_on,
          CASE 
            WHEN b.expires_on IS NULL THEN TRUE
            WHEN b.expires_on > NOW() THEN TRUE
            ELSE FALSE
          END as is_active
        FROM kz_bans b
        ORDER BY b.created_on DESC
        LIMIT 10
      `);

    res.json({
      statistics: overallStats[0],
      ban_type_breakdown: banTypes,
      recent_bans: recentBans,
    });
  } catch (e) {
    logger.error(`Failed to fetch ban statistics: ${e.message}`);
    res.status(500).json({ error: "Failed to fetch ban statistics" });
  }
});

/**
 * @swagger
 * /kzglobal/bans/{id}:
 *   get:
 *     summary: Get ban details
 *     description: Returns detailed information about a specific ban
 *     tags: [KZ Global]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Ban ID from GlobalKZ
 *     responses:
 *       200:
 *         description: Ban details
 *       404:
 *         description: Ban not found
 *       500:
 *         description: Server error
 */
router.get("/:id", cacheMiddleware(60, kzKeyGenerator), async (req, res) => {
  try {
    const { id } = req.params;
    const banId = parseInt(id, 10);

    if (isNaN(banId)) {
      return res.status(400).json({ error: "Invalid ban ID" });
    }

    const pool = getKzPool();
    const [bans] = await pool.query(
      `
      SELECT 
        b.id,
        b.ban_type,
        b.expires_on,
        b.ip,
        b.steamid64,
        b.player_name,
        b.steam_id,
        b.notes,
        b.stats,
        b.server_id,
        s.server_name,
        b.updated_by_id,
        up.player_name as updated_by_name,
        b.created_on,
        b.updated_on,
        b.created_at,
        b.updated_at,
        CASE 
          WHEN b.expires_on IS NULL THEN TRUE
          WHEN b.expires_on > NOW() THEN TRUE
          ELSE FALSE
        END as is_active
      FROM kz_bans b
      LEFT JOIN kz_servers s ON b.server_id = s.server_id
      LEFT JOIN kz_players up ON b.updated_by_id = up.steamid64
      WHERE b.id = ?
    `,
      [banId],
    );

    if (bans.length === 0) {
      return res.status(404).json({ error: "Ban not found" });
    }

    res.json({
      data: bans[0],
    });
  } catch (e) {
    logger.error(`Failed to fetch KZ ban ${req.params.id}: ${e.message}`);
    res.status(500).json({ error: "Failed to fetch KZ ban" });
  }
});

/**
 * @swagger
 * /kzglobal/bans/player/{steamid}:
 *   get:
 *     summary: Get bans for a player
 *     description: Returns all bans for a specific player
 *     tags: [KZ Global]
 *     parameters:
 *       - in: path
 *         name: steamid
 *         required: true
 *         schema:
 *           type: string
 *         description: Player Steam ID
 *       - in: query
 *         name: active
 *         schema:
 *           type: boolean
 *         description: Filter active bans only
 *     responses:
 *       200:
 *         description: Player bans list
 *       400:
 *         description: Invalid Steam ID
 *       500:
 *         description: Server error
 */
router.get(
  "/player/:steamid",
  cacheMiddleware(60, kzKeyGenerator),
  async (req, res) => {
    try {
      const { steamid } = req.params;
      const { active } = req.query;

      if (!isValidSteamID(steamid)) {
        return res.status(400).json({ error: "Invalid SteamID format" });
      }

      const steamid64 = convertToSteamID64(steamid);
      if (!steamid64) {
        return res.status(400).json({ error: "Failed to convert SteamID" });
      }

      let query = `
        SELECT 
          b.id,
          b.ban_type,
          b.expires_on,
          b.notes,
          b.server_id,
          s.server_name,
          b.updated_by_id,
          b.created_on,
          b.updated_on,
          CASE 
            WHEN b.expires_on IS NULL THEN TRUE
            WHEN b.expires_on > NOW() THEN TRUE
            ELSE FALSE
          END as is_active
        FROM kz_bans b
        LEFT JOIN kz_servers s ON b.server_id = s.server_id
        WHERE b.steamid64 = ?
      `;
      const params = [steamid64];

      if (active !== undefined) {
        const isActive = active === "true" || active === true;
        if (isActive) {
          query += " AND (b.expires_on IS NULL OR b.expires_on > NOW())";
        } else {
          query += " AND b.expires_on IS NOT NULL AND b.expires_on <= NOW()";
        }
      }

      query += " ORDER BY b.created_on DESC";

      const pool = getKzPool();
      const [bans] = await pool.query(query, params);

      res.json({
        steamid: steamid64,
        data: bans,
        total: bans.length,
      });
    } catch (e) {
      logger.error(
        `Failed to fetch bans for player ${req.params.steamid}: ${e.message}`,
      );
      res.status(500).json({ error: "Failed to fetch player bans" });
    }
  },
);

module.exports = router;
