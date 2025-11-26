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
 * Helper function to get partition hints based on date filters
 * For yearly partitions: p_old (before 2018), p2018-p2027, pfuture
 */
const getYearlyPartitionHint = (dateFrom, dateTo, sortField, sortOrder) => {
  const partitions = [];
  const currentYear = new Date().getFullYear();

  if (!dateFrom && !dateTo) {
    // For recent queries without date filter, use recent partitions
    if (sortField === "created_on" && sortOrder === "DESC") {
      // Only scan current year and previous year for recent records
      partitions.push(`p${currentYear}`);
      partitions.push(`p${currentYear - 1}`);
      partitions.push("pfuture");
      return `PARTITION (${partitions.join(",")})`;
    }
    // Default: scan last 2 years to avoid full table scan on unfiltered queries
    partitions.push(`p${currentYear}`);
    partitions.push(`p${currentYear - 1}`);
    partitions.push("pfuture");
    return `PARTITION (${partitions.join(",")})`;
  }

  // Build partition list based on date range
  const fromYear = dateFrom ? new Date(dateFrom).getFullYear() : 2014;
  const toYear = dateTo ? new Date(dateTo).getFullYear() : currentYear;

  // Add relevant partitions
  if (fromYear < 2018) {
    partitions.push("p_old");
  }

  for (
    let year = Math.max(fromYear, 2018);
    year <= Math.min(toYear, 2027);
    year++
  ) {
    partitions.push(`p${year}`);
  }

  if (toYear >= currentYear) {
    partitions.push("pfuture");
  }

  if (partitions.length === 0) return "";

  return `PARTITION (${partitions.join(",")})`;
};

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
 *       - in: query
 *         name: date_from
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter records from this date
 *       - in: query
 *         name: date_to
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter records to this date
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
      date_from,
      date_to,
    } = req.query;
    const { limit: validLimit, offset } = validatePagination(page, limit, 100);

    const validSortFields = ["time", "created_on", "points"];
    const sortField = validSortFields.includes(sort) ? sort : "created_on";
    const sortOrder = order === "asc" ? "ASC" : "DESC";

    // Build WHERE conditions
    const whereConditions = [];
    const params = [];

    // Filter out banned players by default
    if (include_banned !== "true" && include_banned !== true) {
      whereConditions.push("(p.is_banned IS NULL OR p.is_banned = FALSE)");
    }

    // Date filters for partition pruning
    if (date_from) {
      whereConditions.push("r.created_on >= ?");
      params.push(date_from);
    }
    if (date_to) {
      whereConditions.push("r.created_on <= ?");
      params.push(date_to);
    }

    // Apply filters
    if (map) {
      whereConditions.push("m.map_name LIKE ?");
      params.push(`%${sanitizeString(map, 255)}%`);
    }

    if (map_id) {
      whereConditions.push("r.map_id = ?");
      params.push(parseInt(map_id, 10));
    }

    if (player) {
      // Check if it's a SteamID or name
      if (isValidSteamID(player)) {
        const steamid64 = convertToSteamID64(player);
        whereConditions.push("r.steamid64 = ?");
        params.push(steamid64);
      } else {
        whereConditions.push("p.player_name LIKE ?");
        params.push(`%${sanitizeString(player, 100)}%`);
      }
    }

    if (mode) {
      whereConditions.push("r.mode = ?");
      params.push(sanitizeString(mode, 32));
    }

    if (stage !== undefined) {
      whereConditions.push("r.stage = ?");
      params.push(parseInt(stage, 10));
    }

    if (server) {
      whereConditions.push("r.server_id = ?");
      params.push(parseInt(server, 10));
    }

    if (teleports) {
      if (teleports === "pro" || teleports === "false") {
        whereConditions.push("r.teleports = 0");
      } else if (teleports === "tp" || teleports === "true") {
        whereConditions.push("r.teleports > 0");
      }
    }

    const whereClause =
      whereConditions.length > 0 ? ` AND ${whereConditions.join(" AND ")}` : "";

    // Get partition hint
    const partitionHint = getYearlyPartitionHint(
      date_from,
      date_to,
      sortField,
      sortOrder,
    );

    const pool = getKzPool();

    // Get count (use approximate for large unfiltered datasets)
    let total = 0;
    const hasFilters =
      map ||
      map_id ||
      player ||
      mode ||
      stage !== undefined ||
      server ||
      teleports ||
      date_from ||
      date_to;

    if (!hasFilters && parseInt(page, 10) > 10) {
      // Use approximate count for deep pagination without filters
      const [tableStatus] = await pool.query(
        "SHOW TABLE STATUS LIKE 'kz_records_partitioned'",
      );
      total = tableStatus[0]?.Rows || 0;
    } else {
      // Get exact count for filtered results or early pages
      const countQuery = `
        SELECT COUNT(*) as total
        FROM kz_records_partitioned ${partitionHint} r
        ${(player && !isValidSteamID(player)) || include_banned !== "true" ? "INNER JOIN kz_players p ON r.player_id = p.id" : ""}
        ${map ? "INNER JOIN kz_maps m ON r.map_id = m.id" : ""}
        WHERE 1=1 ${whereClause}
      `;

      const [countResult] = await pool.query(countQuery, params);
      total = countResult[0].total;
    }

    // Build main query
    const mainQuery = `
      SELECT SQL_NO_CACHE
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
      FROM kz_records_partitioned ${partitionHint} r
      INNER JOIN kz_players p ON r.player_id = p.id
      INNER JOIN kz_maps m ON r.map_id = m.id
      LEFT JOIN kz_servers s ON r.server_id = s.id
      WHERE 1=1 ${whereClause}
      ORDER BY r.${sortField} ${sortOrder}
      LIMIT ? OFFSET ?
    `;

    // Add pagination params
    const mainParams = [...params, validLimit, offset];

    // Execute with timeout (30s for complex queries)
    const queryPromise = pool.query(mainQuery, mainParams);
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Query timeout")), 30000),
    );

    const [records] = await Promise.race([queryPromise, timeoutPromise]);

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
    logger.error(
      `Query params: ${JSON.stringify({ page, limit, sort, order, map, map_id, player, mode, stage, server, teleports, date_from, date_to, include_banned })}`,
    );
    logger.error(`Partition hint: ${partitionHint || "none"}`);
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

      const mapId = mapCheck[0].id;

      // Build leaderboard query with best time per player
      // Using partitioned table
      let query = `
        WITH RankedRecords AS (
          SELECT 
            r.id,
            r.original_id,
            r.player_id,
            r.time,
            r.teleports,
            r.points,
            r.tickrate,
            r.server_id,
            r.created_on,
            ROW_NUMBER() OVER (PARTITION BY r.player_id ORDER BY r.time ASC) as rn
          FROM kz_records_partitioned r
          WHERE r.map_id = ?
            AND r.mode = ?
            AND r.stage = ?
      `;

      const params = [mapId, sanitizeString(mode, 32), stageNum];

      if (teleports === "pro") {
        query += " AND r.teleports = 0";
      } else if (teleports === "tp") {
        query += " AND r.teleports > 0";
      }

      query += `
        )
        SELECT 
          rr.id,
          rr.original_id,
          p.player_name,
          p.steamid64,
          p.is_banned,
          rr.time,
          rr.teleports,
          rr.points,
          rr.tickrate,
          rr.server_id,
          s.server_name,
          rr.created_on,
          ROW_NUMBER() OVER (ORDER BY rr.time ASC) as rank
        FROM RankedRecords rr
        INNER JOIN kz_players p ON rr.player_id = p.id
        LEFT JOIN kz_servers s ON rr.server_id = s.id
        WHERE rr.rn = 1
      `;

      // Filter banned players
      if (include_banned !== "true" && include_banned !== true) {
        query += " AND (p.is_banned IS NULL OR p.is_banned = FALSE)";
      }

      query += `
        ORDER BY rr.time ASC
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

    // For recent records, only scan recent year partitions
    const currentYear = new Date().getFullYear();
    const partitionHint = `PARTITION (p${currentYear}, p${currentYear - 1}, pfuture)`;

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
        FROM kz_records_partitioned ${partitionHint} r
        INNER JOIN kz_players p ON r.player_id = p.id
        INNER JOIN kz_maps m ON r.map_id = m.id
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
      const teleportFilter = teleports === "pro" ? 0 : 1;

      const pool = getKzPool();

      // Use the worldrecords cache table for optimal performance
      let query = `
        SELECT 
          m.map_name,
          p.player_name,
          p.steamid64,
          p.is_banned,
          wrc.time,
          wrc.teleports,
          wrc.points,
          wrc.mode,
          wrc.stage,
          s.server_name,
          wrc.created_on
        FROM kz_worldrecords_cache wrc
        INNER JOIN kz_maps m ON wrc.map_id = m.id
        INNER JOIN kz_players p ON wrc.player_id = p.id
        LEFT JOIN kz_servers s ON wrc.server_id = s.id
        WHERE wrc.mode = ?
          AND wrc.stage = ?
          AND wrc.teleports = ?
      `;

      const params = [sanitizeString(mode, 32), stageNum, teleportFilter];

      if (include_banned !== "true" && include_banned !== true) {
        query += " AND (p.is_banned IS NULL OR p.is_banned = FALSE)";
      }

      query += `
        ORDER BY wrc.created_on DESC
        LIMIT ?
      `;
      params.push(validLimit);

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
      FROM kz_records_partitioned r
      INNER JOIN kz_players p ON r.player_id = p.id
      INNER JOIN kz_maps m ON r.map_id = m.id
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
