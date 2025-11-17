const express = require("express");
const router = express.Router();
const { getKzPool } = require("../db/kzRecords");
const { validatePagination, sanitizeString } = require("../utils/validators");
const logger = require("../utils/logger");
const {
  cacheMiddleware,
  kzKeyGenerator,
} = require("../utils/cacheMiddleware");

/**
 * @swagger
 * /kzglobal/servers:
 *   get:
 *     summary: Get KZ servers
 *     description: Returns a paginated list of KZ servers from GlobalKZ
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
 *         name: name
 *         schema:
 *           type: string
 *         description: Filter by server name (partial match)
 *       - in: query
 *         name: owner
 *         schema:
 *           type: string
 *         description: Filter by owner SteamID64
 *       - in: query
 *         name: approval_status
 *         schema:
 *           type: integer
 *         description: Filter by approval status
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           enum: [name, created_on, records]
 *           default: name
 *       - in: query
 *         name: order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: asc
 *     responses:
 *       200:
 *         description: Successful response with servers list
 *       500:
 *         description: Server error
 */
router.get("/", cacheMiddleware(60, kzKeyGenerator), async (req, res) => {
  try {
    const {
      page,
      limit,
      name,
      owner,
      approval_status,
      sort = "name",
      order = "asc",
    } = req.query;
    const { limit: validLimit, offset } = validatePagination(page, limit, 100);

    const validSortFields = ["name", "created_on", "records"];
    const sortField = validSortFields.includes(sort) ? sort : "name";
    const sortOrder = order === "asc" ? "ASC" : "DESC";

    let query = `
      SELECT 
        s.id,
        s.server_id,
        s.server_name,
        s.ip,
        s.port,
        s.owner_steamid64,
        s.created_on,
        s.updated_on,
        s.approval_status,
        s.approved_by_steamid64,
        COUNT(DISTINCT r.id) as total_records,
        COUNT(DISTINCT r.player_id) as unique_players
      FROM kz_servers s
      LEFT JOIN kz_records r ON s.id = r.server_id
      WHERE 1=1
    `;
    const params = [];

    if (name) {
      query += " AND s.server_name LIKE ?";
      params.push(`%${sanitizeString(name, 255)}%`);
    }

    if (owner) {
      query += " AND s.owner_steamid64 = ?";
      params.push(sanitizeString(owner, 20));
    }

    if (approval_status !== undefined) {
      query += " AND s.approval_status = ?";
      params.push(parseInt(approval_status, 10));
    }

    query +=
      " GROUP BY s.id, s.server_id, s.server_name, s.ip, s.port, s.owner_steamid64, s.created_on, s.updated_on, s.approval_status, s.approved_by_steamid64";

    // Get total count
    const countQuery = `SELECT COUNT(DISTINCT s.id) as total FROM kz_servers s WHERE 1=1${
      name ? " AND s.server_name LIKE ?" : ""
    }${owner ? " AND s.owner_steamid64 = ?" : ""}${
      approval_status !== undefined ? " AND s.approval_status = ?" : ""
    }`;
    const countParams = [];
    if (name) countParams.push(`%${sanitizeString(name, 255)}%`);
    if (owner) countParams.push(sanitizeString(owner, 20));
    if (approval_status !== undefined)
      countParams.push(parseInt(approval_status, 10));

    const pool = getKzPool();
    const [countResult] = await pool.query(countQuery, countParams);
    const total = countResult[0].total;

    // Map sort field
    const sortColumn =
      sortField === "name"
        ? "s.server_name"
        : sortField === "created_on"
          ? "s.created_on"
          : "total_records";

    query += ` ORDER BY ${sortColumn} ${sortOrder}`;
    query += ` LIMIT ? OFFSET ?`;
    params.push(validLimit, offset);

    const [servers] = await pool.query(query, params);

    res.json({
      data: servers,
      pagination: {
        page: parseInt(page, 10) || 1,
        limit: validLimit,
        total: total,
        totalPages: Math.ceil(total / validLimit),
      },
    });
  } catch (e) {
    logger.error(`Failed to fetch KZ servers: ${e.message}`);
    res.status(500).json({ error: "Failed to fetch KZ servers" });
  }
});

/**
 * @swagger
 * /kzglobal/servers/top/records:
 *   get:
 *     summary: Get top servers by record count
 *     description: Returns servers ranked by number of records
 *     tags: [KZ Global]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 100
 *           maximum: 500
 *     responses:
 *       200:
 *         description: Top servers list
 *       500:
 *         description: Server error
 */
router.get(
  "/top/records",
  cacheMiddleware(300, kzKeyGenerator),
  async (req, res) => {
    try {
      const { limit = 100 } = req.query;
      const validLimit = Math.min(parseInt(limit, 10) || 100, 500);

      const pool = getKzPool();
      const [servers] = await pool.query(
        `
        SELECT 
          s.server_id,
          s.server_name,
          s.ip,
          s.port,
          COUNT(DISTINCT r.id) as total_records,
          COUNT(DISTINCT r.player_id) as unique_players,
          COUNT(DISTINCT r.map_id) as unique_maps
        FROM kz_servers s
        INNER JOIN kz_records r ON s.id = r.server_id
        GROUP BY s.id, s.server_id, s.server_name, s.ip, s.port
        ORDER BY total_records DESC
        LIMIT ?
      `,
        [validLimit],
      );

      const rankedServers = servers.map((server, index) => ({
        rank: index + 1,
        ...server,
      }));

      res.json({
        data: rankedServers,
        total: rankedServers.length,
      });
    } catch (e) {
      logger.error(`Failed to fetch top servers: ${e.message}`);
      res.status(500).json({ error: "Failed to fetch top servers" });
    }
  },
);

/**
 * @swagger
 * /kzglobal/servers/{id}:
 *   get:
 *     summary: Get server details
 *     description: Returns detailed information about a specific server
 *     tags: [KZ Global]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Server ID from GlobalKZ
 *     responses:
 *       200:
 *         description: Server details with statistics
 *       404:
 *         description: Server not found
 *       500:
 *         description: Server error
 */
router.get("/:id", cacheMiddleware(60, kzKeyGenerator), async (req, res) => {
  try {
    const { id } = req.params;
    const serverId = parseInt(id, 10);

    if (isNaN(serverId)) {
      return res.status(400).json({ error: "Invalid server ID" });
    }

    const pool = getKzPool();

    // Get server info
    const [servers] = await pool.query(
      "SELECT * FROM kz_servers WHERE server_id = ?",
      [serverId],
    );

    if (servers.length === 0) {
      return res.status(404).json({ error: "Server not found" });
    }

    const server = servers[0];

    // Get record statistics
    const [stats] = await pool.query(
      `
      SELECT 
        COUNT(DISTINCT r.id) as total_records,
        COUNT(DISTINCT r.player_id) as unique_players,
        COUNT(DISTINCT r.map_id) as unique_maps,
        MIN(r.created_on) as first_record,
        MAX(r.created_on) as last_record
      FROM kz_records r
      WHERE r.server_id = ?
    `,
      [server.id],
    );

    // Get mode breakdown
    const [modeStats] = await pool.query(
      `
      SELECT 
        mode,
        COUNT(*) as records,
        COUNT(DISTINCT player_id) as players,
        COUNT(DISTINCT map_id) as maps
      FROM kz_records
      WHERE server_id = ?
      GROUP BY mode
    `,
      [server.id],
    );

    // Get recent records
    const [recentRecords] = await pool.query(
      `
      SELECT 
        r.id,
        r.original_id,
        p.player_name,
        p.steamid64,
        m.map_name,
        r.mode,
        r.stage,
        r.time,
        r.teleports,
        r.points,
        r.created_on
      FROM kz_records r
      LEFT JOIN kz_players p ON r.player_id = p.steamid64
      LEFT JOIN kz_maps m ON r.map_id = m.id
      WHERE r.server_id = ?
      ORDER BY r.created_on DESC
      LIMIT 20
    `,
      [server.id],
    );

    res.json({
      server: {
        id: server.id,
        server_id: server.server_id,
        server_name: server.server_name,
        ip: server.ip,
        port: server.port,
        owner_steamid64: server.owner_steamid64,
        created_on: server.created_on,
        updated_on: server.updated_on,
        approval_status: server.approval_status,
        approved_by_steamid64: server.approved_by_steamid64,
        created_at: server.created_at,
      },
      statistics: {
        ...stats[0],
        mode_breakdown: modeStats,
      },
      recent_records: recentRecords,
    });
  } catch (e) {
    logger.error(
      `Failed to fetch KZ server ${req.params.id}: ${e.message}`,
    );
    res.status(500).json({ error: "Failed to fetch KZ server" });
  }
});

/**
 * @swagger
 * /kzglobal/servers/{id}/records:
 *   get:
 *     summary: Get all records from a server
 *     description: Returns paginated list of all records set on a specific server
 *     tags: [KZ Global]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
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
 *         name: mode
 *         schema:
 *           type: string
 *       - in: query
 *         name: map
 *         schema:
 *           type: string
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           enum: [time, created_on]
 *           default: created_on
 *     responses:
 *       200:
 *         description: Server records list
 *       404:
 *         description: Server not found
 *       500:
 *         description: Server error
 */
router.get(
  "/:id/records",
  cacheMiddleware(30, kzKeyGenerator),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { page, limit, mode, map, sort = "created_on", order = "desc" } = req.query;
      const serverId = parseInt(id, 10);

      if (isNaN(serverId)) {
        return res.status(400).json({ error: "Invalid server ID" });
      }

      const pool = getKzPool();

      // Check if server exists
      const [serverCheck] = await pool.query(
        "SELECT id FROM kz_servers WHERE server_id = ?",
        [serverId],
      );

      if (serverCheck.length === 0) {
        return res.status(404).json({ error: "Server not found" });
      }

      const serverDbId = serverCheck[0].id;
      const { limit: validLimit, offset } = validatePagination(
        page,
        limit,
        100,
      );

      let query = `
        SELECT 
          r.id,
          r.original_id,
          p.player_name,
          p.steamid64,
          m.map_name,
          r.mode,
          r.stage,
          r.time,
          r.teleports,
          r.points,
          r.tickrate,
          r.created_on
        FROM kz_records r
        LEFT JOIN kz_players p ON r.player_id = p.steamid64
        LEFT JOIN kz_maps m ON r.map_id = m.id
        WHERE r.server_id = ?
      `;
      const params = [serverDbId];

      if (mode) {
        query += " AND r.mode = ?";
        params.push(sanitizeString(mode, 32));
      }

      if (map) {
        query += " AND m.map_name LIKE ?";
        params.push(`%${sanitizeString(map, 255)}%`);
      }

      // Count total
      const countQuery = query.replace(
        /SELECT.*FROM/s,
        "SELECT COUNT(*) as total FROM",
      );
      const [countResult] = await pool.query(countQuery, params);
      const total = countResult[0].total;

      const sortField = sort === "time" ? "time" : "created_on";
      const sortOrder = order === "asc" ? "ASC" : "DESC";

      query += ` ORDER BY r.${sortField} ${sortOrder}`;
      query += ` LIMIT ? OFFSET ?`;
      params.push(validLimit, offset);

      const [records] = await pool.query(query, params);

      res.json({
        server_id: serverId,
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
        `Failed to fetch records for server ${req.params.id}: ${e.message}`,
      );
      res.status(500).json({ error: "Failed to fetch server records" });
    }
  },
);

module.exports = router;
