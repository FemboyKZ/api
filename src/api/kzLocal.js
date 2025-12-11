const express = require("express");
const router = express.Router();
const {
  getKzLocalCSGO128Pool,
  getKzLocalCSGO64Pool,
} = require("../db/kzLocal");
const {
  validatePagination,
  sanitizeString,
  isValidSteamID,
  convertToSteamID64,
} = require("../utils/validators");
const logger = require("../utils/logger");
const { cacheMiddleware, kzKeyGenerator } = require("../utils/cacheMiddleware");

// Constants for KZ modes and jump types
const KZ_MODES = {
  0: "vanilla",
  1: "simplekz",
  2: "kztimer",
};

const JUMP_TYPES = {
  0: "longjump",
  1: "bhop",
  2: "multibhop",
  3: "weirdjump",
  4: "dropbhop",
  5: "countjump",
  6: "ladderjump",
};

// AirStats AirType enum from more-stats plugin
// See: https://github.com/zer0k-z/more-stats/blob/main/addons/sourcemod/scripting/include/more-stats.inc
const AIR_TYPES = {
  0: "air_time", // Ticks spent in the air
  1: "strafes", // Strafe count in the air, determined by mouse movements
  2: "overlap", // Ticks with overlapped strafe keys (no acceleration)
  3: "dead_air", // Ticks with no strafe key pressed
  4: "bad_angles", // Ticks where air acceleration has no impact due to bad angles
  5: "air_accel_time", // Ticks gaining speed in the air (Sync2)
  6: "air_vel_change_time", // Ticks where air acceleration would have an impact on velocity (Sync3)
};

// BhopStats StatType1 enum from more-stats plugin
const BHOP_STAT_TYPES = {
  0: "bhop_ticks", // Ground ticks before jump (0-7 ticks, index in StatType2)
  1: "perf_streaks", // Consecutive perfect bhop streaks (1-24, index in StatType2)
  2: "scroll_efficiency", // Scroll stats: 0=registered, 1=fast, 2=slow, 3=timing_total, 4=timing_samples
  3: "strafe_count", // Strafe count during bhops
  4: "gokz_perf_count", // Total perfect bhops as counted by GOKZ
};

// ScrollEff sub-types for StatType1=2
const SCROLL_EFF_TYPES = {
  0: "registered_scrolls",
  1: "fast_scrolls",
  2: "slow_scrolls",
  3: "timing_total",
  4: "timing_samples",
};

/**
 * Helper to get pool based on tickrate parameter
 * @param {string} tickrate - "128" or "64"
 * @returns {object} Database pool
 */
function getPoolForTickrate(tickrate) {
  return tickrate === "64" ? getKzLocalCSGO64Pool() : getKzLocalCSGO128Pool();
}

/**
 * Convert SteamID32 to SteamID64
 * @param {number} steamid32 - SteamID32 (account ID)
 * @returns {string} SteamID64
 */
function steamid32To64(steamid32) {
  return (BigInt("76561197960265728") + BigInt(steamid32)).toString();
}

/**
 * Convert SteamID64 to SteamID32
 * @param {string} steamid64 - SteamID64
 * @returns {number} SteamID32
 */
function steamid64To32(steamid64) {
  return Number(BigInt(steamid64) - BigInt("76561197960265728"));
}

/**
 * Format runtime from MS to seconds
 * @param {number} runtime - Runtime in MS (1000 = 1 second)
 * @returns {number} Runtime in seconds
 */
function formatRuntime(runtime) {
  return runtime / 1000;
}

/**
 * Format distance from units to readable value
 * @param {number} distance - Distance in units (10000 = 1.0)
 * @returns {number} Distance value
 */
function formatDistance(distance) {
  return distance / 10000;
}

/**
 * Format js stats from raw to readable value
 * @param {number} value - Raw stat value (sync, pre, max)
 * @returns {number} Formatted stat value
 */
function formatStat(value) {
  return value / 100;
}

// ==================== MAPS ENDPOINTS ====================

/**
 * @swagger
 * /kzlocal/maps:
 *   get:
 *     summary: Get KZ local maps
 *     description: Returns a paginated list of maps from local KZ servers
 *     tags: [KZ Local]
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
 *         name: tickrate
 *         schema:
 *           type: string
 *           enum: ["128", "64"]
 *           default: "128"
 *         description: Server tickrate
 *       - in: query
 *         name: ranked
 *         schema:
 *           type: boolean
 *         description: Filter by ranked status
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           enum: [name, last_played, created, records]
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
router.get("/maps", cacheMiddleware(60, kzKeyGenerator), async (req, res) => {
  try {
    const { page, limit, name, tickrate, ranked, sort, order } = req.query;
    const { limit: validLimit, offset } = validatePagination(page, limit, 100);

    const pool = getPoolForTickrate(tickrate);

    const validSortFields = ["name", "last_played", "created", "records"];
    const sortFieldMap = {
      name: "m.Name",
      last_played: "m.LastPlayed",
      created: "m.Created",
      records: "records_count",
    };
    const sortField = validSortFields.includes(sort) ? sort : "name";
    const sortOrder = order === "desc" ? "DESC" : "ASC";

    let query = `
      SELECT 
        m.MapID as id,
        m.Name as name,
        m.LastPlayed as last_played,
        m.Created as created,
        m.InRankedPool as in_ranked_pool,
        COUNT(DISTINCT mc.MapCourseID) as courses_count,
        COUNT(DISTINCT t.TimeID) as records_count
      FROM Maps m
      LEFT JOIN MapCourses mc ON m.MapID = mc.MapID
      LEFT JOIN Times t ON mc.MapCourseID = t.MapCourseID
      WHERE 1=1
    `;

    const params = [];

    if (name) {
      query += " AND m.Name LIKE ?";
      params.push(`%${sanitizeString(name)}%`);
    }

    if (ranked !== undefined) {
      query += " AND m.InRankedPool = ?";
      params.push(ranked === "true" || ranked === "1" ? 1 : 0);
    }

    query += ` GROUP BY m.MapID, m.Name, m.LastPlayed, m.Created, m.InRankedPool`;
    query += ` ORDER BY ${sortFieldMap[sortField]} ${sortOrder}`;
    query += ` LIMIT ? OFFSET ?`;
    params.push(validLimit, offset);

    const [rows] = await pool.query(query, params);

    // Get total count
    let countQuery = `SELECT COUNT(*) as total FROM Maps m WHERE 1=1`;
    const countParams = [];

    if (name) {
      countQuery += " AND m.Name LIKE ?";
      countParams.push(`%${sanitizeString(name)}%`);
    }

    if (ranked !== undefined) {
      countQuery += " AND m.InRankedPool = ?";
      countParams.push(ranked === "true" || ranked === "1" ? 1 : 0);
    }

    const [[{ total }]] = await pool.query(countQuery, countParams);

    res.json({
      data: rows.map((row) => ({
        id: row.id,
        name: row.name,
        last_played: row.last_played,
        created: row.created,
        in_ranked_pool: row.in_ranked_pool === 1,
        courses_count: row.courses_count,
        records_count: row.records_count,
        tickrate: tickrate === "64" ? 64 : 128,
      })),
      pagination: {
        page: parseInt(page, 10) || 1,
        limit: validLimit,
        total,
        totalPages: Math.ceil(total / validLimit),
      },
    });
  } catch (error) {
    logger.error(`Error fetching KZ local maps: ${error.message}`);
    res.status(500).json({ error: "Failed to fetch maps" });
  }
});

/**
 * @swagger
 * /kzlocal/maps/{mapname}:
 *   get:
 *     summary: Get specific KZ local map details
 *     description: Returns detailed information about a specific map
 *     tags: [KZ Local]
 *     parameters:
 *       - in: path
 *         name: mapname
 *         required: true
 *         schema:
 *           type: string
 *         description: Map name
 *       - in: query
 *         name: tickrate
 *         schema:
 *           type: string
 *           enum: ["128", "64"]
 *           default: "128"
 *     responses:
 *       200:
 *         description: Map details
 *       404:
 *         description: Map not found
 *       500:
 *         description: Server error
 */
router.get(
  "/maps/:mapname",
  cacheMiddleware(60, kzKeyGenerator),
  async (req, res) => {
    try {
      const { mapname } = req.params;
      const { tickrate } = req.query;
      const pool = getPoolForTickrate(tickrate);

      // Get map info
      const [maps] = await pool.query(
        `SELECT 
        m.MapID as id,
        m.Name as name,
        m.LastPlayed as last_played,
        m.Created as created,
        m.InRankedPool as in_ranked_pool
      FROM Maps m
      WHERE m.Name = ?`,
        [sanitizeString(mapname)]
      );

      if (maps.length === 0) {
        return res.status(404).json({ error: "Map not found" });
      }

      const map = maps[0];

      // Get courses with mode statistics per course
      const [courses] = await pool.query(
        `SELECT 
        mc.MapCourseID as id,
        mc.Course as course,
        mc.Created as created,
        COUNT(t.TimeID) as records_count
      FROM MapCourses mc
      LEFT JOIN Times t ON mc.MapCourseID = t.MapCourseID
      WHERE mc.MapID = ?
      GROUP BY mc.MapCourseID, mc.Course, mc.Created
      ORDER BY mc.Course`,
        [map.id]
      );

      // Get mode statistics per course
      const [modeStats] = await pool.query(
        `SELECT 
        mc.Course as course,
        t.Mode as mode,
        COUNT(*) as count,
        MIN(t.RunTime) as best_time
      FROM Times t
      JOIN MapCourses mc ON t.MapCourseID = mc.MapCourseID
      WHERE mc.MapID = ?
      GROUP BY mc.Course, t.Mode
      ORDER BY mc.Course, t.Mode`,
        [map.id]
      );

      // Group mode stats by course
      const modeStatsByCourse = {};
      for (const stat of modeStats) {
        if (!modeStatsByCourse[stat.course]) {
          modeStatsByCourse[stat.course] = [];
        }
        modeStatsByCourse[stat.course].push({
          mode: KZ_MODES[stat.mode] || `mode_${stat.mode}`,
          mode_id: stat.mode,
          records_count: stat.count,
          best_time: formatRuntime(stat.best_time),
        });
      }

      res.json({
        id: map.id,
        name: map.name,
        last_played: map.last_played,
        created: map.created,
        in_ranked_pool: map.in_ranked_pool === 1,
        tickrate: tickrate === "64" ? 64 : 128,
        courses: courses.map((c) => ({
          id: c.id,
          course: c.course,
          created: c.created,
          records_count: c.records_count,
          mode_statistics: modeStatsByCourse[c.course] || [],
        })),
      });
    } catch (error) {
      logger.error(`Error fetching KZ local map: ${error.message}`);
      res.status(500).json({ error: "Failed to fetch map" });
    }
  }
);

// ==================== RECORDS/TIMES ENDPOINTS ====================

/**
 * @swagger
 * /kzlocal/records:
 *   get:
 *     summary: Get KZ local records
 *     description: Returns a paginated list of time records
 *     tags: [KZ Local]
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
 *         name: tickrate
 *         schema:
 *           type: string
 *           enum: ["128", "64"]
 *           default: "128"
 *       - in: query
 *         name: map
 *         schema:
 *           type: string
 *         description: Filter by map name
 *       - in: query
 *         name: player
 *         schema:
 *           type: string
 *         description: Filter by player SteamID or name
 *       - in: query
 *         name: mode
 *         schema:
 *           type: integer
 *           enum: [0, 1, 2]
 *         description: Filter by mode (0=vanilla, 1=simple, 2=timer)
 *       - in: query
 *         name: course
 *         schema:
 *           type: integer
 *         description: Filter by course number
 *       - in: query
 *         name: teleports
 *         schema:
 *           type: string
 *           enum: [tp, pro]
 *         description: Filter by teleport usage (tp = with teleports, pro = no teleports)
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           enum: [time, created]
 *           default: created
 *       - in: query
 *         name: order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *     responses:
 *       200:
 *         description: Successful response with records list
 *       500:
 *         description: Server error
 */
router.get(
  "/records",
  cacheMiddleware(60, kzKeyGenerator),
  async (req, res) => {
    try {
      const {
        page,
        limit,
        tickrate,
        map,
        player,
        mode,
        course,
        teleports,
        sort,
        order,
      } = req.query;
      const { limit: validLimit, offset } = validatePagination(
        page,
        limit,
        100
      );

      const pool = getPoolForTickrate(tickrate);

      const validSortFields = ["time", "created"];
      const sortFieldMap = {
        time: "t.RunTime",
        created: "t.Created",
      };
      const sortField = validSortFields.includes(sort) ? sort : "created";
      const sortOrder = order === "asc" ? "ASC" : "DESC";

      let query = `
      SELECT 
        t.TimeID as id,
        t.SteamID32 as steamid32,
        p.Alias as player_name,
        m.Name as map_name,
        m.MapID as map_id,
        mc.Course as course,
        t.Mode as mode,
        t.Style as style,
        t.RunTime as run_time,
        t.Teleports as teleports,
        t.Created as created,
        t.TimeGUID as time_guid
      FROM Times t
      JOIN Players p ON t.SteamID32 = p.SteamID32
      JOIN MapCourses mc ON t.MapCourseID = mc.MapCourseID
      JOIN Maps m ON mc.MapID = m.MapID
      WHERE 1=1
    `;

      const params = [];

      if (map) {
        query += " AND m.Name LIKE ?";
        params.push(`%${sanitizeString(map)}%`);
      }

      if (player) {
        // Check if it's a SteamID
        if (isValidSteamID(player)) {
          const steamid64 = convertToSteamID64(player);
          if (steamid64) {
            const steamid32 = steamid64To32(steamid64);
            query += " AND t.SteamID32 = ?";
            params.push(steamid32);
          }
        } else {
          query += " AND p.Alias LIKE ?";
          params.push(`%${sanitizeString(player)}%`);
        }
      }

      if (mode !== undefined) {
        query += " AND t.Mode = ?";
        params.push(parseInt(mode, 10));
      }

      if (course !== undefined) {
        query += " AND mc.Course = ?";
        params.push(parseInt(course, 10));
      }

      if (teleports === "pro") {
        query += " AND t.Teleports = 0";
      } else if (teleports === "tp") {
        query += " AND t.Teleports > 0";
      }

      query += ` ORDER BY ${sortFieldMap[sortField]} ${sortOrder}`;
      query += ` LIMIT ? OFFSET ?`;
      params.push(validLimit, offset);

      const [rows] = await pool.query(query, params);

      // Get total count
      let countQuery = `
      SELECT COUNT(*) as total
      FROM Times t
      JOIN Players p ON t.SteamID32 = p.SteamID32
      JOIN MapCourses mc ON t.MapCourseID = mc.MapCourseID
      JOIN Maps m ON mc.MapID = m.MapID
      WHERE 1=1
    `;
      const countParams = [];

      if (map) {
        countQuery += " AND m.Name LIKE ?";
        countParams.push(`%${sanitizeString(map)}%`);
      }

      if (player) {
        if (isValidSteamID(player)) {
          const steamid64 = convertToSteamID64(player);
          if (steamid64) {
            const steamid32 = steamid64To32(steamid64);
            countQuery += " AND t.SteamID32 = ?";
            countParams.push(steamid32);
          }
        } else {
          countQuery += " AND p.Alias LIKE ?";
          countParams.push(`%${sanitizeString(player)}%`);
        }
      }

      if (mode !== undefined) {
        countQuery += " AND t.Mode = ?";
        countParams.push(parseInt(mode, 10));
      }

      if (course !== undefined) {
        countQuery += " AND mc.Course = ?";
        countParams.push(parseInt(course, 10));
      }

      if (teleports === "pro") {
        countQuery += " AND t.Teleports = 0";
      } else if (teleports === "tp") {
        countQuery += " AND t.Teleports > 0";
      }

      const [[{ total }]] = await pool.query(countQuery, countParams);

      res.json({
        data: rows.map((row) => ({
          id: row.id,
          steamid64: steamid32To64(row.steamid32),
          player_name: row.player_name,
          map_name: row.map_name,
          map_id: row.map_id,
          course: row.course,
          mode: KZ_MODES[row.mode] || `mode_${row.mode}`,
          mode_id: row.mode,
          style: row.style,
          time: formatRuntime(row.run_time),
          teleports: row.teleports,
          created: row.created,
          time_guid: row.time_guid,
          tickrate: tickrate === "64" ? 64 : 128,
        })),
        pagination: {
          page: parseInt(page, 10) || 1,
          limit: validLimit,
          total,
          totalPages: Math.ceil(total / validLimit),
        },
      });
    } catch (error) {
      logger.error(`Error fetching KZ local records: ${error.message}`);
      res.status(500).json({ error: "Failed to fetch records" });
    }
  }
);

/**
 * @swagger
 * /kzlocal/records/{id}:
 *   get:
 *     summary: Get specific KZ local record
 *     description: Returns details of a specific time record
 *     tags: [KZ Local]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Record ID
 *       - in: query
 *         name: tickrate
 *         schema:
 *           type: string
 *           enum: ["128", "64"]
 *           default: "128"
 *     responses:
 *       200:
 *         description: Record details
 *       404:
 *         description: Record not found
 *       500:
 *         description: Server error
 */
router.get(
  "/records/:id",
  cacheMiddleware(60, kzKeyGenerator),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { tickrate } = req.query;
      const pool = getPoolForTickrate(tickrate);

      const [records] = await pool.query(
        `SELECT 
        t.TimeID as id,
        t.SteamID32 as steamid32,
        p.Alias as player_name,
        p.Country as player_country,
        m.Name as map_name,
        m.MapID as map_id,
        mc.Course as course,
        mc.MapCourseID as map_course_id,
        t.Mode as mode,
        t.Style as style,
        t.RunTime as run_time,
        t.Teleports as teleports,
        t.Created as created,
        t.TimeGUID as time_guid
      FROM Times t
      JOIN Players p ON t.SteamID32 = p.SteamID32
      JOIN MapCourses mc ON t.MapCourseID = mc.MapCourseID
      JOIN Maps m ON mc.MapID = m.MapID
      WHERE t.TimeID = ?`,
        [parseInt(id, 10)]
      );

      if (records.length === 0) {
        return res.status(404).json({ error: "Record not found" });
      }

      const record = records[0];

      res.json({
        id: record.id,
        steamid64: steamid32To64(record.steamid32),
        player_name: record.player_name,
        player_country: record.player_country,
        map_name: record.map_name,
        map_id: record.map_id,
        course: record.course,
        map_course_id: record.map_course_id,
        mode: KZ_MODES[record.mode] || `mode_${record.mode}`,
        mode_id: record.mode,
        style: record.style,
        time: formatRuntime(record.run_time),
        teleports: record.teleports,
        created: record.created,
        time_guid: record.time_guid,
        tickrate: tickrate === "64" ? 64 : 128,
      });
    } catch (error) {
      logger.error(`Error fetching KZ local record: ${error.message}`);
      res.status(500).json({ error: "Failed to fetch record" });
    }
  }
);

// ==================== JUMPSTATS ENDPOINTS ====================

/**
 * @swagger
 * /kzlocal/jumpstats:
 *   get:
 *     summary: Get KZ local jumpstats
 *     description: Returns a paginated list of jumpstat records
 *     tags: [KZ Local]
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
 *         name: tickrate
 *         schema:
 *           type: string
 *           enum: ["128", "64"]
 *           default: "128"
 *       - in: query
 *         name: player
 *         schema:
 *           type: string
 *         description: Filter by player SteamID or name
 *       - in: query
 *         name: jump_type
 *         schema:
 *           type: integer
 *           enum: [0, 1, 2, 3, 4, 5, 6]
 *         description: Jump type (0=longjump, 1=bhop, 2=multibhop, etc.)
 *       - in: query
 *         name: mode
 *         schema:
 *           type: integer
 *           enum: [0, 1, 2]
 *         description: Mode (0=vanilla, 1=simple, 2=timer)
 *       - in: query
 *         name: is_block
 *         schema:
 *           type: boolean
 *         description: Filter by block jump status
 *       - in: query
 *         name: min_distance
 *         schema:
 *           type: number
 *         description: Minimum distance filter
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           enum: [distance, created]
 *           default: distance
 *       - in: query
 *         name: order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *     responses:
 *       200:
 *         description: Successful response with jumpstats list
 *       500:
 *         description: Server error
 */
router.get(
  "/jumpstats",
  cacheMiddleware(60, kzKeyGenerator),
  async (req, res) => {
    try {
      const {
        page,
        limit,
        tickrate,
        player,
        jump_type,
        mode,
        is_block,
        min_distance,
        sort,
        order,
      } = req.query;
      const { limit: validLimit, offset } = validatePagination(
        page,
        limit,
        100
      );

      const pool = getPoolForTickrate(tickrate);

      const validSortFields = ["distance", "created"];
      const sortFieldMap = {
        distance: "j.Distance",
        created: "j.Created",
      };
      const sortField = validSortFields.includes(sort) ? sort : "distance";
      const sortOrder = order === "asc" ? "ASC" : "DESC";

      let query = `
      SELECT 
        j.JumpID as id,
        j.SteamID32 as steamid32,
        p.Alias as player_name,
        j.JumpType as jump_type,
        j.Mode as mode,
        j.Distance as distance,
        j.IsBlockJump as is_block_jump,
        j.Block as block,
        j.Strafes as strafes,
        j.Sync as sync,
        j.Pre as pre,
        j.Max as max,
        j.Airtime as airtime,
        j.Created as created
      FROM Jumpstats j
      JOIN Players p ON j.SteamID32 = p.SteamID32
      WHERE 1=1
    `;

      const params = [];

      if (player) {
        if (isValidSteamID(player)) {
          const steamid64 = convertToSteamID64(player);
          if (steamid64) {
            const steamid32 = steamid64To32(steamid64);
            query += " AND j.SteamID32 = ?";
            params.push(steamid32);
          }
        } else {
          query += " AND p.Alias LIKE ?";
          params.push(`%${sanitizeString(player)}%`);
        }
      }

      if (jump_type !== undefined) {
        query += " AND j.JumpType = ?";
        params.push(parseInt(jump_type, 10));
      }

      if (mode !== undefined) {
        query += " AND j.Mode = ?";
        params.push(parseInt(mode, 10));
      }

      if (is_block !== undefined) {
        query += " AND j.IsBlockJump = ?";
        params.push(is_block === "true" || is_block === "1" ? 1 : 0);
      }

      if (min_distance) {
        query += " AND j.Distance >= ?";
        params.push(parseFloat(min_distance) * 10000);
      }

      query += ` ORDER BY ${sortFieldMap[sortField]} ${sortOrder}`;
      query += ` LIMIT ? OFFSET ?`;
      params.push(validLimit, offset);

      const [rows] = await pool.query(query, params);

      // Get total count
      let countQuery = `
      SELECT COUNT(*) as total
      FROM Jumpstats j
      JOIN Players p ON j.SteamID32 = p.SteamID32
      WHERE 1=1
    `;
      const countParams = [];

      if (player) {
        if (isValidSteamID(player)) {
          const steamid64 = convertToSteamID64(player);
          if (steamid64) {
            const steamid32 = steamid64To32(steamid64);
            countQuery += " AND j.SteamID32 = ?";
            countParams.push(steamid32);
          }
        } else {
          countQuery += " AND p.Alias LIKE ?";
          countParams.push(`%${sanitizeString(player)}%`);
        }
      }

      if (jump_type !== undefined) {
        countQuery += " AND j.JumpType = ?";
        countParams.push(parseInt(jump_type, 10));
      }

      if (mode !== undefined) {
        countQuery += " AND j.Mode = ?";
        countParams.push(parseInt(mode, 10));
      }

      if (is_block !== undefined) {
        countQuery += " AND j.IsBlockJump = ?";
        countParams.push(is_block === "true" || is_block === "1" ? 1 : 0);
      }

      if (min_distance) {
        countQuery += " AND j.Distance >= ?";
        countParams.push(parseFloat(min_distance) * 10000);
      }

      const [[{ total }]] = await pool.query(countQuery, countParams);

      res.json({
        data: rows.map((row) => ({
          id: row.id,
          steamid64: steamid32To64(row.steamid32),
          player_name: row.player_name,
          jump_type: JUMP_TYPES[row.jump_type] || `type_${row.jump_type}`,
          jump_type_id: row.jump_type,
          mode: KZ_MODES[row.mode] || `mode_${row.mode}`,
          mode_id: row.mode,
          distance: formatDistance(row.distance),
          is_block_jump: row.is_block_jump === 1,
          block: row.block,
          strafes: row.strafes,
          sync: formatStat(row.sync),
          pre: formatStat(row.pre),
          max: formatStat(row.max),
          airtime: row.airtime,
          created: row.created,
          tickrate: tickrate === "64" ? 64 : 128,
        })),
        pagination: {
          page: parseInt(page, 10) || 1,
          limit: validLimit,
          total,
          totalPages: Math.ceil(total / validLimit),
        },
      });
    } catch (error) {
      logger.error(`Error fetching KZ local jumpstats: ${error.message}`);
      res.status(500).json({ error: "Failed to fetch jumpstats" });
    }
  }
);

/**
 * @swagger
 * /kzlocal/jumpstats/{id}:
 *   get:
 *     summary: Get specific KZ local jumpstat
 *     description: Returns details of a specific jumpstat record
 *     tags: [KZ Local]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Jumpstat ID
 *       - in: query
 *         name: tickrate
 *         schema:
 *           type: string
 *           enum: ["128", "64"]
 *           default: "128"
 *     responses:
 *       200:
 *         description: Jumpstat details
 *       404:
 *         description: Jumpstat not found
 *       500:
 *         description: Server error
 */
router.get(
  "/jumpstats/:id",
  cacheMiddleware(60, kzKeyGenerator),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { tickrate } = req.query;
      const pool = getPoolForTickrate(tickrate);

      const [jumpstats] = await pool.query(
        `SELECT 
        j.JumpID as id,
        j.SteamID32 as steamid32,
        p.Alias as player_name,
        p.Country as player_country,
        j.JumpType as jump_type,
        j.Mode as mode,
        j.Distance as distance,
        j.IsBlockJump as is_block_jump,
        j.Block as block,
        j.Strafes as strafes,
        j.Sync as sync,
        j.Pre as pre,
        j.Max as max,
        j.Airtime as airtime,
        j.Created as created
      FROM Jumpstats j
      JOIN Players p ON j.SteamID32 = p.SteamID32
      WHERE j.JumpID = ?`,
        [parseInt(id, 10)]
      );

      if (jumpstats.length === 0) {
        return res.status(404).json({ error: "Jumpstat not found" });
      }

      const jump = jumpstats[0];

      res.json({
        id: jump.id,
        steamid64: steamid32To64(jump.steamid32),
        player_name: jump.player_name,
        player_country: jump.player_country,
        jump_type: JUMP_TYPES[jump.jump_type] || `type_${jump.jump_type}`,
        jump_type_id: jump.jump_type,
        mode: KZ_MODES[jump.mode] || `mode_${jump.mode}`,
        mode_id: jump.mode,
        distance: formatDistance(jump.distance),
        is_block_jump: jump.is_block_jump === 1,
        block: jump.block,
        strafes: jump.strafes,
        sync: formatStat(jump.sync),
        pre: formatStat(jump.pre),
        max: formatStat(jump.max),
        airtime: jump.airtime,
        created: jump.created,
        tickrate: tickrate === "64" ? 64 : 128,
      });
    } catch (error) {
      logger.error(`Error fetching KZ local jumpstat: ${error.message}`);
      res.status(500).json({ error: "Failed to fetch jumpstat" });
    }
  }
);

// ==================== PLAYERS ENDPOINTS ====================

/**
 * @swagger
 * /kzlocal/players:
 *   get:
 *     summary: Get KZ local players
 *     description: Returns a paginated list of players with statistics
 *     tags: [KZ Local]
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
 *         name: tickrate
 *         schema:
 *           type: string
 *           enum: ["128", "64"]
 *           default: "128"
 *       - in: query
 *         name: name
 *         schema:
 *           type: string
 *         description: Filter by player name
 *       - in: query
 *         name: country
 *         schema:
 *           type: string
 *         description: Filter by country
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           enum: [records, jumpstats, last_played, name]
 *           default: records
 *       - in: query
 *         name: order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *     responses:
 *       200:
 *         description: Successful response with players list
 *       500:
 *         description: Server error
 */
router.get(
  "/players",
  cacheMiddleware(60, kzKeyGenerator),
  async (req, res) => {
    try {
      const { page, limit, tickrate, name, country, sort, order } = req.query;
      const { limit: validLimit, offset } = validatePagination(
        page,
        limit,
        100
      );

      const pool = getPoolForTickrate(tickrate);

      const validSortFields = ["records", "jumpstats", "last_played", "name"];
      const sortFieldMap = {
        records: "records_count",
        jumpstats: "jumpstats_count",
        last_played: "p.LastPlayed",
        name: "p.Alias",
      };
      const sortField = validSortFields.includes(sort) ? sort : "records";
      const sortOrder = order === "asc" ? "ASC" : "DESC";

      let query = `
      SELECT 
        p.SteamID32 as steamid32,
        p.Alias as alias,
        p.Country as country,
        p.Cheater as cheater,
        p.LastPlayed as last_played,
        p.Created as created,
        COUNT(DISTINCT t.TimeID) as records_count,
        COUNT(DISTINCT j.JumpID) as jumpstats_count
      FROM Players p
      LEFT JOIN Times t ON p.SteamID32 = t.SteamID32
      LEFT JOIN Jumpstats j ON p.SteamID32 = j.SteamID32
      WHERE 1=1
    `;

      const params = [];

      if (name) {
        query += " AND p.Alias LIKE ?";
        params.push(`%${sanitizeString(name)}%`);
      }

      if (country) {
        query += " AND p.Country LIKE ?";
        params.push(`%${sanitizeString(country)}%`);
      }

      query += ` GROUP BY p.SteamID32, p.Alias, p.Country, p.Cheater, p.LastPlayed, p.Created`;
      query += ` ORDER BY ${sortFieldMap[sortField]} ${sortOrder}`;
      query += ` LIMIT ? OFFSET ?`;
      params.push(validLimit, offset);

      const [rows] = await pool.query(query, params);

      // Get total count
      let countQuery = `SELECT COUNT(*) as total FROM Players p WHERE 1=1`;
      const countParams = [];

      if (name) {
        countQuery += " AND p.Alias LIKE ?";
        countParams.push(`%${sanitizeString(name)}%`);
      }

      if (country) {
        countQuery += " AND p.Country LIKE ?";
        countParams.push(`%${sanitizeString(country)}%`);
      }

      const [[{ total }]] = await pool.query(countQuery, countParams);

      res.json({
        data: rows.map((row) => ({
          steamid64: steamid32To64(row.steamid32),
          name: row.alias,
          country: row.country,
          is_cheater: row.cheater === 1,
          last_played: row.last_played,
          created: row.created,
          records_count: row.records_count,
          jumpstats_count: row.jumpstats_count,
          tickrate: tickrate === "64" ? 64 : 128,
        })),
        pagination: {
          page: parseInt(page, 10) || 1,
          limit: validLimit,
          total,
          totalPages: Math.ceil(total / validLimit),
        },
      });
    } catch (error) {
      logger.error(`Error fetching KZ local players: ${error.message}`);
      res.status(500).json({ error: "Failed to fetch players" });
    }
  }
);

/**
 * @swagger
 * /kzlocal/players/{player}:
 *   get:
 *     summary: Get specific KZ local player
 *     description: Returns detailed player profile with statistics including air/bhop stats
 *     tags: [KZ Local]
 *     parameters:
 *       - in: path
 *         name: player
 *         required: true
 *         schema:
 *           type: string
 *         description: Player SteamID64 or SteamID32
 *       - in: query
 *         name: tickrate
 *         schema:
 *           type: string
 *           enum: ["128", "64"]
 *           default: "128"
 *     responses:
 *       200:
 *         description: Player profile with full statistics
 *       404:
 *         description: Player not found
 *       500:
 *         description: Server error
 */
router.get(
  "/players/:player",
  cacheMiddleware(60, kzKeyGenerator),
  async (req, res) => {
    try {
      const { player } = req.params;
      const { tickrate } = req.query;
      const pool = getPoolForTickrate(tickrate);

      // Determine steamid32
      let steamid32;
      if (isValidSteamID(player)) {
        const steamid64 = convertToSteamID64(player);
        if (steamid64) {
          steamid32 = steamid64To32(steamid64);
        }
      } else if (/^\d+$/.test(player)) {
        // Could be a direct steamid32
        steamid32 = parseInt(player, 10);
      }

      if (!steamid32) {
        return res.status(400).json({ error: "Invalid player identifier" });
      }

      // Get player info
      const [players] = await pool.query(
        `SELECT 
        p.SteamID32 as steamid32,
        p.Alias as alias,
        p.Country as country,
        p.Cheater as cheater,
        p.LastPlayed as last_played,
        p.Created as created
      FROM Players p
      WHERE p.SteamID32 = ?`,
        [steamid32]
      );

      if (players.length === 0) {
        return res.status(404).json({ error: "Player not found" });
      }

      const playerData = players[0];

      // Get records statistics by mode
      const [recordStats] = await pool.query(
        `SELECT 
        t.Mode as mode,
        COUNT(*) as total_records,
        SUM(CASE WHEN t.Teleports = 0 THEN 1 ELSE 0 END) as pro_records,
        SUM(CASE WHEN t.Teleports > 0 THEN 1 ELSE 0 END) as tp_records,
        MIN(t.Created) as first_record,
        MAX(t.Created) as last_record
      FROM Times t
      WHERE t.SteamID32 = ?
      GROUP BY t.Mode`,
        [steamid32]
      );

      // Get jumpstats statistics by type
      const [jumpStats] = await pool.query(
        `SELECT 
        j.JumpType as jump_type,
        j.Mode as mode,
        COUNT(*) as total,
        MAX(j.Distance) as best_distance,
        AVG(j.Distance) as avg_distance
      FROM Jumpstats j
      WHERE j.SteamID32 = ?
      GROUP BY j.JumpType, j.Mode`,
        [steamid32]
      );

      // Get air stats
      const [airStats] = await pool.query(
        `SELECT 
        Mode as mode,
        AirType as air_type,
        Count as count
      FROM AirStats
      WHERE SteamID32 = ?`,
        [steamid32]
      );

      // Get bhop stats
      const [bhopStats] = await pool.query(
        `SELECT 
        Mode as mode,
        StatType1 as stat_type1,
        StatType2 as stat_type2,
        StatCount as count
      FROM BhopStats
      WHERE SteamID32 = ?`,
        [steamid32]
      );

      res.json({
        steamid64: steamid32To64(playerData.steamid32),
        steamid32: playerData.steamid32,
        name: playerData.alias,
        country: playerData.country,
        is_cheater: playerData.cheater === 1,
        last_played: playerData.last_played,
        created: playerData.created,
        tickrate: tickrate === "64" ? 64 : 128,
        records_statistics: recordStats.map((s) => ({
          mode: KZ_MODES[s.mode] || `mode_${s.mode}`,
          mode_id: s.mode,
          total_records: s.total_records,
          pro_records: s.pro_records,
          tp_records: s.tp_records,
          first_record: s.first_record,
          last_record: s.last_record,
        })),
        jumpstats_statistics: jumpStats.map((s) => ({
          jump_type: JUMP_TYPES[s.jump_type] || `type_${s.jump_type}`,
          jump_type_id: s.jump_type,
          mode: KZ_MODES[s.mode] || `mode_${s.mode}`,
          mode_id: s.mode,
          total: s.total,
          best_distance: formatDistance(s.best_distance),
          avg_distance: formatDistance(s.avg_distance),
        })),
        air_stats: airStats.map((s) => ({
          mode: KZ_MODES[s.mode] || `mode_${s.mode}`,
          mode_id: s.mode,
          air_type: AIR_TYPES[s.air_type] || `type_${s.air_type}`,
          air_type_id: s.air_type,
          count: s.count,
        })),
        bhop_stats: bhopStats.map((s) => ({
          mode: KZ_MODES[s.mode] || `mode_${s.mode}`,
          mode_id: s.mode,
          stat_type: BHOP_STAT_TYPES[s.stat_type1] || `type_${s.stat_type1}`,
          stat_type_id: s.stat_type1,
          // For bhop_ticks: index 0-7 = ground ticks before jump
          // For perf_streaks: index 1-24 = consecutive perfs
          // For scroll_efficiency: index 0-4 = scroll sub-type
          stat_index: s.stat_type2,
          stat_index_label:
            s.stat_type1 === 0
              ? `tick_${s.stat_type2}`
              : s.stat_type1 === 1
                ? `streak_${s.stat_type2 + 1}`
                : s.stat_type1 === 2
                  ? SCROLL_EFF_TYPES[s.stat_type2] || `scroll_${s.stat_type2}`
                  : null,
          count: s.count,
        })),
      });
    } catch (error) {
      logger.error(`Error fetching KZ local player: ${error.message}`);
      res.status(500).json({ error: "Failed to fetch player" });
    }
  }
);

module.exports = router;
