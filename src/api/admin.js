/**
 * Operator-only maintenance endpoints. Mounted under adminAuth in app.js.
 * Not called by the game-server plugins.
 */

const express = require("express");
const router = express.Router();
const pool = require("../db");
const logger = require("../utils/logger");
const {
  resolveSteamID,
  isValidDiscordId,
  isValidHexColor,
} = require("../utils/validators");

const { VALID_ROLES, VALID_TAG_COLORS } = require("../config/permissions");
const {
  getStats: getScraperStats,
  processBansFullSweep,
} = require("../services/kz/recordsScraper");
const {
  getStats: getBanStatusStats,
  manualBanStatusUpdate,
  cleanupExpiredBans,
} = require("../services/kz/banStatus");
const {
  refreshAllStatistics,
  refreshPlayerStatistics,
  refreshMapStatistics,
  refreshServerStatistics,
  populateAllStatistics,
  getStatisticsSummary,
} = require("../services/kz/statistics");
const { deleteCache, flushCache } = require("../db/redis");
const {
  runCleanup: runJumpstatCleanup,
  getQuarantinedJumpstats,
  restoreJumpstat,
  restoreAllJumpstats,
  getAvailableFilters: getJumpstatFilters,
} = require("../services/kz/jumpstatCleanup");

/**
 * @swagger
 * /admin/scraper-status:
 *   get:
 *     summary: KZ records scraper progress
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyHeader: []
 *     responses:
 *       200:
 *         description: Scraper counters and current position
 *       401:
 *         description: Missing or invalid API key
 *       500:
 *         description: Server error
 */
router.get("/scraper-status", async (req, res) => {
  try {
    const stats = getScraperStats();
    res.json({
      success: true,
      scraper: stats,
    });
  } catch (error) {
    logger.error("Failed to get scraper status", { error: error.message });
    res.status(500).json({ error: "Failed to get scraper status" });
  }
});

/**
 * @swagger
 * /admin/aggregate-daily:
 *   post:
 *     summary: Roll history into daily aggregates
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyHeader: []
 *     parameters:
 *       - in: query
 *         name: date
 *         schema:
 *           type: string
 *           format: date
 *         description: Day to aggregate; defaults to the most recent
 *     responses:
 *       200:
 *         description: Aggregation complete, with the date and server count
 *       401:
 *         description: Missing or invalid API key
 *       500:
 *         description: Server error
 */
router.post("/aggregate-daily", async (req, res) => {
  const startTime = Date.now();
  try {
    const { date } = req.query;
    const targetDate = date || new Date().toISOString().split("T")[0];

    logger.info("Starting daily aggregation", { date: targetDate });

    // Aggregate stats for each server
    const [servers] = await pool.query(
      "SELECT DISTINCT server_ip, server_port FROM server_history WHERE DATE(recorded_at) = ?",
      [targetDate],
    );

    let aggregated = 0;

    for (const server of servers) {
      // Snapshot stats come from server_history alone.
      const [stats] = await pool.query(
        `SELECT 
          MAX(player_count) as peak_players,
          AVG(player_count) as avg_players,
          COUNT(*) as data_points
        FROM server_history
        WHERE server_ip = ? 
          AND server_port = ? 
          AND DATE(recorded_at) = ?`,
        [server.server_ip, server.server_port, targetDate],
      );

      const [playerStats] = await pool.query(
        `SELECT COUNT(DISTINCT steamid) as unique_players
        FROM player_sessions
        WHERE server_ip = ? 
          AND server_port = ? 
          AND DATE(joined_at) = ?`,
        [server.server_ip, server.server_port, targetDate],
      );

      const [mapStats] = await pool.query(
        `SELECT COUNT(*) as total_maps
        FROM map_history
        WHERE server_ip = ? 
          AND server_port = ? 
          AND DATE(started_at) = ?`,
        [server.server_ip, server.server_port, targetDate],
      );

      // Assumes the updater's 30s cadence;
      // over-counts for servers whose plugin reports directly (api/serverStatus writes history every ~10s).
      const uptime_minutes = Math.round((stats[0].data_points * 30) / 60);

      await pool.query(
        `INSERT INTO daily_stats 
        (stat_date, server_ip, server_port, total_players, unique_players, peak_players, avg_players, uptime_minutes, total_maps_played)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE 
          total_players = VALUES(total_players),
          unique_players = VALUES(unique_players),
          peak_players = VALUES(peak_players),
          avg_players = VALUES(avg_players),
          uptime_minutes = VALUES(uptime_minutes),
          total_maps_played = VALUES(total_maps_played)`,
        [
          targetDate,
          server.server_ip,
          server.server_port,
          stats[0].data_points,
          playerStats[0].unique_players || 0,
          stats[0].peak_players || 0,
          parseFloat(stats[0].avg_players) || 0,
          uptime_minutes,
          mapStats[0].total_maps || 0,
        ],
      );

      aggregated++;
    }

    logger.info("Daily aggregation complete", {
      date: targetDate,
      servers: aggregated,
    });
    logger.logRequest(req, res, Date.now() - startTime);

    res.json({
      success: true,
      date: targetDate,
      servers: aggregated,
      message: "Daily statistics aggregated successfully",
    });
  } catch (error) {
    logger.error("Failed to aggregate daily stats", { error: error.message });
    res.status(500).json({ error: "Failed to aggregate daily statistics" });
  }
});

/**
 * @swagger
 * /admin/cleanup-history:
 *   post:
 *     summary: Prune history past the retention window
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyHeader: []
 *     parameters:
 *       - in: query
 *         name: days
 *         schema:
 *           type: integer
 *           default: 30
 *         description: Keep this many days of history
 *     responses:
 *       200:
 *         description: Rows deleted per history table
 *       401:
 *         description: Missing or invalid API key
 *       500:
 *         description: Server error
 */
router.post("/cleanup-history", async (req, res) => {
  const startTime = Date.now();
  try {
    const { days = 30 } = req.query;
    const daysInt = parseInt(days, 10);

    logger.info("Starting history cleanup", { days: daysInt });

    // Cleanup server history
    const [serverResult] = await pool.query(
      "DELETE FROM server_history WHERE recorded_at < DATE_SUB(NOW(), INTERVAL ? DAY)",
      [daysInt],
    );

    // Cleanup player sessions
    const [sessionResult] = await pool.query(
      "DELETE FROM player_sessions WHERE joined_at < DATE_SUB(NOW(), INTERVAL ? DAY)",
      [daysInt],
    );

    // Cleanup map history
    const [mapResult] = await pool.query(
      "DELETE FROM map_history WHERE started_at < DATE_SUB(NOW(), INTERVAL ? DAY)",
      [daysInt],
    );

    logger.info("History cleanup complete", {
      serverRecords: serverResult.affectedRows,
      sessionRecords: sessionResult.affectedRows,
      mapRecords: mapResult.affectedRows,
    });
    logger.logRequest(req, res, Date.now() - startTime);

    res.json({
      success: true,
      deleted: {
        serverHistory: serverResult.affectedRows,
        playerSessions: sessionResult.affectedRows,
        mapHistory: mapResult.affectedRows,
      },
    });
  } catch (error) {
    logger.error("Failed to cleanup history", { error: error.message });
    res.status(500).json({ error: "Failed to cleanup history" });
  }
});

/**
 * @swagger
 * /admin/ban-status:
 *   get:
 *     summary: Ban sweep state
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyHeader: []
 *     responses:
 *       200:
 *         description: Ban sweep counters
 *       401:
 *         description: Missing or invalid API key
 *       500:
 *         description: Server error
 */
router.get("/ban-status", async (req, res) => {
  try {
    const stats = getBanStatusStats();
    res.json({
      success: true,
      banStatus: stats,
    });
  } catch (error) {
    logger.error("Failed to get ban status", { error: error.message });
    res.status(500).json({ error: "Failed to get ban status" });
  }
});

/**
 * @swagger
 * /admin/update-ban-status:
 *   post:
 *     summary: Refresh ban flags from GlobalAPI
 *     description: Updates the given SteamIDs, or every tracked player when steamIds is omitted.
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyHeader: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               steamIds:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Players checked and flags updated
 *       401:
 *         description: Missing or invalid API key
 *       500:
 *         description: Server error
 */
router.post("/update-ban-status", async (req, res) => {
  const startTime = Date.now();
  try {
    const { steamIds } = req.body || {};

    logger.info("Manual ban status update triggered", {
      steamIds: steamIds ? steamIds.length : "all",
    });

    const result = await manualBanStatusUpdate(steamIds);

    logger.info("Ban status update complete", result);
    logger.logRequest(req, res, Date.now() - startTime);

    res.json({
      success: true,
      result,
      message: "Ban status updated successfully",
    });
  } catch (error) {
    logger.error("Failed to update ban status", { error: error.message });
    res.status(500).json({ error: "Failed to update ban status" });
  }
});

/**
 * @swagger
 * /admin/cleanup-expired-bans:
 *   post:
 *     summary: Clear bans whose term has elapsed
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyHeader: []
 *     responses:
 *       200:
 *         description: Expired bans cleared
 *       401:
 *         description: Missing or invalid API key
 *       500:
 *         description: Server error
 */
router.post("/cleanup-expired-bans", async (req, res) => {
  const startTime = Date.now();
  try {
    logger.info("Manual expired bans cleanup triggered");

    const result = await cleanupExpiredBans(true);

    logger.info("Expired bans cleanup complete", result);
    logger.logRequest(req, res, Date.now() - startTime);

    res.json({
      success: true,
      result,
      message: "Expired bans cleaned up successfully",
    });
  } catch (error) {
    logger.error("Failed to cleanup expired bans", { error: error.message });
    res.status(500).json({ error: "Failed to cleanup expired bans" });
  }
});

/**
 * @swagger
 * /admin/sweep-bans:
 *   post:
 *     summary: Full re-fetch and diff of all bans
 *     description: GlobalAPI has no changed-since query, so unbans and edits are only visible by re-fetching and diffing.
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyHeader: []
 *     responses:
 *       200:
 *         description: Sweep complete, with detected changes
 *       401:
 *         description: Missing or invalid API key
 *       500:
 *         description: Server error
 */
router.post("/sweep-bans", async (req, res) => {
  const startTime = Date.now();
  try {
    logger.info("Manual full ban sweep triggered");

    const result = await processBansFullSweep(true);

    logger.info("Full ban sweep complete", result);
    logger.logRequest(req, res, Date.now() - startTime);

    res.json({
      success: true,
      result,
      message: "Ban sweep complete",
    });
  } catch (error) {
    logger.error("Failed to sweep bans", { error: error.message });
    res.status(500).json({ error: "Failed to sweep bans" });
  }
});

/**
 * @swagger
 * /admin/kz-statistics:
 *   get:
 *     summary: Cached KZ aggregate statistics
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyHeader: []
 *     responses:
 *       200:
 *         description: Current statistics summary
 *       401:
 *         description: Missing or invalid API key
 *       500:
 *         description: Server error
 */
router.get("/kz-statistics", async (req, res) => {
  try {
    const summary = await getStatisticsSummary();
    res.json({
      success: true,
      statistics: summary,
    });
  } catch (error) {
    logger.error("Failed to get KZ statistics", { error: error.message });
    res.status(500).json({ error: "Failed to get KZ statistics" });
  }
});

/**
 * @swagger
 * /admin/refresh-kz-statistics:
 *   post:
 *     summary: Recompute aggregate statistics
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyHeader: []
 *     parameters:
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [all, player, map, server]
 *           default: all
 *         description: Which statistics to refresh
 *     responses:
 *       200:
 *         description: Statistics refreshed
 *       401:
 *         description: Missing or invalid API key
 *       500:
 *         description: Server error
 */
router.post("/refresh-kz-statistics", async (req, res) => {
  const startTime = Date.now();
  try {
    const { type = "all" } = req.query;

    logger.info("Manual KZ statistics refresh triggered", { type });

    let result;
    switch (type) {
      case "players":
        result = { players: await refreshPlayerStatistics() };
        break;
      case "maps":
        result = { maps: await refreshMapStatistics() };
        break;
      case "servers":
        result = { servers: await refreshServerStatistics() };
        break;
      case "all":
      default:
        result = await refreshAllStatistics();
        break;
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.info("KZ statistics refresh complete", { type, elapsed });
    logger.logRequest(req, res, Date.now() - startTime);

    res.json({
      success: true,
      type,
      result,
      elapsed: `${elapsed}s`,
      message: "KZ statistics refreshed successfully",
    });
  } catch (error) {
    logger.error("Failed to refresh KZ statistics", { error: error.message });
    res.status(500).json({ error: "Failed to refresh KZ statistics" });
  }
});

/**
 * @swagger
 * /admin/populate-kz-statistics:
 *   post:
 *     summary: First-time statistics population
 *     description: Reports success as a boolean rather than throwing, so a 200 can still carry success false.
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyHeader: []
 *     responses:
 *       200:
 *         description: Population finished; success reports whether it actually succeeded
 *       401:
 *         description: Missing or invalid API key
 *       500:
 *         description: Server error
 */
router.post("/populate-kz-statistics", async (req, res) => {
  const startTime = Date.now();
  try {
    logger.info("Manual KZ statistics population triggered");

    const result = await populateAllStatistics();

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.info("KZ statistics population complete", { elapsed });
    logger.logRequest(req, res, Date.now() - startTime);

    res.json({
      success: result,
      elapsed: `${elapsed}s`,
      message: result
        ? "KZ statistics populated successfully"
        : "KZ statistics population failed",
    });
  } catch (error) {
    logger.error("Failed to populate KZ statistics", { error: error.message });
    res.status(500).json({ error: "Failed to populate KZ statistics" });
  }
});

// ==================== JUMPSTAT CLEANUP ENDPOINTS ====================

/**
 * @swagger
 * /admin/jumpstat-filters:
 *   get:
 *     summary: Active jumpstat quarantine filters
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyHeader: []
 *     responses:
 *       200:
 *         description: Available filters
 *       401:
 *         description: Missing or invalid API key
 *       500:
 *         description: Server error
 */
router.get("/jumpstat-filters", async (req, res) => {
  try {
    const filters = getJumpstatFilters();
    res.json({
      success: true,
      filters,
      total: filters.length,
    });
  } catch (error) {
    logger.error("Failed to get jumpstat filters", { error: error.message });
    res.status(500).json({ error: "Failed to get jumpstat filters" });
  }
});

/**
 * @swagger
 * /admin/cleanup-jumpstats:
 *   post:
 *     summary: Quarantine jumpstats matching the filters
 *     description: Defaults to a dry run; pass dryRun=false to actually quarantine.
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyHeader: []
 *     parameters:
 *       - in: query
 *         name: dryRun
 *         schema:
 *           type: string
 *           default: "true"
 *         description: Set to false to apply the changes
 *       - in: query
 *         name: game
 *         schema:
 *           type: string
 *           default: all
 *       - in: query
 *         name: filterId
 *         schema:
 *           type: string
 *         description: Restrict to a single filter
 *     responses:
 *       200:
 *         description: Matches found, and how many were quarantined unless this was a dry run
 *       401:
 *         description: Missing or invalid API key
 *       500:
 *         description: Server error
 */
router.post("/cleanup-jumpstats", async (req, res) => {
  const startTime = Date.now();
  try {
    const { dryRun = "true", game = "all", filterId } = req.query;
    const isDryRun = dryRun === "true" || dryRun === "1";

    logger.info("Jumpstat cleanup triggered", {
      dryRun: isDryRun,
      game,
      filterId: filterId || "all",
    });

    const result = await runJumpstatCleanup({
      dryRun: isDryRun,
      game,
      filterId,
      executedBy: req.adminId || "system",
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.info("Jumpstat cleanup complete", {
      dryRun: isDryRun,
      matched: result.summary?.total_matched || 0,
      quarantined: result.summary?.total_quarantined || 0,
      elapsed,
    });
    logger.logRequest(req, res, Date.now() - startTime);

    res.json({
      ...result,
      elapsed: `${elapsed}s`,
    });
  } catch (error) {
    logger.error("Failed to cleanup jumpstats", { error: error.message });
    res.status(500).json({ error: "Failed to cleanup jumpstats" });
  }
});

/**
 * @swagger
 * /admin/quarantined-jumpstats:
 *   get:
 *     summary: Jumpstats currently held by the filters
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyHeader: []
 *     parameters:
 *       - in: query
 *         name: game
 *         schema:
 *           type: string
 *           default: cs2
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
 *         name: filterId
 *         schema:
 *           type: string
 *       - in: query
 *         name: steamid64
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Paginated quarantined rows
 *       401:
 *         description: Missing or invalid API key
 *       500:
 *         description: Server error
 */
router.get("/quarantined-jumpstats", async (req, res) => {
  try {
    const {
      game = "cs2",
      page = "1",
      limit = "50",
      filterId,
      steamid64,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));

    const result = await getQuarantinedJumpstats({
      game,
      page: pageNum,
      limit: limitNum,
      filterId,
      steamid64,
    });

    res.json({
      success: true,
      game,
      ...result,
    });
  } catch (error) {
    logger.error("Failed to get quarantined jumpstats", {
      error: error.message,
    });
    res.status(500).json({ error: "Failed to get quarantined jumpstats" });
  }
});

/**
 * @swagger
 * /admin/restore-jumpstat/{id}:
 *   post:
 *     summary: Release one quarantined jumpstat
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyHeader: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Quarantined record id
 *       - in: query
 *         name: game
 *         schema:
 *           type: string
 *           default: cs2
 *     responses:
 *       200:
 *         description: Jumpstat restored
 *       400:
 *         description: Record ID is required
 *       404:
 *         description: Quarantined record not found
 *       401:
 *         description: Missing or invalid API key
 *       500:
 *         description: Server error
 */
router.post("/restore-jumpstat/:id", async (req, res) => {
  const startTime = Date.now();
  try {
    const { id } = req.params;
    const { game = "cs2" } = req.query;

    if (!id) {
      return res.status(400).json({ error: "Record ID is required" });
    }

    logger.info("Restoring quarantined jumpstat", { id, game });

    const result = await restoreJumpstat(id, game);

    logger.logRequest(req, res, Date.now() - startTime);

    if (result.success) {
      res.json({
        success: true,
        message: result.message,
        id,
        game,
      });
    } else {
      res.status(404).json({
        success: false,
        error: result.message,
      });
    }
  } catch (error) {
    logger.error("Failed to restore jumpstat", { error: error.message });
    res.status(500).json({ error: "Failed to restore jumpstat" });
  }
});

/**
 * @swagger
 * /admin/restore-all-jumpstats:
 *   post:
 *     summary: Release every quarantined jumpstat
 *     description: Reports success as a boolean from the cleanup service rather than throwing.
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyHeader: []
 *     parameters:
 *       - in: query
 *         name: game
 *         schema:
 *           type: string
 *       - in: query
 *         name: filterId
 *         schema:
 *           type: string
 *         description: Restrict to jumpstats held by one filter
 *     responses:
 *       200:
 *         description: Restore finished, with the number of rows released
 *       401:
 *         description: Missing or invalid API key
 *       500:
 *         description: Server error
 */
router.post("/restore-all-jumpstats", async (req, res) => {
  const startTime = Date.now();
  try {
    const { game, filterId } = req.query;

    if (!game) {
      return res
        .status(400)
        .json({ error: "Game parameter is required (cs2|csgo128|csgo64)" });
    }

    if (!["cs2", "csgo128", "csgo64"].includes(game)) {
      return res
        .status(400)
        .json({ error: "Invalid game. Must be cs2, csgo128, or csgo64" });
    }

    logger.info("Restoring all quarantined jumpstats", { game, filterId });

    const result = await restoreAllJumpstats(game, { filterId });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.logRequest(req, res, Date.now() - startTime);

    res.json({
      success: result.success,
      restored: result.restored,
      message: result.message,
      game,
      filterId: filterId || null,
      elapsed: `${elapsed}s`,
    });
  } catch (error) {
    logger.error("Failed to restore all jumpstats", { error: error.message });
    res.status(500).json({ error: "Failed to restore all jumpstats" });
  }
});

/**
 * @swagger
 * /admin/players/{steamid}/discord:
 *   put:
 *     summary: Link a Discord account to a player
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyHeader: []
 *     parameters:
 *       - in: path
 *         name: steamid
 *         required: true
 *         schema:
 *           type: string
 *         description: SteamID in any format
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [discord_id]
 *             properties:
 *               discord_id:
 *                 type: string
 *                 description: Discord snowflake
 *     responses:
 *       200:
 *         description: Discord account linked
 *       400:
 *         description: Invalid SteamID format
 *       401:
 *         description: Missing or invalid API key
 *       500:
 *         description: Server error
 */
router.put("/players/:steamid/discord", async (req, res) => {
  try {
    const { steamid } = req.params;
    const { discord_id } = req.body || {};

    const steamid64 = resolveSteamID(steamid);
    if (!steamid64) {
      return res.status(400).json({ error: "Invalid SteamID format" });
    }

    if (!isValidDiscordId(discord_id)) {
      return res
        .status(400)
        .json({ error: "Invalid Discord ID (must be 17-19 digit snowflake)" });
    }

    await pool.query(
      `INSERT INTO player_meta (steamid, discord_id)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE discord_id = VALUES(discord_id), updated_at = CURRENT_TIMESTAMP`,
      [steamid64, String(discord_id)],
    );

    logger.info(`Discord ID set for ${steamid64}: ${discord_id}`);
    res.json({
      success: true,
      steamid: steamid64,
      discord_id: String(discord_id),
    });
  } catch (error) {
    logger.error("Failed to set discord_id", { error: error.message });
    res.status(500).json({ error: "Failed to set discord_id" });
  }
});

/**
 * @swagger
 * /admin/players/{steamid}/discord:
 *   delete:
 *     summary: Unlink a player's Discord account
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyHeader: []
 *     parameters:
 *       - in: path
 *         name: steamid
 *         required: true
 *         schema:
 *           type: string
 *         description: SteamID in any format
 *     responses:
 *       200:
 *         description: Discord account unlinked
 *       400:
 *         description: Invalid SteamID format
 *       401:
 *         description: Missing or invalid API key
 *       500:
 *         description: Server error
 */
router.delete("/players/:steamid/discord", async (req, res) => {
  try {
    const { steamid } = req.params;

    const steamid64 = resolveSteamID(steamid);
    if (!steamid64) {
      return res.status(400).json({ error: "Invalid SteamID format" });
    }

    await pool.query(
      `INSERT INTO player_meta (steamid, discord_id)
       VALUES (?, NULL)
       ON DUPLICATE KEY UPDATE discord_id = NULL, updated_at = CURRENT_TIMESTAMP`,
      [steamid64],
    );

    logger.info(`Discord ID removed for ${steamid64}`);
    res.json({ success: true, steamid: steamid64, discord_id: null });
  } catch (error) {
    logger.error("Failed to remove discord_id", { error: error.message });
    res.status(500).json({ error: "Failed to remove discord_id" });
  }
});

/**
 * @swagger
 * /admin/players/register:
 *   post:
 *     summary: Create a player record
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyHeader: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [steamid]
 *             properties:
 *               steamid:
 *                 type: string
 *               name:
 *                 type: string
 *                 maxLength: 255
 *     responses:
 *       200:
 *         description: Player registered
 *       400:
 *         description: Invalid SteamID format
 *       401:
 *         description: Missing or invalid API key
 *       500:
 *         description: Server error
 */
router.post("/players/register", async (req, res) => {
  try {
    const { steamid, name } = req.body || {};

    const steamid64 = resolveSteamID(steamid);
    if (!steamid64) {
      return res.status(400).json({ error: "Invalid SteamID format" });
    }

    const safeName = typeof name === "string" ? name.slice(0, 255) : null;

    // Upsert a placeholder row (game='csgo') so the player appears in the DB.
    // The real playtime rows will be created when they first play on a server.
    await pool.query(
      `INSERT INTO players (steamid, latest_name, game, playtime, server_ip, server_port, last_seen)
       VALUES (?, ?, 'csgo', 0, '0.0.0.0', 0, NOW())
       ON DUPLICATE KEY UPDATE
         latest_name = COALESCE(VALUES(latest_name), latest_name)`,
      [steamid64, safeName],
    );

    logger.info(
      `Registered player ${steamid64} (${safeName}) via profile visit`,
    );
    res.json({ success: true, steamid: steamid64 });
  } catch (error) {
    logger.error("Failed to register player", { error: error.message });
    res.status(500).json({ error: "Failed to register player" });
  }
});

/**
 * @swagger
 * /admin/players/{steamid}/permissions:
 *   put:
 *     summary: Set a player's roles and custom cosmetics
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyHeader: []
 *     parameters:
 *       - in: path
 *         name: steamid
 *         required: true
 *         schema:
 *           type: string
 *         description: SteamID in any format
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [roles]
 *             properties:
 *               roles:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Must be valid role names
 *               customRole:
 *                 type: object
 *                 nullable: true
 *               customTag:
 *                 type: object
 *                 nullable: true
 *     responses:
 *       200:
 *         description: Permissions updated
 *       400:
 *         description: Invalid SteamID, roles not an array, or an invalid role/colour value
 *       401:
 *         description: Missing or invalid API key
 *       500:
 *         description: Server error
 */
router.put("/players/:steamid/permissions", async (req, res) => {
  try {
    const { steamid } = req.params;
    const { roles, customRole = null, customTag = null } = req.body || {};

    const steamid64 = resolveSteamID(steamid);
    if (!steamid64) {
      return res.status(400).json({ error: "Invalid SteamID format" });
    }

    if (!Array.isArray(roles)) {
      return res.status(400).json({ error: "roles must be an array" });
    }
    const invalidRoles = roles.filter((r) => !VALID_ROLES.includes(r));
    if (invalidRoles.length) {
      return res.status(400).json({
        error: `Invalid roles: ${invalidRoles.join(", ")}. Valid: ${VALID_ROLES.join(", ")}`,
      });
    }

    // Validate customRole object
    let validatedCustomRole = null;
    if (customRole !== null && customRole !== undefined) {
      if (typeof customRole !== "object" || Array.isArray(customRole)) {
        return res.status(400).json({
          error: "customRole must be an object { id, color, name } or null",
        });
      }
      const { id, color, name } = customRole;
      if (!id || typeof id !== "string") {
        return res
          .status(400)
          .json({ error: "customRole.id is required and must be a string" });
      }
      if (!isValidHexColor(color)) {
        return res
          .status(400)
          .json({ error: "customRole.color must be a hex color (#RRGGBB)" });
      }
      if (!name || typeof name !== "string") {
        return res
          .status(400)
          .json({ error: "customRole.name is required and must be a string" });
      }
      validatedCustomRole = {
        id: String(id),
        color: String(color),
        name: String(name),
      };
    }

    // Validate customTag object
    let validatedCustomTag = null;
    if (customTag !== null && customTag !== undefined) {
      if (typeof customTag !== "object" || Array.isArray(customTag)) {
        return res.status(400).json({
          error: "customTag must be an object { color, name } or null",
        });
      }
      const { color, name } = customTag;
      if (!color || !VALID_TAG_COLORS.includes(color)) {
        return res.status(400).json({
          error: `customTag.color must be one of: ${VALID_TAG_COLORS.join(", ")}`,
        });
      }
      if (typeof name !== "string") {
        return res
          .status(400)
          .json({ error: "customTag.name must be a string" });
      }
      validatedCustomTag = { color: String(color), name: String(name) };
    }

    const permissions = {
      roles,
      customRole: validatedCustomRole,
      customTag: validatedCustomTag,
    };

    await pool.query(
      `INSERT INTO player_meta (steamid, permissions)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE permissions = VALUES(permissions), updated_at = CURRENT_TIMESTAMP`,
      [steamid64, JSON.stringify(permissions)],
    );

    logger.info(`Permissions set for ${steamid64}`, { permissions });
    res.json({ success: true, steamid: steamid64, permissions });
  } catch (error) {
    logger.error("Failed to set permissions", { error: error.message });
    res.status(500).json({ error: "Failed to set permissions" });
  }
});

/**
 * @swagger
 * /admin/players/{steamid}/permissions:
 *   delete:
 *     summary: Revoke a player's permissions
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyHeader: []
 *     parameters:
 *       - in: path
 *         name: steamid
 *         required: true
 *         schema:
 *           type: string
 *         description: SteamID in any format
 *     responses:
 *       200:
 *         description: Permissions revoked
 *       400:
 *         description: Invalid SteamID format
 *       401:
 *         description: Missing or invalid API key
 *       500:
 *         description: Server error
 */
router.delete("/players/:steamid/permissions", async (req, res) => {
  try {
    const { steamid } = req.params;

    const steamid64 = resolveSteamID(steamid);
    if (!steamid64) {
      return res.status(400).json({ error: "Invalid SteamID format" });
    }

    await pool.query(
      `INSERT INTO player_meta (steamid, permissions)
       VALUES (?, NULL)
       ON DUPLICATE KEY UPDATE permissions = NULL, updated_at = CURRENT_TIMESTAMP`,
      [steamid64],
    );

    logger.info(`Permissions removed for ${steamid64}`);
    res.json({ success: true, steamid: steamid64, permissions: null });
  } catch (error) {
    logger.error("Failed to remove permissions", { error: error.message });
    res.status(500).json({ error: "Failed to remove permissions" });
  }
});

/**
 * @swagger
 * /admin/players/{steamid}/whitelist:
 *   put:
 *     summary: Set a player's whitelist state
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyHeader: []
 *     parameters:
 *       - in: path
 *         name: steamid
 *         required: true
 *         schema:
 *           type: string
 *         description: SteamID in any format
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [whitelisted]
 *             properties:
 *               whitelisted:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Whitelist state updated
 *       400:
 *         description: Invalid SteamID, or whitelisted is not a boolean
 *       401:
 *         description: Missing or invalid API key
 *       500:
 *         description: Server error
 */
router.put("/players/:steamid/whitelist", async (req, res) => {
  try {
    const { steamid } = req.params;
    const { whitelisted } = req.body || {};

    const steamid64 = resolveSteamID(steamid);
    if (!steamid64) {
      return res.status(400).json({ error: "Invalid SteamID format" });
    }

    if (typeof whitelisted !== "boolean") {
      return res.status(400).json({ error: "whitelisted must be a boolean" });
    }

    await pool.query(
      `INSERT INTO player_meta (steamid, whitelisted)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE whitelisted = VALUES(whitelisted), updated_at = CURRENT_TIMESTAMP`,
      [steamid64, whitelisted],
    );

    logger.info(`Whitelist set for ${steamid64}: ${whitelisted}`);
    res.json({ success: true, steamid: steamid64, whitelisted });
  } catch (error) {
    logger.error("Failed to set whitelist", { error: error.message });
    res.status(500).json({ error: "Failed to set whitelist" });
  }
});

/**
 * @swagger
 * /admin/cache/invalidate:
 *   post:
 *     summary: Drop Redis cache entries
 *     description: A pattern of * flushes the whole cache.
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyHeader: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [pattern]
 *             properties:
 *               pattern:
 *                 type: string
 *                 description: Key pattern, or * for everything
 *     responses:
 *       200:
 *         description: Cache entries dropped
 *       400:
 *         description: pattern is required
 *       401:
 *         description: Missing or invalid API key
 *       500:
 *         description: Server error
 */
router.post("/cache/invalidate", async (req, res) => {
  const { pattern } = req.body;
  if (!pattern || typeof pattern !== "string") {
    return res.status(400).json({ error: "pattern is required" });
  }
  try {
    if (pattern === "*") {
      await flushCache();
      return res.json({ success: true, message: "All cache flushed" });
    }
    await deleteCache(pattern);
    res.json({ success: true, pattern });
  } catch (error) {
    logger.error("Cache invalidation failed", { error: error.message });
    res.status(500).json({ error: "Cache invalidation failed" });
  }
});

module.exports = router;
