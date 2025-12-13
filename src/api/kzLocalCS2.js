const express = require("express");
const router = express.Router();
const { getKzLocalCS2Pool } = require("../db/kzLocal");
const {
  validatePagination,
  sanitizeString,
  isValidSteamID,
  convertToSteamID64,
} = require("../utils/validators");
const logger = require("../utils/logger");
const { cacheMiddleware, kzKeyGenerator } = require("../utils/cacheMiddleware");

// CS2KZ Modes (from Modes table, but these are the standard ones)
const CS2_MODES = {
  1: "classic",
  2: "vanilla",
};

// CS2KZ Jump Types
const CS2_JUMP_TYPES = {
  0: "longjump",
  1: "bhop",
  2: "multibhop",
  3: "weirdjump",
  4: "dropbhop",
  5: "countjump",
  6: "ladderjump",
};

/**
 * Get database pool
 * @returns {object} Database pool
 */
function getPool() {
  return getKzLocalCS2Pool();
}

/**
 * Format runtime from seconds (DOUBLE) to readable format
 * CS2KZ stores RunTime as DOUBLE in seconds
 * @param {number} runtime - Runtime in seconds
 * @returns {number} Runtime in seconds (already correct format)
 */
function formatRuntime(runtime) {
  return runtime;
}

/**
 * Format distance from units to readable value
 * CS2KZ stores distance as INTEGER (distance * 10000)
 * @param {number} distance - Distance in units
 * @returns {number} Distance value
 */
function formatDistance(distance) {
  return distance / 10000;
}

/**
 * Format jumpstat values (sync, pre, max)
 * CS2KZ stores these as INTEGER (value * 100)
 * @param {number} value - Raw stat value
 * @returns {number} Formatted stat value
 */
function formatStat(value) {
  return value / 100;
}

/**
 * Format airtime from ticks to seconds
 * @param {number} airtime - Airtime in ticks
 * @returns {number} Airtime in seconds (assuming 64 tick)
 */
function formatAirtime(airtime) {
  return airtime / 64;
}

// ==================== PLAYERS ENDPOINTS ====================

/**
 * @swagger
 * /kzlocal-cs2/players:
 *   get:
 *     summary: Get CS2 KZ local players
 *     description: Returns a paginated list of players from local CS2 KZ servers
 *     tags: [KZ Local CS2]
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
 *         description: Filter by player name (partial match)
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           enum: [name, last_played, created, records]
 *           default: last_played
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
      const { page, limit, name, sort, order } = req.query;
      const { limit: validLimit, offset } = validatePagination(
        page,
        limit,
        100,
      );

      const pool = getPool();

      const validSortFields = ["name", "last_played", "created", "records"];
      const sortFieldMap = {
        name: "p.Alias",
        last_played: "p.LastPlayed",
        created: "p.Created",
        records: "records_count",
      };
      const sortField = validSortFields.includes(sort) ? sort : "last_played";
      const sortOrder = order === "asc" ? "ASC" : "DESC";

      let query = `
      SELECT 
        p.SteamID64 as steamid64,
        p.Alias as name,
        p.Cheater as is_cheater,
        p.LastPlayed as last_played,
        p.Created as created,
        COUNT(DISTINCT t.ID) as records_count
      FROM Players p
      LEFT JOIN Times t ON p.SteamID64 = t.SteamID64
      WHERE 1=1
    `;

      const params = [];

      if (name) {
        query += " AND p.Alias LIKE ?";
        params.push(`%${sanitizeString(name)}%`);
      }

      query += ` GROUP BY p.SteamID64, p.Alias, p.Cheater, p.LastPlayed, p.Created`;
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

      const [[{ total }]] = await pool.query(countQuery, countParams);

      res.json({
        data: rows.map((row) => ({
          steamid64: row.steamid64.toString(),
          name: row.name,
          is_cheater: row.is_cheater === 1,
          last_played: row.last_played,
          created: row.created,
          records_count: row.records_count,
        })),
        pagination: {
          page: parseInt(page, 10) || 1,
          limit: validLimit,
          total,
          totalPages: Math.ceil(total / validLimit),
        },
      });
    } catch (error) {
      logger.error(`Error fetching CS2 KZ local players: ${error.message}`);
      res.status(500).json({ error: "Failed to fetch players" });
    }
  },
);

/**
 * @swagger
 * /kzlocal-cs2/players/{steamid}:
 *   get:
 *     summary: Get specific CS2 KZ local player
 *     description: Returns detailed information about a specific player
 *     tags: [KZ Local CS2]
 *     parameters:
 *       - in: path
 *         name: steamid
 *         required: true
 *         schema:
 *           type: string
 *         description: Player SteamID64 or SteamID
 *     responses:
 *       200:
 *         description: Player details
 *       404:
 *         description: Player not found
 *       500:
 *         description: Server error
 */
router.get(
  "/players/:steamid",
  cacheMiddleware(60, kzKeyGenerator),
  async (req, res) => {
    try {
      const { steamid } = req.params;
      const pool = getPool();

      // Convert to SteamID64 if needed
      let steamid64 = steamid;
      if (isValidSteamID(steamid)) {
        steamid64 = convertToSteamID64(steamid);
      }

      if (!steamid64) {
        return res.status(400).json({ error: "Invalid SteamID" });
      }

      // Get player info
      const [players] = await pool.query(
        `SELECT 
        p.SteamID64 as steamid64,
        p.Alias as name,
        p.Cheater as is_cheater,
        p.LastPlayed as last_played,
        p.Created as created
      FROM Players p
      WHERE p.SteamID64 = ?`,
        [steamid64],
      );

      if (players.length === 0) {
        return res.status(404).json({ error: "Player not found" });
      }

      const player = players[0];

      // Get records count by mode
      const [modeStats] = await pool.query(
        `SELECT 
        m.ID as mode_id,
        m.Name as mode_name,
        m.ShortName as mode_short,
        COUNT(*) as records_count,
        MIN(t.RunTime) as best_time
      FROM Times t
      JOIN Modes m ON t.ModeID = m.ID
      WHERE t.SteamID64 = ?
      GROUP BY m.ID, m.Name, m.ShortName`,
        [steamid64],
      );

      // Get unique maps completed
      const [[{ maps_completed }]] = await pool.query(
        `SELECT COUNT(DISTINCT mc.MapID) as maps_completed
      FROM Times t
      JOIN MapCourses mc ON t.MapCourseID = mc.ID
      WHERE t.SteamID64 = ?`,
        [steamid64],
      );

      // Get recent records
      const [recentRecords] = await pool.query(
        `SELECT 
        t.ID as id,
        t.RunTime as run_time,
        t.Teleports as teleports,
        t.Created as created,
        m.Name as map_name,
        mc.Name as course_name,
        mo.Name as mode_name,
        mo.ShortName as mode_short
      FROM Times t
      JOIN MapCourses mc ON t.MapCourseID = mc.ID
      JOIN Maps m ON mc.MapID = m.ID
      JOIN Modes mo ON t.ModeID = mo.ID
      WHERE t.SteamID64 = ?
      ORDER BY t.Created DESC
      LIMIT 10`,
        [steamid64],
      );

      res.json({
        steamid64: player.steamid64.toString(),
        name: player.name,
        is_cheater: player.is_cheater === 1,
        last_played: player.last_played,
        created: player.created,
        maps_completed,
        mode_statistics: modeStats.map((ms) => ({
          mode_id: ms.mode_id,
          mode_name: ms.mode_name,
          mode_short: ms.mode_short,
          records_count: ms.records_count,
          best_time: formatRuntime(ms.best_time),
        })),
        recent_records: recentRecords.map((r) => ({
          id: r.id,
          time: formatRuntime(r.run_time),
          teleports: r.teleports,
          created: r.created,
          map_name: r.map_name,
          course_name: r.course_name,
          mode_name: r.mode_name,
          mode_short: r.mode_short,
        })),
      });
    } catch (error) {
      logger.error(`Error fetching CS2 KZ local player: ${error.message}`);
      res.status(500).json({ error: "Failed to fetch player" });
    }
  },
);

// ==================== MAPS ENDPOINTS ====================

/**
 * @swagger
 * /kzlocal-cs2/maps:
 *   get:
 *     summary: Get CS2 KZ local maps
 *     description: Returns a paginated list of maps from local CS2 KZ servers
 *     tags: [KZ Local CS2]
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
    const { page, limit, name, sort, order } = req.query;
    const { limit: validLimit, offset } = validatePagination(page, limit, 100);

    const pool = getPool();

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
        m.ID as id,
        m.Name as name,
        m.LastPlayed as last_played,
        m.Created as created,
        COUNT(DISTINCT mc.ID) as courses_count,
        COUNT(DISTINCT t.ID) as records_count
      FROM Maps m
      LEFT JOIN MapCourses mc ON m.ID = mc.MapID
      LEFT JOIN Times t ON mc.ID = t.MapCourseID
      WHERE 1=1
    `;

    const params = [];

    if (name) {
      query += " AND m.Name LIKE ?";
      params.push(`%${sanitizeString(name)}%`);
    }

    query += ` GROUP BY m.ID, m.Name, m.LastPlayed, m.Created`;
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

    const [[{ total }]] = await pool.query(countQuery, countParams);

    res.json({
      data: rows.map((row) => ({
        id: row.id,
        name: row.name,
        last_played: row.last_played,
        created: row.created,
        courses_count: row.courses_count,
        records_count: row.records_count,
      })),
      pagination: {
        page: parseInt(page, 10) || 1,
        limit: validLimit,
        total,
        totalPages: Math.ceil(total / validLimit),
      },
    });
  } catch (error) {
    logger.error(`Error fetching CS2 KZ local maps: ${error.message}`);
    res.status(500).json({ error: "Failed to fetch maps" });
  }
});

/**
 * @swagger
 * /kzlocal-cs2/maps/{mapname}:
 *   get:
 *     summary: Get specific CS2 KZ local map details
 *     description: Returns detailed information about a specific map including courses
 *     tags: [KZ Local CS2]
 *     parameters:
 *       - in: path
 *         name: mapname
 *         required: true
 *         schema:
 *           type: string
 *         description: Map name
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
      const pool = getPool();

      // Get map info
      const [maps] = await pool.query(
        `SELECT 
        m.ID as id,
        m.Name as name,
        m.LastPlayed as last_played,
        m.Created as created
      FROM Maps m
      WHERE m.Name = ?`,
        [sanitizeString(mapname)],
      );

      if (maps.length === 0) {
        return res.status(404).json({ error: "Map not found" });
      }

      const map = maps[0];

      // Get courses
      const [courses] = await pool.query(
        `SELECT 
        mc.ID as id,
        mc.Name as name,
        mc.StageID as stage_id,
        mc.Created as created,
        COUNT(t.ID) as records_count
      FROM MapCourses mc
      LEFT JOIN Times t ON mc.ID = t.MapCourseID
      WHERE mc.MapID = ?
      GROUP BY mc.ID, mc.Name, mc.StageID, mc.Created
      ORDER BY mc.StageID`,
        [map.id],
      );

      // Get mode statistics for this map
      const [modeStats] = await pool.query(
        `SELECT 
        mo.ID as mode_id,
        mo.Name as mode_name,
        mo.ShortName as mode_short,
        COUNT(t.ID) as records_count,
        MIN(t.RunTime) as best_time,
        COUNT(DISTINCT t.SteamID64) as unique_players
      FROM Times t
      JOIN MapCourses mc ON t.MapCourseID = mc.ID
      JOIN Modes mo ON t.ModeID = mo.ID
      WHERE mc.MapID = ?
      GROUP BY mo.ID, mo.Name, mo.ShortName`,
        [map.id],
      );

      // Get world records (best times per course/mode)
      const [worldRecords] = await pool.query(
        `SELECT 
        mc.Name as course_name,
        mo.Name as mode_name,
        mo.ShortName as mode_short,
        MIN(t.RunTime) as time,
        p.Alias as player_name,
        t.SteamID64 as steamid64,
        t.Teleports as teleports
      FROM Times t
      JOIN MapCourses mc ON t.MapCourseID = mc.ID
      JOIN Modes mo ON t.ModeID = mo.ID
      JOIN Players p ON t.SteamID64 = p.SteamID64
      WHERE mc.MapID = ?
        AND t.RunTime = (
          SELECT MIN(t2.RunTime) 
          FROM Times t2 
          WHERE t2.MapCourseID = t.MapCourseID 
            AND t2.ModeID = t.ModeID
        )
      GROUP BY mc.ID, mo.ID, mc.Name, mo.Name, mo.ShortName, t.RunTime, p.Alias, t.SteamID64, t.Teleports
      ORDER BY mc.StageID, mo.ID`,
        [map.id],
      );

      res.json({
        id: map.id,
        name: map.name,
        last_played: map.last_played,
        created: map.created,
        courses: courses.map((c) => ({
          id: c.id,
          name: c.name,
          stage_id: c.stage_id,
          created: c.created,
          records_count: c.records_count,
        })),
        mode_statistics: modeStats.map((ms) => ({
          mode_id: ms.mode_id,
          mode_name: ms.mode_name,
          mode_short: ms.mode_short,
          records_count: ms.records_count,
          best_time: formatRuntime(ms.best_time),
          unique_players: ms.unique_players,
        })),
        world_records: worldRecords.map((wr) => ({
          course_name: wr.course_name,
          mode_name: wr.mode_name,
          mode_short: wr.mode_short,
          time: formatRuntime(wr.time),
          player_name: wr.player_name,
          steamid64: wr.steamid64.toString(),
          teleports: wr.teleports,
        })),
      });
    } catch (error) {
      logger.error(`Error fetching CS2 KZ local map: ${error.message}`);
      res.status(500).json({ error: "Failed to fetch map" });
    }
  },
);

// ==================== RECORDS/TIMES ENDPOINTS ====================

/**
 * @swagger
 * /kzlocal-cs2/records:
 *   get:
 *     summary: Get CS2 KZ local records
 *     description: Returns a paginated list of time records
 *     tags: [KZ Local CS2]
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
 *         description: Filter by mode ID
 *       - in: query
 *         name: course
 *         schema:
 *           type: string
 *         description: Filter by course name
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
      const { page, limit, map, player, mode, course, teleports, sort, order } =
        req.query;
      const { limit: validLimit, offset } = validatePagination(
        page,
        limit,
        100,
      );

      const pool = getPool();

      const validSortFields = ["time", "created"];
      const sortFieldMap = {
        time: "t.RunTime",
        created: "t.Created",
      };
      const sortField = validSortFields.includes(sort) ? sort : "created";
      const sortOrder = order === "asc" ? "ASC" : "DESC";

      let query = `
      SELECT 
        t.ID as id,
        t.SteamID64 as steamid64,
        p.Alias as player_name,
        m.Name as map_name,
        m.ID as map_id,
        mc.Name as course_name,
        mc.StageID as stage_id,
        mo.ID as mode_id,
        mo.Name as mode_name,
        mo.ShortName as mode_short,
        t.StyleIDFlags as style_flags,
        t.RunTime as run_time,
        t.Teleports as teleports,
        t.Created as created
      FROM Times t
      JOIN Players p ON t.SteamID64 = p.SteamID64
      JOIN MapCourses mc ON t.MapCourseID = mc.ID
      JOIN Maps m ON mc.MapID = m.ID
      JOIN Modes mo ON t.ModeID = mo.ID
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
            query += " AND t.SteamID64 = ?";
            params.push(steamid64);
          }
        } else {
          query += " AND p.Alias LIKE ?";
          params.push(`%${sanitizeString(player)}%`);
        }
      }

      if (mode !== undefined) {
        query += " AND t.ModeID = ?";
        params.push(parseInt(mode, 10));
      }

      if (course) {
        query += " AND mc.Name LIKE ?";
        params.push(`%${sanitizeString(course)}%`);
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
      JOIN Players p ON t.SteamID64 = p.SteamID64
      JOIN MapCourses mc ON t.MapCourseID = mc.ID
      JOIN Maps m ON mc.MapID = m.ID
      JOIN Modes mo ON t.ModeID = mo.ID
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
            countQuery += " AND t.SteamID64 = ?";
            countParams.push(steamid64);
          }
        } else {
          countQuery += " AND p.Alias LIKE ?";
          countParams.push(`%${sanitizeString(player)}%`);
        }
      }

      if (mode !== undefined) {
        countQuery += " AND t.ModeID = ?";
        countParams.push(parseInt(mode, 10));
      }

      if (course) {
        countQuery += " AND mc.Name LIKE ?";
        countParams.push(`%${sanitizeString(course)}%`);
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
          steamid64: row.steamid64.toString(),
          player_name: row.player_name,
          map_name: row.map_name,
          map_id: row.map_id,
          course_name: row.course_name,
          stage_id: row.stage_id,
          mode_id: row.mode_id,
          mode_name: row.mode_name,
          mode_short: row.mode_short,
          style_flags: row.style_flags,
          time: formatRuntime(row.run_time),
          teleports: row.teleports,
          created: row.created,
        })),
        pagination: {
          page: parseInt(page, 10) || 1,
          limit: validLimit,
          total,
          totalPages: Math.ceil(total / validLimit),
        },
      });
    } catch (error) {
      logger.error(`Error fetching CS2 KZ local records: ${error.message}`);
      res.status(500).json({ error: "Failed to fetch records" });
    }
  },
);

/**
 * @swagger
 * /kzlocal-cs2/records/{id}:
 *   get:
 *     summary: Get specific CS2 KZ local record
 *     description: Returns details of a specific time record
 *     tags: [KZ Local CS2]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Record ID (UUID)
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
      const pool = getPool();

      const [records] = await pool.query(
        `SELECT 
        t.ID as id,
        t.SteamID64 as steamid64,
        p.Alias as player_name,
        p.Cheater as is_cheater,
        m.ID as map_id,
        m.Name as map_name,
        mc.ID as course_id,
        mc.Name as course_name,
        mc.StageID as stage_id,
        mo.ID as mode_id,
        mo.Name as mode_name,
        mo.ShortName as mode_short,
        t.StyleIDFlags as style_flags,
        t.RunTime as run_time,
        t.Teleports as teleports,
        t.Metadata as metadata,
        t.Created as created
      FROM Times t
      JOIN Players p ON t.SteamID64 = p.SteamID64
      JOIN MapCourses mc ON t.MapCourseID = mc.ID
      JOIN Maps m ON mc.MapID = m.ID
      JOIN Modes mo ON t.ModeID = mo.ID
      WHERE t.ID = ?`,
        [id],
      );

      if (records.length === 0) {
        return res.status(404).json({ error: "Record not found" });
      }

      const record = records[0];

      // Calculate rank for this record
      const [[{ rank }]] = await pool.query(
        `SELECT COUNT(*) + 1 as rank
      FROM Times t2
      WHERE t2.MapCourseID = (SELECT MapCourseID FROM Times WHERE ID = ?)
        AND t2.ModeID = (SELECT ModeID FROM Times WHERE ID = ?)
        AND t2.RunTime < ?`,
        [id, id, record.run_time],
      );

      res.json({
        id: record.id,
        steamid64: record.steamid64.toString(),
        player_name: record.player_name,
        is_cheater: record.is_cheater === 1,
        map_id: record.map_id,
        map_name: record.map_name,
        course_id: record.course_id,
        course_name: record.course_name,
        stage_id: record.stage_id,
        mode_id: record.mode_id,
        mode_name: record.mode_name,
        mode_short: record.mode_short,
        style_flags: record.style_flags,
        time: formatRuntime(record.run_time),
        teleports: record.teleports,
        metadata: record.metadata,
        created: record.created,
        rank,
      });
    } catch (error) {
      logger.error(`Error fetching CS2 KZ local record: ${error.message}`);
      res.status(500).json({ error: "Failed to fetch record" });
    }
  },
);

/**
 * @swagger
 * /kzlocal-cs2/records/top/{mapname}:
 *   get:
 *     summary: Get top records for a map
 *     description: Returns leaderboard for a specific map
 *     tags: [KZ Local CS2]
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
 *           type: integer
 *         description: Filter by mode ID
 *       - in: query
 *         name: course
 *         schema:
 *           type: string
 *         description: Filter by course name (default: Main)
 *       - in: query
 *         name: teleports
 *         schema:
 *           type: string
 *           enum: [tp, pro]
 *         description: Filter by teleport usage
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 100
 *     responses:
 *       200:
 *         description: Top records for the map
 *       404:
 *         description: Map not found
 *       500:
 *         description: Server error
 */
router.get(
  "/records/top/:mapname",
  cacheMiddleware(60, kzKeyGenerator),
  async (req, res) => {
    try {
      const { mapname } = req.params;
      const { mode, course, teleports, limit } = req.query;
      const validLimit = Math.min(parseInt(limit, 10) || 20, 100);

      const pool = getPool();

      // Check if map exists
      const [maps] = await pool.query(`SELECT ID FROM Maps WHERE Name = ?`, [
        sanitizeString(mapname),
      ]);

      if (maps.length === 0) {
        return res.status(404).json({ error: "Map not found" });
      }

      const mapId = maps[0].ID;

      // Build query for top times (personal bests only)
      let query = `
      SELECT 
        t.ID as id,
        t.SteamID64 as steamid64,
        p.Alias as player_name,
        mc.Name as course_name,
        mo.ID as mode_id,
        mo.Name as mode_name,
        mo.ShortName as mode_short,
        t.RunTime as run_time,
        t.Teleports as teleports,
        t.Created as created
      FROM Times t
      JOIN Players p ON t.SteamID64 = p.SteamID64
      JOIN MapCourses mc ON t.MapCourseID = mc.ID
      JOIN Modes mo ON t.ModeID = mo.ID
      WHERE mc.MapID = ?
        AND p.Cheater = 0
    `;

      const params = [mapId];

      if (mode !== undefined) {
        query += " AND t.ModeID = ?";
        params.push(parseInt(mode, 10));
      }

      if (course) {
        query += " AND mc.Name = ?";
        params.push(sanitizeString(course));
      }

      if (teleports === "pro") {
        query += " AND t.Teleports = 0";
      } else if (teleports === "tp") {
        query += " AND t.Teleports > 0";
      }

      // Get personal best per player
      query += `
        AND t.RunTime = (
          SELECT MIN(t2.RunTime) 
          FROM Times t2 
          WHERE t2.SteamID64 = t.SteamID64 
            AND t2.MapCourseID = t.MapCourseID 
            AND t2.ModeID = t.ModeID
            ${teleports === "pro" ? "AND t2.Teleports = 0" : ""}
            ${teleports === "tp" ? "AND t2.Teleports > 0" : ""}
        )
      ORDER BY t.RunTime ASC
      LIMIT ?
    `;
      params.push(validLimit);

      const [rows] = await pool.query(query, params);

      res.json({
        map_name: mapname,
        records: rows.map((row, index) => ({
          rank: index + 1,
          id: row.id,
          steamid64: row.steamid64.toString(),
          player_name: row.player_name,
          course_name: row.course_name,
          mode_id: row.mode_id,
          mode_name: row.mode_name,
          mode_short: row.mode_short,
          time: formatRuntime(row.run_time),
          teleports: row.teleports,
          created: row.created,
        })),
      });
    } catch (error) {
      logger.error(`Error fetching CS2 KZ local top records: ${error.message}`);
      res.status(500).json({ error: "Failed to fetch top records" });
    }
  },
);

// ==================== JUMPSTATS ENDPOINTS ====================

/**
 * @swagger
 * /kzlocal-cs2/jumpstats:
 *   get:
 *     summary: Get CS2 KZ local jumpstats
 *     description: Returns a paginated list of jumpstat records
 *     tags: [KZ Local CS2]
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
 *         name: player
 *         schema:
 *           type: string
 *         description: Filter by player SteamID or name
 *       - in: query
 *         name: jump_type
 *         schema:
 *           type: integer
 *           enum: [0, 1, 2, 3, 4, 5, 6]
 *         description: Filter by jump type
 *       - in: query
 *         name: mode
 *         schema:
 *           type: integer
 *         description: Filter by mode
 *       - in: query
 *         name: block
 *         schema:
 *           type: boolean
 *         description: Filter by block jumps only
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
      const { page, limit, player, jump_type, mode, block, sort, order } =
        req.query;
      const { limit: validLimit, offset } = validatePagination(
        page,
        limit,
        100,
      );

      const pool = getPool();

      const validSortFields = ["distance", "created"];
      const sortFieldMap = {
        distance: "j.Distance",
        created: "j.Created",
      };
      const sortField = validSortFields.includes(sort) ? sort : "distance";
      const sortOrder = order === "asc" ? "ASC" : "DESC";

      let query = `
      SELECT 
        j.ID as id,
        j.SteamID64 as steamid64,
        p.Alias as player_name,
        j.JumpType as jump_type,
        j.Mode as mode,
        j.Distance as distance,
        j.IsBlockJump as is_block,
        j.Block as block,
        j.Strafes as strafes,
        j.Sync as sync,
        j.Pre as pre,
        j.Max as max,
        j.Airtime as airtime,
        j.Created as created
      FROM Jumpstats j
      JOIN Players p ON j.SteamID64 = p.SteamID64
      WHERE 1=1
    `;

      const params = [];

      if (player) {
        if (isValidSteamID(player)) {
          const steamid64 = convertToSteamID64(player);
          if (steamid64) {
            query += " AND j.SteamID64 = ?";
            params.push(steamid64);
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

      if (block === "true" || block === "1") {
        query += " AND j.IsBlockJump = 1";
      }

      query += ` ORDER BY ${sortFieldMap[sortField]} ${sortOrder}`;
      query += ` LIMIT ? OFFSET ?`;
      params.push(validLimit, offset);

      const [rows] = await pool.query(query, params);

      // Get total count
      let countQuery = `
      SELECT COUNT(*) as total
      FROM Jumpstats j
      JOIN Players p ON j.SteamID64 = p.SteamID64
      WHERE 1=1
    `;
      const countParams = [];

      if (player) {
        if (isValidSteamID(player)) {
          const steamid64 = convertToSteamID64(player);
          if (steamid64) {
            countQuery += " AND j.SteamID64 = ?";
            countParams.push(steamid64);
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

      if (block === "true" || block === "1") {
        countQuery += " AND j.IsBlockJump = 1";
      }

      const [[{ total }]] = await pool.query(countQuery, countParams);

      res.json({
        data: rows.map((row) => ({
          id: row.id,
          steamid64: row.steamid64.toString(),
          player_name: row.player_name,
          jump_type: CS2_JUMP_TYPES[row.jump_type] || `type_${row.jump_type}`,
          jump_type_id: row.jump_type,
          mode: row.mode,
          distance: formatDistance(row.distance),
          is_block: row.is_block === 1,
          block: row.block,
          strafes: row.strafes,
          sync: formatStat(row.sync),
          pre: formatStat(row.pre),
          max: formatStat(row.max),
          airtime: formatAirtime(row.airtime),
          created: row.created,
        })),
        pagination: {
          page: parseInt(page, 10) || 1,
          limit: validLimit,
          total,
          totalPages: Math.ceil(total / validLimit),
        },
      });
    } catch (error) {
      logger.error(`Error fetching CS2 KZ local jumpstats: ${error.message}`);
      res.status(500).json({ error: "Failed to fetch jumpstats" });
    }
  },
);

/**
 * @swagger
 * /kzlocal-cs2/jumpstats/top:
 *   get:
 *     summary: Get top jumpstats
 *     description: Returns leaderboard for jumpstats
 *     tags: [KZ Local CS2]
 *     parameters:
 *       - in: query
 *         name: jump_type
 *         schema:
 *           type: integer
 *           enum: [0, 1, 2, 3, 4, 5, 6]
 *           default: 0
 *         description: Jump type (0=longjump)
 *       - in: query
 *         name: mode
 *         schema:
 *           type: integer
 *         description: Filter by mode
 *       - in: query
 *         name: block
 *         schema:
 *           type: boolean
 *         description: Filter by block jumps only
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 100
 *     responses:
 *       200:
 *         description: Top jumpstats
 *       500:
 *         description: Server error
 */
router.get(
  "/jumpstats/top",
  cacheMiddleware(60, kzKeyGenerator),
  async (req, res) => {
    try {
      const { jump_type, mode, block, limit } = req.query;
      const validLimit = Math.min(parseInt(limit, 10) || 20, 100);
      const jumpType = parseInt(jump_type, 10) || 0;

      const pool = getPool();

      let query = `
      SELECT 
        j.ID as id,
        j.SteamID64 as steamid64,
        p.Alias as player_name,
        j.JumpType as jump_type,
        j.Mode as mode,
        j.Distance as distance,
        j.IsBlockJump as is_block,
        j.Block as block,
        j.Strafes as strafes,
        j.Sync as sync,
        j.Pre as pre,
        j.Max as max,
        j.Airtime as airtime,
        j.Created as created
      FROM Jumpstats j
      JOIN Players p ON j.SteamID64 = p.SteamID64
      WHERE j.JumpType = ?
        AND p.Cheater = 0
    `;

      const params = [jumpType];

      if (mode !== undefined) {
        query += " AND j.Mode = ?";
        params.push(parseInt(mode, 10));
      }

      if (block === "true" || block === "1") {
        query += " AND j.IsBlockJump = 1";
      }

      // Get personal best per player
      query += `
        AND j.Distance = (
          SELECT MAX(j2.Distance) 
          FROM Jumpstats j2 
          WHERE j2.SteamID64 = j.SteamID64 
            AND j2.JumpType = j.JumpType
            AND j2.Mode = j.Mode
            ${block === "true" || block === "1" ? "AND j2.IsBlockJump = 1" : ""}
        )
      ORDER BY j.Distance DESC
      LIMIT ?
    `;
      params.push(validLimit);

      const [rows] = await pool.query(query, params);

      res.json({
        jump_type: CS2_JUMP_TYPES[jumpType] || `type_${jumpType}`,
        jump_type_id: jumpType,
        records: rows.map((row, index) => ({
          rank: index + 1,
          id: row.id,
          steamid64: row.steamid64.toString(),
          player_name: row.player_name,
          mode: row.mode,
          distance: formatDistance(row.distance),
          is_block: row.is_block === 1,
          block: row.block,
          strafes: row.strafes,
          sync: formatStat(row.sync),
          pre: formatStat(row.pre),
          max: formatStat(row.max),
          airtime: formatAirtime(row.airtime),
          created: row.created,
        })),
      });
    } catch (error) {
      logger.error(
        `Error fetching CS2 KZ local top jumpstats: ${error.message}`,
      );
      res.status(500).json({ error: "Failed to fetch top jumpstats" });
    }
  },
);

// ==================== MODES ENDPOINTS ====================

/**
 * @swagger
 * /kzlocal-cs2/modes:
 *   get:
 *     summary: Get CS2 KZ modes
 *     description: Returns list of available KZ modes
 *     tags: [KZ Local CS2]
 *     responses:
 *       200:
 *         description: List of modes
 *       500:
 *         description: Server error
 */
router.get("/modes", cacheMiddleware(300, kzKeyGenerator), async (req, res) => {
  try {
    const pool = getPool();

    const [modes] = await pool.query(
      `SELECT 
        ID as id,
        Name as name,
        ShortName as short_name
      FROM Modes
      ORDER BY ID`,
    );

    res.json({
      data: modes,
    });
  } catch (error) {
    logger.error(`Error fetching CS2 KZ modes: ${error.message}`);
    res.status(500).json({ error: "Failed to fetch modes" });
  }
});

// ==================== STYLES ENDPOINTS ====================

/**
 * @swagger
 * /kzlocal-cs2/styles:
 *   get:
 *     summary: Get CS2 KZ styles
 *     description: Returns list of available KZ styles
 *     tags: [KZ Local CS2]
 *     responses:
 *       200:
 *         description: List of styles
 *       500:
 *         description: Server error
 */
router.get(
  "/styles",
  cacheMiddleware(300, kzKeyGenerator),
  async (req, res) => {
    try {
      const pool = getPool();

      const [styles] = await pool.query(
        `SELECT 
        ID as id,
        Name as name,
        ShortName as short_name
      FROM Styles
      ORDER BY ID`,
      );

      res.json({
        data: styles,
      });
    } catch (error) {
      logger.error(`Error fetching CS2 KZ styles: ${error.message}`);
      res.status(500).json({ error: "Failed to fetch styles" });
    }
  },
);

// ==================== COURSES ENDPOINTS ====================

/**
 * @swagger
 * /kzlocal-cs2/courses:
 *   get:
 *     summary: Get CS2 KZ courses
 *     description: Returns a paginated list of map courses
 *     tags: [KZ Local CS2]
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
 *         name: map
 *         schema:
 *           type: string
 *         description: Filter by map name
 *     responses:
 *       200:
 *         description: List of courses
 *       500:
 *         description: Server error
 */
router.get(
  "/courses",
  cacheMiddleware(60, kzKeyGenerator),
  async (req, res) => {
    try {
      const { page, limit, map } = req.query;
      const { limit: validLimit, offset } = validatePagination(
        page,
        limit,
        100,
      );

      const pool = getPool();

      let query = `
      SELECT 
        mc.ID as id,
        mc.Name as name,
        mc.StageID as stage_id,
        m.ID as map_id,
        m.Name as map_name,
        mc.Created as created,
        COUNT(t.ID) as records_count
      FROM MapCourses mc
      JOIN Maps m ON mc.MapID = m.ID
      LEFT JOIN Times t ON mc.ID = t.MapCourseID
      WHERE 1=1
    `;

      const params = [];

      if (map) {
        query += " AND m.Name LIKE ?";
        params.push(`%${sanitizeString(map)}%`);
      }

      query += ` GROUP BY mc.ID, mc.Name, mc.StageID, m.ID, m.Name, mc.Created`;
      query += ` ORDER BY m.Name, mc.StageID`;
      query += ` LIMIT ? OFFSET ?`;
      params.push(validLimit, offset);

      const [rows] = await pool.query(query, params);

      // Get total count
      let countQuery = `
      SELECT COUNT(*) as total
      FROM MapCourses mc
      JOIN Maps m ON mc.MapID = m.ID
      WHERE 1=1
    `;
      const countParams = [];

      if (map) {
        countQuery += " AND m.Name LIKE ?";
        countParams.push(`%${sanitizeString(map)}%`);
      }

      const [[{ total }]] = await pool.query(countQuery, countParams);

      res.json({
        data: rows.map((row) => ({
          id: row.id,
          name: row.name,
          stage_id: row.stage_id,
          map_id: row.map_id,
          map_name: row.map_name,
          created: row.created,
          records_count: row.records_count,
        })),
        pagination: {
          page: parseInt(page, 10) || 1,
          limit: validLimit,
          total,
          totalPages: Math.ceil(total / validLimit),
        },
      });
    } catch (error) {
      logger.error(`Error fetching CS2 KZ courses: ${error.message}`);
      res.status(500).json({ error: "Failed to fetch courses" });
    }
  },
);

// ==================== STATS ENDPOINTS ====================

/**
 * @swagger
 * /kzlocal-cs2/stats:
 *   get:
 *     summary: Get CS2 KZ server statistics
 *     description: Returns overall statistics for the CS2 KZ server
 *     tags: [KZ Local CS2]
 *     responses:
 *       200:
 *         description: Server statistics
 *       500:
 *         description: Server error
 */
router.get("/stats", cacheMiddleware(120, kzKeyGenerator), async (req, res) => {
  try {
    const pool = getPool();

    const [[stats]] = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM Players) as total_players,
        (SELECT COUNT(*) FROM Maps) as total_maps,
        (SELECT COUNT(*) FROM MapCourses) as total_courses,
        (SELECT COUNT(*) FROM Times) as total_records,
        (SELECT COUNT(*) FROM Jumpstats) as total_jumpstats,
        (SELECT COUNT(*) FROM Modes) as total_modes,
        (SELECT COUNT(*) FROM Styles) as total_styles
    `);

    // Get recent activity
    const [[recentStats]] = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM Times WHERE Created > DATE_SUB(NOW(), INTERVAL 24 HOUR)) as records_24h,
        (SELECT COUNT(*) FROM Times WHERE Created > DATE_SUB(NOW(), INTERVAL 7 DAY)) as records_7d,
        (SELECT COUNT(DISTINCT SteamID64) FROM Times WHERE Created > DATE_SUB(NOW(), INTERVAL 24 HOUR)) as active_players_24h,
        (SELECT COUNT(DISTINCT SteamID64) FROM Times WHERE Created > DATE_SUB(NOW(), INTERVAL 7 DAY)) as active_players_7d
    `);

    res.json({
      total_players: stats.total_players,
      total_maps: stats.total_maps,
      total_courses: stats.total_courses,
      total_records: stats.total_records,
      total_jumpstats: stats.total_jumpstats,
      total_modes: stats.total_modes,
      total_styles: stats.total_styles,
      recent_activity: {
        records_24h: recentStats.records_24h,
        records_7d: recentStats.records_7d,
        active_players_24h: recentStats.active_players_24h,
        active_players_7d: recentStats.active_players_7d,
      },
    });
  } catch (error) {
    logger.error(`Error fetching CS2 KZ stats: ${error.message}`);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

module.exports = router;
