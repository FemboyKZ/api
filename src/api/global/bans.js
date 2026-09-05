/**
 * kz_bans references players by steamid64, not by kz_players.id.
 */

const express = require("express");
const router = express.Router();
const { getKzPool } = require("../../db/kzRecords");
const {
  validatePagination,
  paginationMeta,
  sanitizeString,
  isValidSteamID,
  convertToSteamID64,
  validateSortField,
  validateSortOrder,
  defaultSortOrder,
} = require("../../utils/validators");
const { toCountQuery } = require("../../utils/kzHelpers");
const logger = require("../../utils/logger");
const {
  cacheMiddleware,
  kzKeyGenerator,
} = require("../../utils/cacheMiddleware");

/**
 * @swagger
 * /global/bans:
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
 *           enum: [created_on, expires_on, updated_on, updated_at]
 *           default: created_on
 *         description: >
 *           updated_on is the GlobalKZ timestamp, updated_at is when we last saw
 *           a field on the ban actually change
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
    const {
      page: validPage,
      limit: validLimit,
      offset,
    } = validatePagination(page, limit, 100);

    const validSortFields = [
      "created_on",
      "expires_on",
      "updated_on",
      "updated_at",
    ];
    const sortField = validateSortField(sort, validSortFields, "created_on");
    const sortOrder = validateSortOrder(order, defaultSortOrder(sortField));

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
        b.updated_at,
        b.last_seen_at,
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

    const countQuery = toCountQuery(query);
    const pool = getKzPool();
    const [countResult] = await pool.query(countQuery, params);
    const total = countResult[0].total;

    query += ` ORDER BY b.${sortField} ${sortOrder}`;
    query += ` LIMIT ? OFFSET ?`;
    params.push(validLimit, offset);

    const [bans] = await pool.query(query, params);

    res.json({
      data: bans,
      pagination: paginationMeta(validPage, validLimit, total),
    });
  } catch (error) {
    logger.error(`Failed to fetch KZ bans: ${error.message}`);
    res.status(500).json({ error: "Failed to fetch KZ bans" });
  }
});

/**
 * @swagger
 * /global/bans/active:
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
    const {
      page: validPage,
      limit: validLimit,
      offset,
    } = validatePagination(page, limit, 100);

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

    const countQuery = toCountQuery(query);
    const pool = getKzPool();
    const [countResult] = await pool.query(countQuery, params);
    const total = countResult[0].total;

    query += " ORDER BY b.created_on DESC";
    query += " LIMIT ? OFFSET ?";
    params.push(validLimit, offset);

    const [bans] = await pool.query(query, params);

    res.json({
      data: bans,
      pagination: paginationMeta(validPage, validLimit, total),
    });
  } catch (error) {
    logger.error(`Failed to fetch active bans: ${error.message}`);
    res.status(500).json({ error: "Failed to fetch active bans" });
  }
});

/**
 * @swagger
 * /global/bans/stats:
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
  } catch (error) {
    logger.error(`Failed to fetch ban statistics: ${error.message}`);
    res.status(500).json({ error: "Failed to fetch ban statistics" });
  }
});

/**
 * @swagger
 * /global/bans/changes:
 *   get:
 *     summary: Get recent ban changes
 *     description: >
 *       Returns changes detected on already-known bans (unbans, rebans, expiry
 *       changes and edits). GlobalKZ exposes no way to query bans by update time,
 *       so these rows come from diffing each full ban sweep against stored data.
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
 *         name: type
 *         schema:
 *           type: string
 *           enum: [unban, reban, expiry_change, edit]
 *         description: Filter by change type
 *       - in: query
 *         name: steamid
 *         schema:
 *           type: string
 *         description: Filter by player SteamID
 *       - in: query
 *         name: ban_id
 *         schema:
 *           type: integer
 *         description: Filter by ban ID
 *       - in: query
 *         name: since
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Only changes detected at or after this timestamp
 *     responses:
 *       200:
 *         description: Ban change list
 *       400:
 *         description: Invalid parameter
 *       500:
 *         description: Server error
 */
router.get(
  "/changes",
  cacheMiddleware(30, kzKeyGenerator),
  async (req, res) => {
    try {
      const { page, limit, type, steamid, ban_id, since } = req.query;
      const {
        page: validPage,
        limit: validLimit,
        offset,
      } = validatePagination(page, limit, 100);

      const validTypes = ["unban", "reban", "expiry_change", "edit"];

      let where = "WHERE 1=1";
      const params = [];

      if (type) {
        if (!validTypes.includes(type)) {
          return res.status(400).json({
            error: `Invalid change type. Valid types: ${validTypes.join(", ")}`,
          });
        }
        where += " AND c.change_type = ?";
        params.push(type);
      }

      if (steamid) {
        if (!isValidSteamID(steamid)) {
          return res.status(400).json({ error: "Invalid SteamID format" });
        }
        where += " AND c.steamid64 = ?";
        params.push(convertToSteamID64(steamid));
      }

      if (ban_id) {
        const parsedBanId = parseInt(ban_id, 10);
        if (isNaN(parsedBanId)) {
          return res.status(400).json({ error: "Invalid ban ID" });
        }
        where += " AND c.ban_id = ?";
        params.push(parsedBanId);
      }

      if (since) {
        const sinceDate = new Date(since);
        if (isNaN(sinceDate.getTime())) {
          return res.status(400).json({ error: "Invalid since timestamp" });
        }
        where += " AND c.detected_at >= ?";
        params.push(sinceDate);
      }

      const pool = getKzPool();

      const [countResult] = await pool.query(
        `SELECT COUNT(*) as total FROM kz_ban_changes c ${where}`,
        params,
      );
      const total = countResult[0].total;

      const [changes] = await pool.query(
        `SELECT
         c.id,
         c.ban_id,
         c.steamid64,
         c.player_name,
         c.change_type,
         c.field,
         c.old_value,
         c.new_value,
         c.api_updated_on,
         c.detected_at,
         b.ban_type,
         b.expires_on,
         b.server_id
       FROM kz_ban_changes c
       LEFT JOIN kz_bans b ON c.ban_id = b.id
       ${where}
       ORDER BY c.detected_at DESC, c.id DESC
       LIMIT ? OFFSET ?`,
        [...params, validLimit, offset],
      );

      res.json({
        data: changes,
        pagination: paginationMeta(validPage, validLimit, total),
      });
    } catch (error) {
      if (error.code === "ER_NO_SUCH_TABLE") {
        return res.status(503).json({
          error:
            "Ban change tracking not initialized. Run db/migrations/add_ban_change_tracking.sql",
        });
      }
      logger.error(`Failed to fetch ban changes: ${error.message}`);
      res.status(500).json({ error: "Failed to fetch ban changes" });
    }
  },
);

/**
 * @swagger
 * /global/bans/{id}:
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
        b.last_seen_at,
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
  } catch (error) {
    logger.error(`Failed to fetch KZ ban ${req.params.id}: ${error.message}`);
    res.status(500).json({ error: "Failed to fetch KZ ban" });
  }
});

/**
 * @swagger
 * /global/bans/player/{steamid}:
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
    } catch (error) {
      logger.error(
        `Failed to fetch bans for player ${req.params.steamid}: ${error.message}`,
      );
      res.status(500).json({ error: "Failed to fetch player bans" });
    }
  },
);

module.exports = router;
