const express = require("express");
const router = express.Router();
const { getKzPool } = require("../db/kzRecords");
const { validatePagination, sanitizeString } = require("../utils/validators");
const logger = require("../utils/logger");
const { cacheMiddleware, kzKeyGenerator } = require("../utils/cacheMiddleware");

/**
 * Helper function to get partition hints for kz_records_partitioned
 * Partitions: p_old (before 2018), p2018-p2027, pfuture
 * @param {string} dateFrom - Optional start date filter
 * @param {string} dateTo - Optional end date filter
 * @returns {string} Partition hint clause or empty string
 */
const getPartitionHint = (dateFrom, dateTo) => {
  const partitions = [];
  const currentYear = new Date().getFullYear();

  if (!dateFrom && !dateTo) {
    // No date filter - scan all partitions (let MySQL optimize)
    return "";
  }

  const fromYear = dateFrom ? new Date(dateFrom).getFullYear() : 2014;
  const toYear = dateTo ? new Date(dateTo).getFullYear() : currentYear;

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
 * Get default partition hint for queries without date filters
 * Uses all partitions for complete data coverage
 */
const getDefaultPartitionHint = () => {
  // For aggregate queries across all data, don't use partition hints
  // Let MySQL's partition pruning work naturally with map_id filters
  return "";
};

/**
 * @swagger
 * /kzglobal/maps:
 *   get:
 *     summary: Get KZ maps
 *     description: Returns a paginated list of KZ maps with statistics
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
 *         description: Filter by map name (partial match)
 *       - in: query
 *         name: difficulty
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 7
 *         description: Filter by difficulty tier
 *       - in: query
 *         name: validated
 *         schema:
 *           type: boolean
 *         description: Filter by validation status
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           enum: [name, difficulty, records, updated_on]
 *           default: name
 *       - in: query
 *         name: order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: asc
 *     responses:
 *       200:
 *         description: Successful response with maps list
 *       500:
 *         description: Server error
 */
router.get("/", cacheMiddleware(60, kzKeyGenerator), async (req, res) => {
  try {
    // Test pool availability first
    const pool = getKzPool();
    if (!pool) {
      logger.error("KZ database pool not initialized");
      return res.status(503).json({
        error: "KZ database service unavailable",
        message:
          "The KZ records database is not connected. Please check database configuration.",
      });
    }

    const {
      page,
      limit,
      name,
      difficulty,
      validated,
      sort = "name",
      order = "asc",
    } = req.query;
    const { limit: validLimit, offset } = validatePagination(page, limit, 100);

    const validSortFields = ["name", "difficulty", "records", "updated_on"];
    const sortField = validSortFields.includes(sort) ? sort : "name";
    const sortOrder = order === "asc" ? "ASC" : "DESC";

    // Build WHERE conditions for maps
    const whereConditions = ["1=1"];
    const params = [];

    if (name) {
      whereConditions.push("m.map_name LIKE ?");
      params.push(`%${sanitizeString(name, 255)}%`);
    }

    if (difficulty !== undefined) {
      const diff = parseInt(difficulty, 10);
      if (diff >= 1 && diff <= 7) {
        whereConditions.push("m.difficulty = ?");
        params.push(diff);
      }
    }

    if (validated !== undefined) {
      const isValidated = validated === "true" || validated === true;
      whereConditions.push("m.validated = ?");
      params.push(isValidated);
    }

    const whereClause = whereConditions.join(" AND ");

    // Get total count first (fast query on maps table only)
    const [countResult] = await pool.query(
      `SELECT COUNT(*) as total FROM kz_maps m WHERE ${whereClause}`,
      params,
    );
    const total = countResult[0].total;

    // Map sort field
    let sortColumn;
    if (sortField === "name") {
      sortColumn = "m.map_name";
    } else if (sortField === "difficulty") {
      sortColumn = "m.difficulty";
    } else if (sortField === "updated_on") {
      sortColumn = "m.global_updated_on";
    } else {
      // For records sort, use statistics table
      sortColumn = "COALESCE(ms.total_records, 0)";
    }

    // Use pre-calculated statistics table for better performance
    const query = `
      SELECT 
        m.id,
        m.map_id,
        m.map_name,
        m.difficulty,
        m.validated,
        m.filesize,
        m.workshop_url,
        m.download_url,
        m.approved_by_steamid64,
        m.global_created_on,
        m.global_updated_on,
        COALESCE(ms.total_records, 0) as records,
        COALESCE(ms.unique_players, 0) as unique_players,
        ms.world_record_time
      FROM kz_maps m
      LEFT JOIN kz_map_statistics ms ON m.id = ms.map_id
      WHERE ${whereClause}
      ORDER BY ${sortColumn} ${sortOrder}
      LIMIT ? OFFSET ?
    `;

    const queryParams = [...params, validLimit, offset];
    const [maps] = await pool.query(query, queryParams);

    res.json({
      data: maps,
      pagination: {
        page: parseInt(page, 10) || 1,
        limit: validLimit,
        total: total,
        totalPages: Math.ceil(total / validLimit),
      },
    });
  } catch (e) {
    logger.error(`Failed to fetch KZ maps: ${e.message}`, { stack: e.stack });

    // Provide more specific error messages
    if (e.code === "ECONNREFUSED") {
      return res.status(503).json({
        error: "Database connection refused",
        message:
          "Cannot connect to KZ records database. Please ensure the database server is running on the configured port.",
      });
    }

    if (e.code === "ETIMEDOUT" || e.code === "PROTOCOL_CONNECTION_LOST") {
      return res.status(504).json({
        error: "Database connection timeout",
        message:
          "The database query took too long to respond. Please try again.",
      });
    }

    res
      .status(500)
      .json({ error: "Failed to fetch KZ maps", details: e.message });
  }
});

/**
 * @swagger
 * /kzglobal/maps/top/difficulty:
 *   get:
 *     summary: Get maps by difficulty
 *     description: Returns maps grouped and sorted by difficulty tier
 *     tags: [KZ Global]
 *     parameters:
 *       - in: query
 *         name: tier
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 7
 *         description: Filter by specific difficulty tier
 *       - in: query
 *         name: validated
 *         schema:
 *           type: boolean
 *         description: Only show validated maps
 *     responses:
 *       200:
 *         description: Maps by difficulty
 *       500:
 *         description: Server error
 */
router.get(
  "/top/difficulty",
  cacheMiddleware(3600, kzKeyGenerator),
  async (req, res) => {
    try {
      const { tier, validated } = req.query;
      const pool = getKzPool();

      // Build WHERE conditions for maps
      const whereConditions = ["m.difficulty IS NOT NULL"];
      const params = [];

      if (tier !== undefined) {
        const tierNum = parseInt(tier, 10);
        if (tierNum >= 1 && tierNum <= 7) {
          whereConditions.push("m.difficulty = ?");
          params.push(tierNum);
        }
      }

      if (validated !== undefined) {
        const isValidated = validated === "true" || validated === true;
        whereConditions.push("m.validated = ?");
        params.push(isValidated);
      }

      const whereClause = whereConditions.join(" AND ");

      // Optimized query using subquery for record stats
      const query = `
        SELECT 
          m.map_name,
          m.difficulty,
          m.validated,
          COALESCE(record_stats.total_records, 0) as total_records,
          record_stats.world_record
        FROM kz_maps m
        LEFT JOIN (
          SELECT 
            r.map_id,
            COUNT(*) as total_records,
            MIN(r.time) as world_record
          FROM kz_records_partitioned r
          INNER JOIN kz_players p ON r.player_id = p.id
          WHERE (p.is_banned IS NULL OR p.is_banned = FALSE)
          GROUP BY r.map_id
        ) record_stats ON m.id = record_stats.map_id
        WHERE ${whereClause}
        ORDER BY m.difficulty ASC, total_records DESC
      `;

      const [maps] = await pool.query(query, params);

      res.json({
        data: maps,
        total: maps.length,
      });
    } catch (e) {
      logger.error(`Failed to fetch maps by difficulty: ${e.message}`);
      res.status(500).json({ error: "Failed to fetch maps by difficulty" });
    }
  },
);

/**
 * @swagger
 * /kzglobal/maps/{mapname}:
 *   get:
 *     summary: Get map details
 *     description: Returns detailed information about a specific map
 *     tags: [KZ Global]
 *     parameters:
 *       - in: path
 *         name: mapname
 *         required: true
 *         schema:
 *           type: string
 *         description: Map name
 *     responses:
 *       200:
 *         description: Map details with statistics
 *       404:
 *         description: Map not found
 *       500:
 *         description: Server error
 */
router.get(
  "/:mapname",
  cacheMiddleware(60, kzKeyGenerator),
  async (req, res) => {
    try {
      const { mapname } = req.params;

      const pool = getKzPool();

      // Get map info with pre-calculated statistics
      const [maps] = await pool.query(
        `SELECT 
          m.*,
          COALESCE(ms.total_records, 0) as total_records,
          COALESCE(ms.unique_players, 0) as unique_players,
          ms.world_record_time as world_record,
          ms.avg_time as average_time,
          ms.pro_records,
          ms.tp_records,
          ms.first_record_date as first_record,
          ms.last_record_date as last_record
        FROM kz_maps m
        LEFT JOIN kz_map_statistics ms ON m.id = ms.map_id
        WHERE m.map_name = ?`,
        [sanitizeString(mapname, 255)],
      );

      if (maps.length === 0) {
        return res.status(404).json({ error: "Map not found" });
      }

      const map = maps[0];

      // Get worst time separately (not in statistics table)
      const [worstTime] = await pool.query(
        `
        SELECT MAX(r.time) as worst_time
        FROM kz_records_partitioned r
        LEFT JOIN kz_players p ON r.player_id = p.id
        WHERE r.map_id = ?
          AND (p.is_banned IS NULL OR p.is_banned = FALSE)
      `,
        [map.id],
      );

      const stats = [
        {
          total_records: map.total_records,
          unique_players: map.unique_players,
          world_record: map.world_record,
          average_time: map.average_time,
          worst_time: worstTime[0]?.worst_time,
          first_record: map.first_record,
          last_record: map.last_record,
        },
      ];

      // Get mode breakdown (excluding banned players)
      const [modeStats] = await pool.query(
        `
        SELECT 
          r.mode,
          COUNT(*) as records,
          COUNT(DISTINCT r.player_id) as players,
          MIN(r.time) as world_record,
          AVG(r.time) as avg_time
        FROM kz_records_partitioned r
        LEFT JOIN kz_players p ON r.player_id = p.id
        WHERE r.map_id = ?
          AND (p.is_banned IS NULL OR p.is_banned = FALSE)
        GROUP BY r.mode
      `,
        [map.id],
      );

      // Get stage records count (excluding banned players)
      const [stageStats] = await pool.query(
        `
        SELECT 
          r.stage,
          COUNT(*) as records,
          MIN(r.time) as world_record
        FROM kz_records_partitioned r
        LEFT JOIN kz_players p ON r.player_id = p.id
        WHERE r.map_id = ?
          AND (p.is_banned IS NULL OR p.is_banned = FALSE)
        GROUP BY r.stage
        ORDER BY r.stage
      `,
        [map.id],
      );

      // Get recent world records (excluding banned players)
      const [recentWRs] = await pool.query(
        `
        SELECT 
          r.id,
          r.original_id,
          p.player_name,
          p.steamid64,
          r.mode,
          r.stage,
          r.time,
          r.teleports,
          r.points,
          s.server_name,
          r.created_on
        FROM kz_records_partitioned r
        LEFT JOIN kz_players p ON r.player_id = p.id
        LEFT JOIN kz_servers s ON r.server_id = s.id
        WHERE r.map_id = ?
          AND r.stage = 0
          AND r.teleports = 0
          AND (p.is_banned IS NULL OR p.is_banned = FALSE)
        ORDER BY r.time ASC
        LIMIT 10
      `,
        [map.id],
      );

      res.json({
        map: {
          id: map.id,
          map_id: map.map_id,
          map_name: map.map_name,
          difficulty: map.difficulty,
          validated: map.validated,
          filesize: map.filesize,
          workshop_url: map.workshop_url,
          download_url: map.download_url,
          approved_by_steamid64: map.approved_by_steamid64,
          global_created_on: map.global_created_on,
          global_updated_on: map.global_updated_on,
          created_at: map.created_at,
          updated_at: map.updated_at,
        },
        statistics: {
          ...stats[0],
          mode_breakdown: modeStats,
          stage_breakdown: stageStats,
        },
        top_records: recentWRs,
      });
    } catch (e) {
      logger.error(
        `Failed to fetch KZ map ${req.params.mapname}: ${e.message}`,
      );
      res.status(500).json({ error: "Failed to fetch KZ map" });
    }
  },
);

/**
 * @swagger
 * /kzglobal/maps/{mapname}/records:
 *   get:
 *     summary: Get all records for a map
 *     description: Returns paginated list of all records set on a specific map
 *     tags: [KZ Global]
 *     parameters:
 *       - in: path
 *         name: mapname
 *         required: true
 *         schema:
 *           type: string
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
 *         description: Filter by mode
 *       - in: query
 *         name: stage
 *         schema:
 *           type: integer
 *         description: Filter by stage
 *       - in: query
 *         name: teleports
 *         schema:
 *           type: string
 *           enum: [tp, pro]
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           enum: [time, created_on]
 *           default: time
 *     responses:
 *       200:
 *         description: Map records list
 *       404:
 *         description: Map not found
 *       500:
 *         description: Server error
 */
router.get(
  "/:mapname/records",
  cacheMiddleware(30, kzKeyGenerator),
  async (req, res) => {
    try {
      const { mapname } = req.params;
      const {
        page,
        limit,
        mode,
        stage,
        teleports,
        sort = "time",
        order = "asc",
      } = req.query;
      const { limit: validLimit, offset } = validatePagination(
        page,
        limit,
        100,
      );

      const pool = getKzPool();

      // Check if map exists
      const [mapCheck] = await pool.query(
        "SELECT id FROM kz_maps WHERE map_name = ?",
        [sanitizeString(mapname, 255)],
      );

      if (mapCheck.length === 0) {
        return res.status(404).json({ error: "Map not found" });
      }

      const mapId = mapCheck[0].id;

      let query = `
        SELECT 
          r.id,
          r.original_id,
          p.player_name,
          p.steamid64,
          r.mode,
          r.stage,
          r.time,
          r.teleports,
          r.points,
          r.tickrate,
          s.server_name,
          r.created_on
        FROM kz_records_partitioned r
        LEFT JOIN kz_players p ON r.player_id = p.id
        LEFT JOIN kz_servers s ON r.server_id = s.id
        WHERE r.map_id = ?
          AND (p.is_banned IS NULL OR p.is_banned = FALSE)
      `;
      const params = [mapId];

      if (mode) {
        query += " AND r.mode = ?";
        params.push(sanitizeString(mode, 32));
      }

      if (stage !== undefined) {
        query += " AND r.stage = ?";
        params.push(parseInt(stage, 10));
      }

      if (teleports === "pro") {
        query += " AND r.teleports = 0";
      } else if (teleports === "tp") {
        query += " AND r.teleports > 0";
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
        map_name: mapname,
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
        `Failed to fetch records for map ${req.params.mapname}: ${e.message}`,
      );
      res.status(500).json({ error: "Failed to fetch map records" });
    }
  },
);

module.exports = router;
