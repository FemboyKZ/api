const express = require("express");
const router = express.Router();
const pool = require("../db");
const logger = require("../utils/logger");
const { isValidSteamID, convertToSteamID64 } = require("../utils/validators");

const VALID_ROLES = [
  "owner",
  "admin",
  "mod",
  "dev",
  "vip",
  "vip+",
  "contributor",
  "og",
  "gmc",
];
const VALID_TAG_COLORS = [
  "default",
  "darkred",
  "purple",
  "green",
  "olive",
  "lime",
  "red",
  "grey",
  "yellow",
  "bluegrey",
  "blue",
  "darkblue",
  "orchid",
  "lightred",
  "gold",
];
const { getStats: getScraperStats } = require("../services/kzRecordsScraper");
const {
  getStats: getBanStatusStats,
  manualBanStatusUpdate,
  cleanupExpiredBans,
} = require("../services/kzBanStatus");
const {
  refreshAllStatistics,
  refreshPlayerStatistics,
  refreshMapStatistics,
  refreshServerStatistics,
  populateAllStatistics,
  getStatisticsSummary,
} = require("../services/kzStatistics");
const {
  runCleanup: runJumpstatCleanup,
  getQuarantinedJumpstats,
  restoreJumpstat,
  restoreAllJumpstats,
  getAvailableFilters: getJumpstatFilters,
} = require("../services/jumpstatCleanup");

/**
 * GET /admin/scraper-status
 * Get current KZ Records scraper statistics
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
 * POST /admin/aggregate-daily
 * Manually trigger daily statistics aggregation
 * Should be run via cron job daily at midnight
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
      const [stats] = await pool.query(
        `SELECT 
          COUNT(DISTINCT steamid) as unique_players,
          MAX(player_count) as peak_players,
          AVG(player_count) as avg_players,
          COUNT(*) as data_points
        FROM server_history sh
        LEFT JOIN player_sessions ps ON 
          ps.server_ip = sh.server_ip AND 
          ps.server_port = sh.server_port AND 
          DATE(ps.joined_at) = DATE(sh.recorded_at)
        WHERE sh.server_ip = ? 
          AND sh.server_port = ? 
          AND DATE(sh.recorded_at) = ?`,
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

      // Calculate uptime (assuming 30-second polling interval)
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
          stats[0].unique_players || 0,
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
 * POST /admin/cleanup-history
 * Clean up old historical data based on retention policy
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
 * GET /admin/ban-status
 * Get current KZ ban status service statistics
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
 * POST /admin/update-ban-status
 * Manually trigger ban status update for specific players or all banned players
 * Body: { steamIds?: string[] } - Optional array of steamid64s to check
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
 * POST /admin/cleanup-expired-bans
 * Manually trigger cleanup of expired bans (unban players)
 */
router.post("/cleanup-expired-bans", async (req, res) => {
  const startTime = Date.now();
  try {
    logger.info("Manual expired bans cleanup triggered");

    const result = await cleanupExpiredBans();

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
 * GET /admin/kz-statistics
 * Get current KZ statistics status and summary
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
 * POST /admin/refresh-kz-statistics
 * Manually trigger KZ statistics refresh
 * Query params: type=all|players|maps|servers (default: all)
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
 * POST /admin/populate-kz-statistics
 * Trigger initial population of KZ statistics tables
 * WARNING: This may take a long time for large databases
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
 * GET /admin/jumpstat-filters
 * Get list of available jumpstat cleanup filters
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
 * POST /admin/cleanup-jumpstats
 * Run jumpstat cleanup with configured filters
 * Query params:
 *   - dryRun: boolean (default: true) - If true, only report what would be cleaned
 *   - game: string (cs2|csgo|csgo128|csgo64|all, default: all)
 *   - filterId: string - Run only a specific filter by ID
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
 * GET /admin/quarantined-jumpstats
 * Get list of quarantined jumpstats
 * Query params:
 *   - game: string (cs2|csgo128|csgo64, default: cs2)
 *   - page: number (default: 1)
 *   - limit: number (default: 50, max: 100)
 *   - filterId: string - Filter by specific filter ID
 *   - steamid64: string - Filter by player
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
 * POST /admin/restore-jumpstat/:id
 * Restore a quarantined jumpstat back to the main table
 * Path params:
 *   - id: string - Record ID to restore
 * Query params:
 *   - game: string (cs2|csgo128|csgo64, default: cs2)
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
 * POST /admin/restore-all-jumpstats
 * Restore all quarantined jumpstats back to the main table
 * Query params:
 *   - game: string (cs2|csgo128|csgo64, required)
 *   - filterId: string (optional - only restore records from this filter)
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
 * PUT /admin/players/:steamid/discord
 * Set or update a player's Discord ID
 * Body: { discord_id: "snowflake_string" }
 */
router.put("/players/:steamid/discord", async (req, res) => {
  try {
    const { steamid } = req.params;
    const { discord_id } = req.body || {};

    if (!isValidSteamID(steamid)) {
      return res.status(400).json({ error: "Invalid SteamID format" });
    }
    const steamid64 = convertToSteamID64(steamid);
    if (!steamid64) {
      return res.status(400).json({ error: "Failed to convert SteamID" });
    }

    if (!discord_id || !/^\d{17,19}$/.test(String(discord_id))) {
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
 * DELETE /admin/players/:steamid/discord
 * Remove a player's linked Discord ID
 */
router.delete("/players/:steamid/discord", async (req, res) => {
  try {
    const { steamid } = req.params;

    if (!isValidSteamID(steamid)) {
      return res.status(400).json({ error: "Invalid SteamID format" });
    }
    const steamid64 = convertToSteamID64(steamid);
    if (!steamid64) {
      return res.status(400).json({ error: "Failed to convert SteamID" });
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
 * PUT /admin/players/:steamid/permissions
 * Set or update a player's permissions
 * Body: {
 *   roles: string[],
 *   customRole: { id: string, color: string, name: string } | null,
 *   customTag:  { color: string, name: string } | null
 * }
 * Valid roles: owner, admin, mod, dev, vip, vip+, contributor, og, gmc
 * Valid tag colors: default darkred purple green olive lime red grey yellow bluegrey blue darkblue orchid lightred gold
 */
router.put("/players/:steamid/permissions", async (req, res) => {
  try {
    const { steamid } = req.params;
    const { roles, customRole = null, customTag = null } = req.body || {};

    if (!isValidSteamID(steamid)) {
      return res.status(400).json({ error: "Invalid SteamID format" });
    }
    const steamid64 = convertToSteamID64(steamid);
    if (!steamid64) {
      return res.status(400).json({ error: "Failed to convert SteamID" });
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
        return res
          .status(400)
          .json({
            error: "customRole must be an object { id, color, name } or null",
          });
      }
      const { id, color, name } = customRole;
      if (!id || typeof id !== "string") {
        return res
          .status(400)
          .json({ error: "customRole.id is required and must be a string" });
      }
      if (!color || typeof color !== "string") {
        return res
          .status(400)
          .json({ error: "customRole.color is required and must be a string" });
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
        return res
          .status(400)
          .json({
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
 * DELETE /admin/players/:steamid/permissions
 * Remove a player's permissions (set to null)
 */
router.delete("/players/:steamid/permissions", async (req, res) => {
  try {
    const { steamid } = req.params;

    if (!isValidSteamID(steamid)) {
      return res.status(400).json({ error: "Invalid SteamID format" });
    }
    const steamid64 = convertToSteamID64(steamid);
    if (!steamid64) {
      return res.status(400).json({ error: "Failed to convert SteamID" });
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
 * PUT /admin/players/:steamid/whitelist
 * Set or clear the whitelisted flag for a player
 * Body: { whitelisted: boolean }
 */
router.put("/players/:steamid/whitelist", async (req, res) => {
  try {
    const { steamid } = req.params;
    const { whitelisted } = req.body || {};

    if (!isValidSteamID(steamid)) {
      return res.status(400).json({ error: "Invalid SteamID format" });
    }
    const steamid64 = convertToSteamID64(steamid);
    if (!steamid64) {
      return res.status(400).json({ error: "Failed to convert SteamID" });
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

module.exports = router;
