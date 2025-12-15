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
 * /kzglobal/maps/enriched:
 *   get:
 *     summary: Get enriched maps with world record holders
 *     description: Returns maps with global data and world record holder information for efficient front-end loading. Optionally include player completion status.
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
 *         name: steamid
 *         schema:
 *           type: string
 *         description: SteamID64 to include player completion status
 *       - in: query
 *         name: completed
 *         schema:
 *           type: string
 *           enum: [pro, tp, any, none]
 *         description: Filter by completion status (requires steamid)
 *       - in: query
 *         name: mode
 *         schema:
 *           type: string
 *           default: kz_timer
 *         description: Mode for completion check
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
 *         description: Enriched maps with world records and optional completion status
 *       500:
 *         description: Server error
 */
router.get(
  "/enriched",
  cacheMiddleware(60, kzKeyGenerator),
  async (req, res) => {
    try {
      const pool = getKzPool();
      if (!pool) {
        logger.error("KZ database pool not initialized");
        return res.status(503).json({
          error: "KZ database service unavailable",
          message: "The KZ records database is not connected.",
        });
      }

      const {
        page,
        limit,
        name,
        difficulty,
        validated,
        steamid,
        completed,
        mode = "kz_timer",
        sort = "name",
        order = "asc",
      } = req.query;
      const { limit: validLimit, offset } = validatePagination(
        page,
        limit,
        100,
      );

      const validSortFields = ["name", "difficulty", "records", "updated_on"];
      const sortField = validSortFields.includes(sort) ? sort : "name";
      const sortOrder = order === "asc" ? "ASC" : "DESC";
      const modeStr = sanitizeString(mode, 32) || "kz_timer";

      // Build WHERE conditions
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

      // Add completion filter if steamid is provided
      const hasSteamid = steamid && steamid.length > 0;
      if (hasSteamid && completed) {
        if (completed === "pro") {
          whereConditions.push("pb.pro_time IS NOT NULL");
        } else if (completed === "tp") {
          whereConditions.push(
            "pb.tp_time IS NOT NULL AND pb.pro_time IS NULL",
          );
        } else if (completed === "any") {
          whereConditions.push(
            "(pb.pro_time IS NOT NULL OR pb.tp_time IS NOT NULL)",
          );
        } else if (completed === "none") {
          whereConditions.push("pb.pro_time IS NULL AND pb.tp_time IS NULL");
        }
      }

      const whereClause = whereConditions.join(" AND ");

      // Build count query (need to include PB join if filtering by completion)
      let countQuery;
      let countParams;
      if (hasSteamid && completed) {
        countQuery = `
        SELECT COUNT(*) as total 
        FROM kz_maps m
        LEFT JOIN kz_player_map_pbs pb ON m.id = pb.map_id AND pb.steamid64 = ? AND pb.mode = ? AND pb.stage = 0
        WHERE ${whereClause}
      `;
        countParams = [steamid, modeStr, ...params];
      } else {
        countQuery = `SELECT COUNT(*) as total FROM kz_maps m WHERE ${whereClause}`;
        countParams = params;
      }

      const [countResult] = await pool.query(countQuery, countParams);
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
        sortColumn = "COALESCE(ms.total_records, 0)";
      }

      // Build main query with optional PB data
      let pbSelectClause = "";
      let pbJoinClause = "";
      if (hasSteamid) {
        pbSelectClause = `,
        pb.pro_time as player_pro_time,
        pb.pro_points as player_pro_points,
        pb.tp_time as player_tp_time,
        pb.tp_teleports as player_tp_teleports,
        pb.tp_points as player_tp_points,
        CASE 
          WHEN pb.pro_time IS NOT NULL THEN 'pro'
          WHEN pb.tp_time IS NOT NULL THEN 'tp'
          ELSE 'none'
        END as completion_status`;
        pbJoinClause = `LEFT JOIN kz_player_map_pbs pb ON m.id = pb.map_id AND pb.steamid64 = ? AND pb.mode = ? AND pb.stage = 0`;
      }

      // Query with all world record types (all 3 modes, pro + overall)
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
        m.global_created_on,
        m.global_updated_on,
        COALESCE(ms.total_records, 0) as records_count,
        COALESCE(ms.unique_players, 0) as unique_players,
        -- KZTimer WRs
        ms.wr_kz_timer_pro_time,
        ms.wr_kz_timer_pro_steamid64,
        ms.wr_kz_timer_pro_player_name,
        ms.wr_kz_timer_pro_record_id,
        ms.wr_kz_timer_overall_time,
        ms.wr_kz_timer_overall_teleports,
        ms.wr_kz_timer_overall_steamid64,
        ms.wr_kz_timer_overall_player_name,
        ms.wr_kz_timer_overall_record_id,
        -- KZSimple WRs
        ms.wr_kz_simple_pro_time,
        ms.wr_kz_simple_pro_steamid64,
        ms.wr_kz_simple_pro_player_name,
        ms.wr_kz_simple_pro_record_id,
        ms.wr_kz_simple_overall_time,
        ms.wr_kz_simple_overall_teleports,
        ms.wr_kz_simple_overall_steamid64,
        ms.wr_kz_simple_overall_player_name,
        ms.wr_kz_simple_overall_record_id,
        -- KZVanilla WRs
        ms.wr_kz_vanilla_pro_time,
        ms.wr_kz_vanilla_pro_steamid64,
        ms.wr_kz_vanilla_pro_player_name,
        ms.wr_kz_vanilla_pro_record_id,
        ms.wr_kz_vanilla_overall_time,
        ms.wr_kz_vanilla_overall_teleports,
        ms.wr_kz_vanilla_overall_steamid64,
        ms.wr_kz_vanilla_overall_player_name,
        ms.wr_kz_vanilla_overall_record_id,
        (SELECT COUNT(DISTINCT r.stage) FROM kz_records_partitioned r WHERE r.map_id = m.id AND r.stage > 0) as courses_count
        ${pbSelectClause}
      FROM kz_maps m
      LEFT JOIN kz_map_statistics ms ON m.id = ms.map_id
      ${pbJoinClause}
      WHERE ${whereClause}
      ORDER BY ${sortColumn} ${sortOrder}
      LIMIT ? OFFSET ?
    `;

      // Build query params
      let queryParams;
      if (hasSteamid) {
        queryParams = [steamid, modeStr, ...params, validLimit, offset];
      } else {
        queryParams = [...params, validLimit, offset];
      }
      const [maps] = await pool.query(query, queryParams);

      // Helper to format WR data
      const formatWR = (
        time,
        steamid64,
        playerName,
        recordId,
        teleports = null,
      ) => {
        if (time === null) return null;
        const wr = {
          time: parseFloat(time),
          steamid64,
          playerName,
          recordId,
        };
        if (teleports !== null) {
          wr.teleports = teleports;
        }
        return wr;
      };

      // Format response for site consumption
      const enrichedMaps = maps.map((map) => {
        const result = {
          name: map.map_name,
          mapId: map.map_id,
          difficulty: map.difficulty,
          validated: map.validated,
          workshopUrl: map.workshop_url,
          downloadUrl: map.download_url,
          recordsCount: map.records_count,
          coursesCount: map.courses_count || 0,
          globalCreatedOn: map.global_created_on,
          globalUpdatedOn: map.global_updated_on,
          worldRecords: {
            kz_timer: {
              pro: formatWR(
                map.wr_kz_timer_pro_time,
                map.wr_kz_timer_pro_steamid64,
                map.wr_kz_timer_pro_player_name,
                map.wr_kz_timer_pro_record_id,
              ),
              overall: formatWR(
                map.wr_kz_timer_overall_time,
                map.wr_kz_timer_overall_steamid64,
                map.wr_kz_timer_overall_player_name,
                map.wr_kz_timer_overall_record_id,
                map.wr_kz_timer_overall_teleports,
              ),
            },
            kz_simple: {
              pro: formatWR(
                map.wr_kz_simple_pro_time,
                map.wr_kz_simple_pro_steamid64,
                map.wr_kz_simple_pro_player_name,
                map.wr_kz_simple_pro_record_id,
              ),
              overall: formatWR(
                map.wr_kz_simple_overall_time,
                map.wr_kz_simple_overall_steamid64,
                map.wr_kz_simple_overall_player_name,
                map.wr_kz_simple_overall_record_id,
                map.wr_kz_simple_overall_teleports,
              ),
            },
            kz_vanilla: {
              pro: formatWR(
                map.wr_kz_vanilla_pro_time,
                map.wr_kz_vanilla_pro_steamid64,
                map.wr_kz_vanilla_pro_player_name,
                map.wr_kz_vanilla_pro_record_id,
              ),
              overall: formatWR(
                map.wr_kz_vanilla_overall_time,
                map.wr_kz_vanilla_overall_steamid64,
                map.wr_kz_vanilla_overall_player_name,
                map.wr_kz_vanilla_overall_record_id,
                map.wr_kz_vanilla_overall_teleports,
              ),
            },
          },
          // Legacy field for backwards compatibility (KZT pro)
          worldRecord: formatWR(
            map.wr_kz_timer_pro_time,
            map.wr_kz_timer_pro_steamid64,
            map.wr_kz_timer_pro_player_name,
            map.wr_kz_timer_pro_record_id,
          ),
          isGlobal: map.difficulty !== null,
        };

        // Add player completion data if steamid was provided
        if (hasSteamid) {
          result.playerCompletion = {
            status: map.completion_status || "none",
            proTime: map.player_pro_time
              ? parseFloat(map.player_pro_time)
              : null,
            proPoints: map.player_pro_points || null,
            tpTime: map.player_tp_time ? parseFloat(map.player_tp_time) : null,
            tpTeleports: map.player_tp_teleports || null,
            tpPoints: map.player_tp_points || null,
          };
        }

        return result;
      });

      res.json({
        data: enrichedMaps,
        pagination: {
          page: parseInt(page, 10) || 1,
          limit: validLimit,
          total: total,
          totalPages: Math.ceil(total / validLimit),
        },
      });
    } catch (e) {
      logger.error(`Failed to fetch enriched KZ maps: ${e.message}`, {
        stack: e.stack,
      });

      if (e.code === "ECONNREFUSED") {
        return res.status(503).json({
          error: "Database connection refused",
          message: "Cannot connect to KZ records database.",
        });
      }

      res.status(500).json({
        error: "Failed to fetch enriched KZ maps",
        details: e.message,
      });
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

/**
 * @swagger
 * /kzglobal/maps/{mapname}/refresh-wr:
 *   post:
 *     summary: Refresh world record from KZTimer API
 *     description: Forces a refresh of the world record data from KZTimer Global API
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
 *         description: World record refreshed successfully
 *       404:
 *         description: Map not found
 *       503:
 *         description: Could not fetch WR from KZTimer API
 *       500:
 *         description: Server error
 */
router.post("/:mapname/refresh-wr", async (req, res) => {
  try {
    const { mapname } = req.params;
    const { refreshMapWorldRecord } = require("../services/wrSync");

    const pool = getKzPool();
    if (!pool) {
      return res.status(503).json({
        error: "KZ database service unavailable",
      });
    }

    // Check if map exists
    const [maps] = await pool.query(
      "SELECT id, map_name FROM kz_maps WHERE map_name = ?",
      [sanitizeString(mapname, 255)],
    );

    if (maps.length === 0) {
      return res.status(404).json({ error: "Map not found" });
    }

    // Refresh WR from KZTimer
    const wrData = await refreshMapWorldRecord(mapname);

    if (wrData) {
      res.json({
        message: "World record refreshed successfully",
        map_name: mapname,
        world_record: {
          time: wrData.time,
          steamid64: wrData.steamid64,
          player_name: wrData.playerName,
          record_id: wrData.recordId,
        },
      });
    } else {
      res.status(503).json({
        error: "Could not fetch world record from KZTimer API",
        map_name: mapname,
      });
    }
  } catch (e) {
    logger.error(
      `Failed to refresh WR for map ${req.params.mapname}: ${e.message}`,
    );
    res.status(500).json({ error: "Failed to refresh world record" });
  }
});

/**
 * @swagger
 * /kzglobal/maps/{mapname}/courses:
 *   get:
 *     summary: Get available courses/stages for a map
 *     description: Returns all available courses (stages) for a map based on record filters
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
 *           enum: [kz_timer, kz_simple, kz_vanilla]
 *         description: Filter by mode (optional)
 *     responses:
 *       200:
 *         description: List of available courses
 *       404:
 *         description: Map not found
 *       500:
 *         description: Server error
 */
router.get(
  "/:mapname/courses",
  cacheMiddleware(300, kzKeyGenerator), // Cache for 5 minutes
  async (req, res) => {
    try {
      const { mapname } = req.params;
      const { mode } = req.query;

      const pool = getKzPool();
      if (!pool) {
        return res.status(503).json({
          error: "KZ database service unavailable",
        });
      }

      // Get map ID first
      const [maps] = await pool.query(
        "SELECT id, map_name FROM kz_maps WHERE map_name = ?",
        [sanitizeString(mapname, 255)],
      );

      if (maps.length === 0) {
        return res.status(404).json({ error: "Map not found" });
      }

      const mapId = maps[0].id;

      // Get unique stages (courses) from record_filters
      let coursesQuery = `
        SELECT DISTINCT 
          rf.stage,
          m.name as mode_name,
          rf.mode_id,
          COUNT(*) as filter_count
        FROM kz_record_filters rf
        JOIN kz_modes m ON rf.mode_id = m.id
        WHERE rf.map_id = ?
      `;
      const queryParams = [mapId];

      if (mode) {
        coursesQuery += " AND m.name = ?";
        queryParams.push(sanitizeString(mode, 50));
      }

      coursesQuery += `
        GROUP BY rf.stage, m.name, rf.mode_id
        ORDER BY rf.stage ASC, m.name ASC
      `;

      const [courses] = await pool.query(coursesQuery, queryParams);

      // Transform to a cleaner format
      // Group by stage and list available modes per stage
      const courseMap = new Map();

      for (const row of courses) {
        if (!courseMap.has(row.stage)) {
          courseMap.set(row.stage, {
            stage: row.stage,
            name: row.stage === 0 ? "Main Course" : `Bonus ${row.stage}`,
            modes: [],
          });
        }
        courseMap.get(row.stage).modes.push({
          mode: row.mode_name,
          modeId: row.mode_id,
          filterCount: row.filter_count,
        });
      }

      const result = Array.from(courseMap.values());

      res.json({
        map_name: maps[0].map_name,
        courses: result,
        total_courses: result.length,
      });
    } catch (e) {
      logger.error(
        `Failed to get courses for map ${req.params.mapname}: ${e.message}`,
      );
      res.status(500).json({ error: "Failed to fetch map courses" });
    }
  },
);

/**
 * @swagger
 * /kzglobal/maps/mode-filters:
 *   get:
 *     summary: Get all map mode filters
 *     description: Returns maps that have mode-specific restrictions. Maps without entries are available for all modes.
 *     tags: [KZ Global Maps]
 *     parameters:
 *       - in: query
 *         name: mode
 *         schema:
 *           type: string
 *           enum: [kz_timer, kz_simple, kz_vanilla]
 *         description: Filter by specific mode
 *     responses:
 *       200:
 *         description: Map mode filters with summary
 *       500:
 *         description: Server error
 */
router.get("/mode-filters", cacheMiddleware(300, kzKeyGenerator), async (req, res) => {
  try {
    const pool = getKzPool();
    const { mode } = req.query;

    // Get summary counts per mode
    const [summary] = await pool.query(`
      SELECT 
        mode,
        COUNT(*) as map_count
      FROM kz_map_mode_filters
      GROUP BY mode
      ORDER BY mode
    `);

    // Get all filtered maps with their allowed modes
    let mapsQuery = `
      SELECT 
        m.id as map_id,
        m.map_name,
        m.difficulty,
        m.validated,
        GROUP_CONCAT(mmf.mode ORDER BY mmf.mode) as allowed_modes
      FROM kz_maps m
      INNER JOIN kz_map_mode_filters mmf ON m.id = mmf.map_id
    `;
    const params = [];

    if (mode) {
      mapsQuery += " WHERE mmf.mode = ?";
      params.push(sanitizeString(mode, 32));
    }

    mapsQuery += `
      GROUP BY m.id, m.map_name, m.difficulty, m.validated
      ORDER BY m.map_name
    `;

    const [maps] = await pool.query(mapsQuery, params);

    // Get total maps count for context
    const [[{ total_maps }]] = await pool.query(
      "SELECT COUNT(*) as total_maps FROM kz_maps",
    );

    res.json({
      summary: {
        total_maps,
        filtered_maps: maps.length,
        unfiltered_maps: total_maps - maps.length,
        by_mode: summary.reduce((acc, row) => {
          acc[row.mode] = row.map_count;
          return acc;
        }, {}),
      },
      maps: maps.map((m) => ({
        map_id: m.map_id,
        map_name: m.map_name,
        difficulty: m.difficulty,
        validated: m.validated,
        allowed_modes: m.allowed_modes ? m.allowed_modes.split(",") : [],
      })),
    });
  } catch (e) {
    logger.error(`Failed to get map mode filters: ${e.message}`);
    res.status(500).json({ error: "Failed to fetch map mode filters" });
  }
});

/**
 * @swagger
 * /kzglobal/maps/mode-filters/{mode}:
 *   get:
 *     summary: Get maps for a specific mode
 *     description: Returns all maps that are allowed for the specified mode, including unrestricted maps.
 *     tags: [KZ Global Maps]
 *     parameters:
 *       - in: path
 *         name: mode
 *         required: true
 *         schema:
 *           type: string
 *           enum: [kz_timer, kz_simple, kz_vanilla]
 *         description: Mode to get maps for
 *       - in: query
 *         name: restrictedOnly
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Only return maps that have mode restrictions
 *     responses:
 *       200:
 *         description: Maps available for the specified mode
 *       400:
 *         description: Invalid mode
 *       500:
 *         description: Server error
 */
router.get("/mode-filters/:mode", cacheMiddleware(300, kzKeyGenerator), async (req, res) => {
  try {
    const pool = getKzPool();
    const mode = sanitizeString(req.params.mode, 32);
    const restrictedOnly = req.query.restrictedOnly === "true";

    const validModes = ["kz_timer", "kz_simple", "kz_vanilla"];
    if (!validModes.includes(mode)) {
      return res.status(400).json({
        error: "Invalid mode",
        valid_modes: validModes,
      });
    }

    let query;
    if (restrictedOnly) {
      // Only maps that have this mode in their filter list
      query = `
        SELECT 
          m.id as map_id,
          m.map_name,
          m.difficulty,
          m.validated
        FROM kz_maps m
        INNER JOIN kz_map_mode_filters mmf ON m.id = mmf.map_id AND mmf.mode = ?
        ORDER BY m.map_name
      `;
    } else {
      // All maps available for this mode (unrestricted + restricted with this mode)
      query = `
        SELECT 
          m.id as map_id,
          m.map_name,
          m.difficulty,
          m.validated,
          CASE 
            WHEN EXISTS (SELECT 1 FROM kz_map_mode_filters mmf WHERE mmf.map_id = m.id)
            THEN 'restricted'
            ELSE 'all'
          END as mode_status
        FROM kz_maps m
        WHERE NOT EXISTS (
          SELECT 1 FROM kz_map_mode_filters mmf 
          WHERE mmf.map_id = m.id
        )
        OR EXISTS (
          SELECT 1 FROM kz_map_mode_filters mmf 
          WHERE mmf.map_id = m.id AND mmf.mode = ?
        )
        ORDER BY m.map_name
      `;
    }

    const [maps] = await pool.query(query, [mode]);

    res.json({
      mode,
      total_maps: maps.length,
      restricted_only: restrictedOnly,
      maps,
    });
  } catch (e) {
    logger.error(`Failed to get maps for mode ${req.params.mode}: ${e.message}`);
    res.status(500).json({ error: "Failed to fetch maps for mode" });
  }
});

module.exports = router;
