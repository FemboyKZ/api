/**
 * Reads kz_players plus the PB cache maintained by services/playerPBsSync.js.
 *
 * tableExists/resetTableExistsCache are exported below the router only so
 * tests/tableExistsCache.test.js can reach the cache.
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
const {
  toCountQuery,
  getPlayerPartitionHint,
  computeCompletionStats,
} = require("../../utils/kzHelpers");
const logger = require("../../utils/logger");
const {
  cacheMiddleware,
  kzKeyGenerator,
} = require("../../utils/cacheMiddleware");
const {
  getPlayerPBs,
  getPlayerMapCompletions,
  refreshPlayerPBs,
} = require("../../services/playerPBsSync");

/**
 * The identity fields returned alongside a player's statistics.
 */
function playerIdentity(player) {
  return {
    steamid64: player.steamid64,
    steam_id: player.steam_id,
    player_name: player.player_name,
    is_banned: player.is_banned,
    created_at: player.created_at,
    updated_at: player.updated_at,
  };
}

/**
 * Per-mode record counts, points and times for one player.
 */
async function fetchModeBreakdown(pool, steamid64) {
  const [rows] = await pool.query(
    `
    SELECT 
      mode,
      COUNT(*) as records,
      SUM(points) as points,
      AVG(time) as avg_time,
      MIN(time) as best_time
    FROM kz_records_partitioned
    WHERE steamid64 = ?
    GROUP BY mode
  `,
    [steamid64],
  );
  return rows;
}

/**
 * A player's most recent records. Restricted to the recent partitions.
 */
async function fetchRecentRecords(pool, steamid64, limit = 10) {
  const currentYear = new Date().getFullYear();
  const [rows] = await pool.query(
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
    FROM kz_records_partitioned PARTITION (p${currentYear}, p${currentYear - 1}, pfuture) r
    INNER JOIN kz_maps m ON r.map_id = m.id
    LEFT JOIN kz_servers s ON r.server_id = s.id
    WHERE r.steamid64 = ?
    ORDER BY r.created_on DESC
    LIMIT ?
  `,
    [steamid64, limit],
  );
  return rows;
}

/**
 * @swagger
 * /global/players:
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
 *       - in: query
 *         name: active_since
 *         schema:
 *           type: string
 *           format: date
 *         description: Only show players active since this date
 *     responses:
 *       200:
 *         description: Successful response with players list
 *       500:
 *         description: Server error
 */
router.get("/", cacheMiddleware(60, kzKeyGenerator), async (req, res) => {
  try {
    const { page, limit, name, sort, order, banned, active_since } = req.query;
    const {
      page: validPage,
      limit: validLimit,
      offset,
    } = validatePagination(page, limit, 100);

    const validSortFields = ["records", "points", "name"];
    const sortField = validateSortField(sort, validSortFields, "records");
    const sortOrder = validateSortOrder(order, defaultSortOrder(sortField));

    const pool = getKzPool();

    // Determine if we can use the player statistics table for better performance
    const useStatsTable = !active_since && sortField !== "last_active";

    let query;
    const params = [];

    if (useStatsTable && (await tableExists("kz_player_statistics"))) {
      // Use pre-aggregated statistics table if it exists
      query = `
        SELECT 
          p.id,
          p.steamid64,
          p.steam_id,
          p.player_name,
          p.is_banned,
          COALESCE(ps.total_records, 0) as records,
          COALESCE(ps.total_points, 0) as points,
          COALESCE(ps.total_maps, 0) as maps_completed,
          ps.best_time,
          ps.last_record_date as last_record,
          p.created_at,
          p.updated_at
        FROM kz_players p
        LEFT JOIN kz_player_statistics ps ON p.id = ps.player_id
        WHERE 1=1
      `;
    } else {
      // Build query with aggregated stats from partitioned table
      // Determine partitions to scan based on active_since
      let partitionHint = "";
      if (active_since) {
        const sinceYear = new Date(active_since).getFullYear();
        const currentYear = new Date().getFullYear();
        const partitions = [];

        if (sinceYear < 2018) {
          partitions.push("p_old");
        }

        for (
          let year = Math.max(sinceYear, 2018);
          year <= currentYear;
          year++
        ) {
          partitions.push(`p${year}`);
        }
        partitions.push("pfuture");

        partitionHint = `PARTITION (${partitions.join(",")})`;
      }

      query = `
        SELECT 
          p.id,
          p.steamid64,
          p.steam_id,
          p.player_name,
          p.is_banned,
          COUNT(DISTINCT r.id) as records,
          COALESCE(SUM(r.points), 0) as points,
          COUNT(DISTINCT r.map_id) as maps_completed,
          MIN(r.time) as best_time,
          MAX(r.created_on) as last_record,
          p.created_at,
          p.updated_at
        FROM kz_players p
        LEFT JOIN kz_records_partitioned ${partitionHint} r ON p.id = r.player_id
          ${active_since ? "AND r.created_on >= ?" : ""}
        WHERE 1=1
      `;

      if (active_since) {
        params.push(active_since);
      }
    }

    if (name) {
      query += " AND p.player_name LIKE ?";
      params.push(`%${sanitizeString(name, 100)}%`);
    }

    if (banned !== undefined) {
      const isBanned = banned === "true" || banned === true;
      query += " AND p.is_banned = ?";
      params.push(isBanned);
    }

    if (!useStatsTable || !(await tableExists("kz_player_statistics"))) {
      query +=
        " GROUP BY p.id, p.steamid64, p.steam_id, p.player_name, p.is_banned, p.created_at, p.updated_at";

      if (active_since) {
        // Only include players with records after active_since
        query += " HAVING records > 0";
      }
    }

    let countQuery;
    const countParams = [];

    if (useStatsTable && (await tableExists("kz_player_statistics"))) {
      countQuery = `
        SELECT COUNT(DISTINCT p.id) as total 
        FROM kz_players p
        ${sortField !== "name" ? "LEFT JOIN kz_player_statistics ps ON p.id = ps.player_id" : ""}
        WHERE 1=1
        ${name ? "AND p.player_name LIKE ?" : ""}
        ${banned !== undefined ? "AND p.is_banned = ?" : ""}
      `;
    } else {
      countQuery = `SELECT COUNT(DISTINCT p.id) as total FROM kz_players p WHERE 1=1`;
      if (name) {
        countQuery += " AND p.player_name LIKE ?";
      }
      if (banned !== undefined) {
        countQuery += " AND p.is_banned = ?";
      }
    }

    if (name) countParams.push(`%${sanitizeString(name, 100)}%`);
    if (banned !== undefined)
      countParams.push(banned === "true" || banned === true);

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
      pagination: paginationMeta(validPage, validLimit, total),
    });
  } catch (error) {
    logger.error(`Failed to fetch players: ${error.message}`);
    logger.error(
      `Query params: ${JSON.stringify({ page, limit, name, sort, order, banned, active_since })}`,
    );
    res.status(500).json({ error: "Failed to fetch players" });
  }
});

/**
 * @swagger
 * /global/players/{steamid}:
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
router.get(
  "/:steamid",
  cacheMiddleware(60, kzKeyGenerator),
  async (req, res) => {
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

      // Check if we have cached statistics - but verify against live count first
      if (await tableExists("kz_player_statistics")) {
        const [cachedStats] = await pool.query(
          `
          SELECT 
            ps.total_records,
            ps.total_maps as maps_completed,
            ps.total_points,
            ps.avg_teleports,
            ps.world_records,
            ps.pro_records,
            ps.tp_records,
            ps.best_time,
            ps.first_record_date as first_record,
            ps.last_record_date as last_record,
            ps.updated_at as stats_updated
          FROM kz_player_statistics ps
          WHERE ps.player_id = ?
        `,
          [player.id],
        );

        // Verify cache is accurate by checking live total
        // Use player_id (not steamid64) since records are indexed by player_id
        let liveTotal = null;
        if (cachedStats.length > 0 && cachedStats[0].total_records > 0) {
          const [[liveCount]] = await pool.query(
            "SELECT COUNT(*) as cnt FROM kz_records_partitioned WHERE player_id = ?",
            [player.id],
          );
          liveTotal = liveCount.cnt;
        }

        if (
          cachedStats.length > 0 &&
          cachedStats[0].total_records > 0 &&
          liveTotal !== null &&
          cachedStats[0].total_records === liveTotal
        ) {
          // Use cached stats and get additional real-time data for recent activity
          const currentYear = new Date().getFullYear();
          const [realtimeStats] = await pool.query(
            `
            SELECT 
              AVG(r.time) as avg_time,
              MAX(r.time) as worst_time
            FROM kz_records_partitioned PARTITION (p${currentYear}, p${currentYear - 1}, pfuture) r
            WHERE r.steamid64 = ?
          `,
            [steamid64],
          );

          const statistics = { ...cachedStats[0], ...realtimeStats[0] };
          const modeStats = await fetchModeBreakdown(pool, steamid64);
          const recentRecords = await fetchRecentRecords(pool, steamid64);

          return res.json({
            player: playerIdentity(player),
            statistics: {
              ...statistics,
              mode_breakdown: modeStats,
            },
            recent_records: recentRecords,
          });
        }
      }

      // Fallback to calculating from partitioned records
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
        FROM kz_records_partitioned r
        WHERE r.steamid64 = ?
      `,
        [steamid64],
      );

      // Get world records count from cache table if available
      let worldRecords = 0;
      if (await tableExists("kz_worldrecords_cache")) {
        const [wrStats] = await pool.query(
          `
          SELECT COUNT(*) as world_records
          FROM kz_worldrecords_cache
          WHERE steamid64 = ?
        `,
          [steamid64],
        );
        worldRecords = wrStats[0].world_records;
      } else {
        // Fallback to calculating (slower)
        const [wrStats] = await pool.query(
          `
          SELECT COUNT(*) as world_records
          FROM (
            SELECT r.map_id, r.mode, r.stage, MIN(r.time) as best_time
            FROM kz_records_partitioned r
            GROUP BY r.map_id, r.mode, r.stage
            HAVING MIN(r.time) IN (
              SELECT r2.time
              FROM kz_records_partitioned r2
              WHERE r2.steamid64 = ?
                AND r2.map_id = r.map_id
                AND r2.mode = r.mode
                AND r2.stage = r.stage
            )
          ) wr
        `,
          [steamid64],
        );
        worldRecords = wrStats[0].world_records;
      }

      const modeStats = await fetchModeBreakdown(pool, steamid64);
      const recentRecords = await fetchRecentRecords(pool, steamid64);

      res.json({
        player: playerIdentity(player),
        statistics: {
          ...stats[0],
          world_records: worldRecords,
          mode_breakdown: modeStats,
        },
        recent_records: recentRecords,
      });
    } catch (error) {
      logger.error(
        `Failed to fetch KZ player ${req.params.steamid}: ${error.message}`,
      );
      res.status(500).json({ error: "Failed to fetch KZ player" });
    }
  },
);

/**
 * @swagger
 * /global/players/{steamid}/records:
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
 *         name: year
 *         schema:
 *           type: integer
 *         description: Filter by year
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
      const {
        page,
        limit,
        map,
        mode,
        year,
        sort = "created_on",
        order = "desc",
      } = req.query;

      if (!isValidSteamID(steamid)) {
        return res.status(400).json({ error: "Invalid SteamID format" });
      }

      const steamid64 = convertToSteamID64(steamid);
      const {
        page: validPage,
        limit: validLimit,
        offset,
      } = validatePagination(page, limit, 100);

      const validSortFields = ["time", "created_on", "points"];
      const sortField = validateSortField(sort, validSortFields, "created_on");
      const sortOrder = validateSortOrder(order, defaultSortOrder(sortField));

      // Determine partition hint based on year filter ONLY
      let partitionHint = "";
      if (year) {
        partitionHint = getPlayerPartitionHint(year);
      }
      // Note: do NOT restrict to recent partitions for sorted-by-date queries —
      // older records would be missed, producing wrong counts.

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
        FROM kz_records_partitioned ${partitionHint} r
        INNER JOIN kz_maps m ON r.map_id = m.id
        LEFT JOIN kz_servers s ON r.server_id = s.id
        WHERE r.steamid64 = ?
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

      if (year) {
        query += " AND YEAR(r.created_on) = ?";
        params.push(parseInt(year, 10));
      }

      const pool = getKzPool();
      let total;

      // Always count from live data - kz_player_statistics may be stale
      {
        const countQuery = toCountQuery(query);
        const [countResult] = await pool.query(countQuery, params);
        total = countResult[0].total;
      }

      query += ` ORDER BY r.${sortField} ${sortOrder}`;
      query += ` LIMIT ? OFFSET ?`;
      params.push(validLimit, offset);

      const [records] = await pool.query(query, params);

      res.json({
        data: records,
        pagination: paginationMeta(validPage, validLimit, total),
      });
    } catch (error) {
      logger.error(
        `Failed to fetch records for player ${req.params.steamid}: ${error.message}`,
      );
      res.status(500).json({ error: "Failed to fetch player records" });
    }
  },
);

/**
 * @swagger
 * /global/players/{steamid}/pbs:
 *   get:
 *     summary: Get player's personal bests
 *     description: Returns cached personal bests for a player across all maps
 *     tags: [KZ Global]
 *     parameters:
 *       - in: path
 *         name: steamid
 *         required: true
 *         schema:
 *           type: string
 *         description: SteamID64 or Steam ID
 *       - in: query
 *         name: mode
 *         schema:
 *           type: string
 *           default: kz_timer
 *         description: Game mode filter
 *       - in: query
 *         name: stage
 *         schema:
 *           type: integer
 *           default: 0
 *         description: Stage filter (0 for main course)
 *       - in: query
 *         name: validated
 *         schema:
 *           type: boolean
 *         description: Only show validated maps
 *     responses:
 *       200:
 *         description: Player's personal bests
 *       404:
 *         description: Player not found
 *       500:
 *         description: Server error
 */
router.get(
  "/:steamid/pbs",
  cacheMiddleware(60, kzKeyGenerator),
  async (req, res) => {
    try {
      const { steamid } = req.params;
      const { mode = "kz_timer", stage = 0, validated } = req.query;

      const pool = getKzPool();

      // Convert to SteamID64 if needed
      let steamid64 = steamid;
      if (!isValidSteamID(steamid)) {
        const converted = convertToSteamID64(steamid);
        if (!converted) {
          return res.status(400).json({ error: "Invalid SteamID format" });
        }
        steamid64 = converted;
      }

      // Check if PBs table exists and has data
      const pbsTableExists = await tableExists("kz_player_map_pbs");

      if (pbsTableExists) {
        // Use cached PBs
        const pbs = await getPlayerPBs(steamid64, {
          mode: sanitizeString(mode, 32),
          stage: parseInt(stage, 10) || 0,
          validated:
            validated === "true" ? true : validated === "false" ? false : null,
        });

        if (pbs.length > 0) {
          return res.json({
            steamid64,
            mode,
            stage: parseInt(stage, 10) || 0,
            data: pbs,
            total: pbs.length,
            source: "cache",
          });
        }
      }

      // Fallback: calculate PBs on the fly
      let query = `
        SELECT 
          m.id as map_id,
          m.map_name,
          m.difficulty as map_difficulty,
          m.validated as map_validated,
          pro.time as pro_time,
          pro.points as pro_points,
          pro.id as pro_record_id,
          pro.created_on as pro_created_on,
          tp.time as tp_time,
          tp.teleports as tp_teleports,
          tp.points as tp_points,
          tp.id as tp_record_id,
          tp.created_on as tp_created_on
        FROM kz_maps m
        INNER JOIN (
          SELECT DISTINCT map_id FROM kz_records_partitioned 
          WHERE steamid64 = ? AND mode = ? AND stage = ?
        ) player_maps ON m.id = player_maps.map_id
        LEFT JOIN (
          SELECT r.map_id, r.id, r.time, r.points, r.created_on
          FROM kz_records_partitioned r
          INNER JOIN (
            SELECT map_id, MIN(time) as min_time
            FROM kz_records_partitioned
            WHERE steamid64 = ? AND mode = ? AND stage = ? AND teleports = 0
            GROUP BY map_id
          ) best ON r.map_id = best.map_id AND r.time = best.min_time
          WHERE r.steamid64 = ? AND r.mode = ? AND r.stage = ? AND r.teleports = 0
          GROUP BY r.map_id
        ) pro ON m.id = pro.map_id
        LEFT JOIN (
          SELECT r.map_id, r.id, r.time, r.teleports, r.points, r.created_on
          FROM kz_records_partitioned r
          INNER JOIN (
            SELECT map_id, MIN(time) as min_time
            FROM kz_records_partitioned
            WHERE steamid64 = ? AND mode = ? AND stage = ? AND teleports > 0
            GROUP BY map_id
          ) best ON r.map_id = best.map_id AND r.time = best.min_time
          WHERE r.steamid64 = ? AND r.mode = ? AND r.stage = ? AND r.teleports > 0
          GROUP BY r.map_id
        ) tp ON m.id = tp.map_id
        WHERE 1=1
      `;

      const stageNum = parseInt(stage, 10) || 0;
      const modeStr = sanitizeString(mode, 32);
      const params = [
        steamid64,
        modeStr,
        stageNum,
        steamid64,
        modeStr,
        stageNum,
        steamid64,
        modeStr,
        stageNum,
        steamid64,
        modeStr,
        stageNum,
        steamid64,
        modeStr,
        stageNum,
      ];

      if (validated === "true") {
        query += " AND m.validated = TRUE";
      } else if (validated === "false") {
        query += " AND m.validated = FALSE";
      }

      query += " ORDER BY m.map_name ASC";

      const [pbs] = await pool.query(query, params);

      res.json({
        steamid64,
        mode: modeStr,
        stage: stageNum,
        data: pbs,
        total: pbs.length,
        source: "live",
      });
    } catch (error) {
      logger.error(
        `Failed to fetch PBs for player ${req.params.steamid}: ${error.message}`,
      );
      res.status(500).json({ error: "Failed to fetch player PBs" });
    }
  },
);

/**
 * @swagger
 * /global/players/{steamid}/completions:
 *   get:
 *     summary: Get player's map completion status
 *     description: Returns all maps with player's completion status for filtering
 *     tags: [KZ Global]
 *     parameters:
 *       - in: path
 *         name: steamid
 *         required: true
 *         schema:
 *           type: string
 *         description: SteamID64 or Steam ID
 *       - in: query
 *         name: mode
 *         schema:
 *           type: string
 *           default: kz_timer
 *       - in: query
 *         name: stage
 *         schema:
 *           type: integer
 *           default: 0
 *       - in: query
 *         name: validated
 *         schema:
 *           type: boolean
 *           default: true
 *       - in: query
 *         name: difficulty
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 7
 *       - in: query
 *         name: completed
 *         schema:
 *           type: string
 *           enum: [pro, tp, any, none]
 *         description: Filter by completion type
 *       - in: query
 *         name: filterByMode
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Apply mode-specific map filters (e.g., vnl maps only for kz_vanilla)
 *     responses:
 *       200:
 *         description: Maps with completion status and statistics
 *       400:
 *         description: Invalid SteamID
 *       500:
 *         description: Server error
 */
router.get(
  "/:steamid/completions",
  cacheMiddleware(60, kzKeyGenerator),
  async (req, res) => {
    try {
      const { steamid } = req.params;
      const {
        mode = "kz_timer",
        stage = 0,
        validated = "true",
        difficulty,
        completed,
        filterByMode = "false",
      } = req.query;

      const pool = getKzPool();

      // Convert to SteamID64 if needed
      let steamid64 = steamid;
      if (!isValidSteamID(steamid)) {
        const converted = convertToSteamID64(steamid);
        if (!converted) {
          return res.status(400).json({ error: "Invalid SteamID format" });
        }
        steamid64 = converted;
      }

      // Check if PBs table exists
      const pbsTableExists = await tableExists("kz_player_map_pbs");

      if (pbsTableExists) {
        const result = await getPlayerMapCompletions(steamid64, {
          mode: sanitizeString(mode, 32),
          stage: parseInt(stage, 10) || 0,
          validated:
            validated === "true" ? true : validated === "false" ? false : null,
          difficulty: difficulty ? parseInt(difficulty, 10) : null,
          completed: completed || null,
          filterByMode: filterByMode === "true",
        });

        // Check if player has any completions in PBs cache
        // If no completions found, fallback to querying kz_records_partitioned directly
        const hasCompletions =
          result.stats &&
          (result.stats.completed_pro > 0 ||
            result.stats.completed_tp_only > 0);

        if (hasCompletions) {
          return res.json({
            steamid64,
            mode,
            stage: parseInt(stage, 10) || 0,
            ...result,
          });
        }
        // No completions in PBs cache, fall through to kz_records_partitioned query
      }

      // Fallback: calculate on the fly
      const stageNum = parseInt(stage, 10) || 0;
      const modeStr = sanitizeString(mode, 32);
      const applyModeFilter = filterByMode === "true";

      let query = `
        SELECT 
          m.id as map_id,
          m.map_name,
          m.difficulty,
          m.validated,
          pb.pro_time,
          pb.pro_points,
          pb.tp_time,
          pb.tp_teleports,
          pb.tp_points,
          CASE 
            WHEN pb.pro_time IS NOT NULL THEN 'pro'
            WHEN pb.tp_time IS NOT NULL THEN 'tp'
            ELSE 'none'
          END as completion_status
        FROM kz_maps m
        LEFT JOIN (
          SELECT 
            map_id,
            MIN(CASE WHEN teleports = 0 THEN time END) as pro_time,
            MAX(CASE WHEN teleports = 0 THEN points END) as pro_points,
            MIN(CASE WHEN teleports > 0 THEN time END) as tp_time,
            MIN(CASE WHEN teleports > 0 THEN teleports END) as tp_teleports,
            MAX(CASE WHEN teleports > 0 THEN points END) as tp_points
          FROM kz_records_partitioned
          WHERE steamid64 = ? AND mode = ? AND stage = ?
          GROUP BY map_id
        ) pb ON m.id = pb.map_id
        WHERE 1=1
      `;
      const params = [steamid64, modeStr, stageNum];

      // Only apply mode filter if explicitly requested
      if (applyModeFilter) {
        query += `
          AND (
            NOT EXISTS (SELECT 1 FROM kz_map_mode_filters mmf WHERE mmf.map_id = m.id)
            OR EXISTS (SELECT 1 FROM kz_map_mode_filters mmf WHERE mmf.map_id = m.id AND mmf.mode = ?)
          )
        `;
        params.push(modeStr);
      }

      if (validated === "true") {
        query += " AND m.validated = TRUE";
      } else if (validated === "false") {
        query += " AND m.validated = FALSE";
      }

      if (difficulty) {
        query += " AND m.difficulty = ?";
        params.push(parseInt(difficulty, 10));
      }

      if (completed === "pro") {
        query += " AND pb.pro_time IS NOT NULL";
      } else if (completed === "tp") {
        query += " AND pb.tp_time IS NOT NULL AND pb.pro_time IS NULL";
      } else if (completed === "any") {
        query += " AND (pb.pro_time IS NOT NULL OR pb.tp_time IS NOT NULL)";
      } else if (completed === "none") {
        query += " AND pb.pro_time IS NULL AND pb.tp_time IS NULL";
      }

      query += " ORDER BY m.map_name ASC";
      const [maps] = await pool.query(query, params);
      const stats = computeCompletionStats(maps);

      res.json({
        steamid64,
        mode: modeStr,
        stage: stageNum,
        data: maps,
        stats,
      });
    } catch (error) {
      logger.error(
        `Failed to fetch completions for player ${req.params.steamid}: ${error.message}`,
      );
      res.status(500).json({ error: "Failed to fetch player completions" });
    }
  },
);

/**
 * @swagger
 * /global/players/{steamid}/refresh-pbs:
 *   post:
 *     summary: Force refresh player's PBs cache
 *     description: Triggers a refresh of the player's personal bests cache
 *     tags: [KZ Global]
 *     parameters:
 *       - in: path
 *         name: steamid
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: PBs refreshed successfully
 *       404:
 *         description: Player not found
 *       500:
 *         description: Server error
 */
/**
 * GET /global/players/:steamid/overview
 * Lightweight profile extras: global leaderboard rank (by total points) and
 * map-completion totals broken down by difficulty tier (1-7).
 */
router.get(
  "/:steamid/overview",
  cacheMiddleware(120, kzKeyGenerator),
  async (req, res) => {
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
      const [players] = await pool.query(
        "SELECT id FROM kz_players WHERE steamid64 = ?",
        [steamid64],
      );
      if (players.length === 0) {
        return res.status(404).json({ error: "Player not found" });
      }
      const playerId = players[0].id;

      // Global rank by total points
      let rank = null;
      let totalPlayers = null;
      let points = 0;
      if (await tableExists("kz_player_statistics")) {
        const [[me]] = await pool.query(
          "SELECT total_points FROM kz_player_statistics WHERE player_id = ?",
          [playerId],
        );
        points = me?.total_points || 0;
        if (points > 0) {
          const [[{ ahead }]] = await pool.query(
            "SELECT COUNT(*) AS ahead FROM kz_player_statistics WHERE total_points > ?",
            [points],
          );
          rank = ahead + 1;
        }
        const [[{ cnt }]] = await pool.query(
          "SELECT COUNT(*) AS cnt FROM kz_player_statistics WHERE total_points > 0",
        );
        totalPlayers = cnt;
      }

      // Completion totals + per-tier (any mode counts a map as completed)
      const [totals] = await pool.query(
        "SELECT difficulty AS tier, COUNT(*) AS total FROM kz_maps WHERE validated = 1 GROUP BY difficulty",
      );
      const [done] = await pool.query(
        `SELECT m.difficulty AS tier, COUNT(DISTINCT r.map_id) AS completed
         FROM kz_records_partitioned r
         JOIN kz_maps m ON r.map_id = m.id
         WHERE r.steamid64 = ? AND m.validated = 1
         GROUP BY m.difficulty`,
        [steamid64],
      );

      const doneByTier = new Map(done.map((d) => [d.tier, d.completed]));
      const byTier = totals
        .map((t) => ({
          tier: t.tier,
          total: t.total,
          completed: doneByTier.get(t.tier) || 0,
        }))
        .sort((a, b) => a.tier - b.tier);
      const totalMaps = byTier.reduce((n, t) => n + t.total, 0);
      const completedMaps = byTier.reduce((n, t) => n + t.completed, 0);

      res.json({
        steamid64,
        rank,
        totalPlayers,
        points,
        completion: {
          total: totalMaps,
          completed: completedMaps,
          percent: totalMaps
            ? Math.round((completedMaps / totalMaps) * 1000) / 10
            : 0,
          byTier,
        },
      });
    } catch (error) {
      logger.error(`KZ player overview error: ${error.message}`);
      res.status(500).json({ error: "Failed to fetch overview" });
    }
  },
);

router.post("/:steamid/refresh-pbs", async (req, res) => {
  try {
    const { steamid } = req.params;
    const pool = getKzPool();

    // Convert to SteamID64 if needed
    let steamid64 = steamid;
    if (!isValidSteamID(steamid)) {
      const converted = convertToSteamID64(steamid);
      if (!converted) {
        return res.status(400).json({ error: "Invalid SteamID format" });
      }
      steamid64 = converted;
    }

    // Get player ID
    const [players] = await pool.query(
      "SELECT id, player_name FROM kz_players WHERE steamid64 = ?",
      [steamid64],
    );

    if (players.length === 0) {
      return res.status(404).json({ error: "Player not found" });
    }

    const playerId = players[0].id;
    const playerName = players[0].player_name;

    // Check if PBs table exists
    const pbsTableExists = await tableExists("kz_player_map_pbs");
    if (!pbsTableExists) {
      return res.status(503).json({
        error: "PBs cache table not available",
        message: "Run the migration to create kz_player_map_pbs table",
      });
    }

    // Refresh PBs
    const pbCount = await refreshPlayerPBs(playerId);

    res.json({
      message: "PBs refreshed successfully",
      steamid64,
      player_name: playerName,
      pbs_count: pbCount,
    });
  } catch (error) {
    logger.error(
      `Failed to refresh PBs for player ${req.params.steamid}: ${error.message}`,
    );
    res.status(500).json({ error: "Failed to refresh player PBs" });
  }
});

// Helper function to check if a table exists
// information_schema lookups are slow and this is called on every request, so remember the answer.
// Missing tables are re-probed periodically so a migration lands without a restart.
const tableExistsCache = new Map();
const MISSING_TABLE_RECHECK_MS = 60_000;

async function tableExists(tableName) {
  const cached = tableExistsCache.get(tableName);
  if (
    cached &&
    (cached.exists || Date.now() - cached.checkedAt < MISSING_TABLE_RECHECK_MS)
  ) {
    return cached.exists;
  }

  try {
    const pool = getKzPool();
    const [result] = await pool.query(
      "SELECT COUNT(*) as count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?",
      [tableName],
    );
    const exists = result[0].count > 0;
    tableExistsCache.set(tableName, { exists, checkedAt: Date.now() });
    return exists;
  } catch (error) {
    // Not cached: the next request should retry.
    return false;
  }
}

module.exports = router;
// Exported for tests.
module.exports.tableExists = tableExists;
module.exports.resetTableExistsCache = () => tableExistsCache.clear();
