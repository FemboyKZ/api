const express = require("express");
const router = express.Router();
const pool = require("../db");
const logger = require("../utils/logger");
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

module.exports = router;
