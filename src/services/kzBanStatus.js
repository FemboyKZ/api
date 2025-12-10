/**
 * KZ Ban Status Service
 *
 * Manages player ban status in the kz_players table based on kz_bans data.
 * This service handles two main functions:
 * 1. Immediate update of is_banned when new bans are scraped
 * 2. Periodic cleanup of expired bans (unbanning players)
 *
 * Features:
 * - Real-time ban status updates
 * - Periodic expired ban checks (configurable interval)
 * - Handles permanent bans (expires_on IS NULL)
 * - Handles temporary bans (expires_on > NOW())
 * - Batch processing for efficiency
 * - Comprehensive logging and statistics
 *
 * Configuration (via .env):
 *   KZ_BAN_CLEANUP_INTERVAL=3600000  # How often to check for expired bans (ms) - default 1 hour
 *   KZ_BAN_CLEANUP_ENABLED=true      # Enable/disable expired ban cleanup
 *
 * Usage:
 *   const banStatus = require('./services/kzBanStatus');
 *   banStatus.startBanCleanupJob(3600000); // Check every hour
 *   await banStatus.updatePlayerBanStatus(['76561198000000001', '76561198000000002']);
 */

require("dotenv").config();
const logger = require("../utils/logger");
const { getKzPool } = require("../db/kzRecords");

// Configuration
const CLEANUP_INTERVAL =
  parseInt(process.env.KZ_BAN_CLEANUP_INTERVAL) || 3600000; // 1 hour
const CLEANUP_ENABLED = process.env.KZ_BAN_CLEANUP_ENABLED !== "false"; // Default true

// State tracking
let isCleanupRunning = false;
let lastCleanupRun = 0;
const stats = {
  startTime: null,
  totalBansProcessed: 0,
  totalUnbans: 0,
  totalBans: 0,
  lastCleanupDuration: 0,
  lastCleanupTime: null,
  errors: 0,
};

/**
 * Update ban status for specific players
 * Called when new bans are inserted/updated in kz_bans table
 *
 * @param {Array<string>} steamIds - Array of steamid64 values to check
 * @returns {Promise<Object>} Update statistics
 */
async function updatePlayerBanStatus(steamIds) {
  if (!steamIds || steamIds.length === 0) {
    return { banned: 0, unbanned: 0 };
  }

  const pool = getKzPool();
  const connection = await pool.getConnection();

  try {
    let bannedCount = 0;
    let unbannedCount = 0;

    // Process in batches of 100 to avoid too large IN clauses
    const batchSize = 100;
    for (let i = 0; i < steamIds.length; i += batchSize) {
      const batch = steamIds.slice(i, i + batchSize);
      const placeholders = batch.map(() => "?").join(",");

      // Find players with active bans
      const [activeBans] = await connection.query(
        `
        SELECT DISTINCT steamid64
        FROM kz_bans
        WHERE steamid64 IN (${placeholders})
          AND (expires_on IS NULL OR expires_on > NOW())
      `,
        batch,
      );

      const activeSteamIds = activeBans.map((row) => row.steamid64);
      const inactiveSteamIds = batch.filter(
        (id) => !activeSteamIds.includes(id),
      );

      // Update players with active bans to banned
      if (activeSteamIds.length > 0) {
        const activePlaceholders = activeSteamIds.map(() => "?").join(",");
        const [banResult] = await connection.query(
          `
          UPDATE kz_players
          SET is_banned = TRUE, updated_at = CURRENT_TIMESTAMP
          WHERE steamid64 IN (${activePlaceholders})
            AND is_banned = FALSE
        `,
          activeSteamIds,
        );
        bannedCount += banResult.affectedRows;
      }

      // Update players with no active bans to unbanned
      if (inactiveSteamIds.length > 0) {
        const inactivePlaceholders = inactiveSteamIds.map(() => "?").join(",");
        const [unbanResult] = await connection.query(
          `
          UPDATE kz_players
          SET is_banned = FALSE, updated_at = CURRENT_TIMESTAMP
          WHERE steamid64 IN (${inactivePlaceholders})
            AND is_banned = TRUE
        `,
          inactiveSteamIds,
        );
        unbannedCount += unbanResult.affectedRows;
      }
    }

    stats.totalBans += bannedCount;
    stats.totalUnbans += unbannedCount;

    logger.debug(
      `[KZ Ban Status] Updated ${steamIds.length} players: ${bannedCount} banned, ${unbannedCount} unbanned`,
    );

    return { banned: bannedCount, unbanned: unbannedCount };
  } catch (error) {
    logger.error(`[KZ Ban Status] Error updating player ban status:`, error);
    stats.errors++;
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Clean up expired bans - unban players whose bans have expired
 * This runs periodically to ensure is_banned stays accurate
 *
 * @returns {Promise<Object>} Cleanup statistics
 */
async function cleanupExpiredBans() {
  if (isCleanupRunning) {
    logger.debug(
      "[KZ Ban Status] Cleanup already running, skipping this iteration",
    );
    return { unbanned: 0, stillBanned: 0 };
  }

  const now = Date.now();
  if (now - lastCleanupRun < CLEANUP_INTERVAL) {
    return { unbanned: 0, stillBanned: 0 }; // Not time yet
  }

  isCleanupRunning = true;
  lastCleanupRun = now;
  const startTime = Date.now();

  const pool = getKzPool();
  const connection = await pool.getConnection();

  try {
    logger.info("[KZ Ban Status] Starting expired bans cleanup...");

    // Find all players currently marked as banned
    const [bannedPlayers] = await connection.query(
      "SELECT steamid64 FROM kz_players WHERE is_banned = TRUE",
    );

    if (bannedPlayers.length === 0) {
      logger.info("[KZ Ban Status] No banned players to check");
      return { unbanned: 0, stillBanned: 0 };
    }

    logger.debug(
      `[KZ Ban Status] Checking ${bannedPlayers.length} banned players for expired bans...`,
    );

    const steamIds = bannedPlayers.map((p) => p.steamid64);
    let unbannedCount = 0;
    let stillBannedCount = 0;

    // Process in batches
    const batchSize = 100;
    for (let i = 0; i < steamIds.length; i += batchSize) {
      const batch = steamIds.slice(i, i + batchSize);
      const placeholders = batch.map(() => "?").join(",");

      // Find players who still have active bans
      const [activeBans] = await connection.query(
        `
        SELECT DISTINCT steamid64
        FROM kz_bans
        WHERE steamid64 IN (${placeholders})
          AND (expires_on IS NULL OR expires_on > NOW())
      `,
        batch,
      );

      const activeSteamIds = activeBans.map((row) => row.steamid64);
      const expiredSteamIds = batch.filter(
        (id) => !activeSteamIds.includes(id),
      );

      stillBannedCount += activeSteamIds.length;

      // Unban players with no active bans
      if (expiredSteamIds.length > 0) {
        const expiredPlaceholders = expiredSteamIds.map(() => "?").join(",");
        const [result] = await connection.query(
          `
          UPDATE kz_players
          SET is_banned = FALSE, updated_at = CURRENT_TIMESTAMP
          WHERE steamid64 IN (${expiredPlaceholders})
        `,
          expiredSteamIds,
        );
        unbannedCount += result.affectedRows;
      }
    }

    const duration = Date.now() - startTime;
    stats.lastCleanupDuration = duration;
    stats.lastCleanupTime = new Date().toISOString();
    stats.totalUnbans += unbannedCount;
    stats.totalBansProcessed += bannedPlayers.length;

    logger.info(
      `[KZ Ban Status] Cleanup complete in ${duration}ms: ${unbannedCount} unbanned, ${stillBannedCount} still banned`,
    );

    return { unbanned: unbannedCount, stillBanned: stillBannedCount };
  } catch (error) {
    logger.error(`[KZ Ban Status] Error during cleanup:`, error);
    stats.errors++;
    throw error;
  } finally {
    isCleanupRunning = false;
    connection.release();
  }
}

/**
 * Ensure all players in kz_bans table exist in kz_players
 * and have correct initial ban status
 *
 * @returns {Promise<Object>} Sync statistics
 */
async function syncBannedPlayers() {
  const pool = getKzPool();
  const connection = await pool.getConnection();

  try {
    logger.info("[KZ Ban Status] Syncing banned players...");

    // Get all unique steamid64s from bans
    const [bannedSteamIds] = await connection.query(`
      SELECT DISTINCT steamid64, player_name, steam_id
      FROM kz_bans
      WHERE steamid64 IS NOT NULL
        AND (expires_on IS NULL OR expires_on > NOW())
    `);

    let created = 0;
    let updated = 0;

    for (const ban of bannedSteamIds) {
      // Insert player if doesn't exist, or update ban status if exists
      const [result] = await connection.query(
        `
        INSERT INTO kz_players (steamid64, steam_id, player_name, is_banned)
        VALUES (?, ?, ?, TRUE)
        ON DUPLICATE KEY UPDATE
          is_banned = TRUE,
          updated_at = CURRENT_TIMESTAMP
      `,
        [
          ban.steamid64,
          ban.steam_id || `STEAM_ID_${ban.steamid64}`,
          ban.player_name || `Player ${ban.steamid64}`,
        ],
      );

      if (result.affectedRows === 1) {
        created++;
      } else if (result.affectedRows === 2) {
        updated++;
      }
    }

    logger.info(
      `[KZ Ban Status] Sync complete: ${created} players created, ${updated} updated`,
    );

    return { created, updated, total: bannedSteamIds.length };
  } catch (error) {
    logger.error(`[KZ Ban Status] Error syncing banned players:`, error);
    stats.errors++;
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Start the periodic ban cleanup job
 *
 * @param {number} intervalMs - How often to run cleanup (default from env)
 */
async function startBanCleanupJob(intervalMs = CLEANUP_INTERVAL) {
  if (!CLEANUP_ENABLED) {
    logger.info("[KZ Ban Status] Ban cleanup job is disabled");
    return;
  }

  logger.info(
    `[KZ Ban Status] Starting ban cleanup job (interval: ${intervalMs / 1000}s)`,
  );

  // Test database connection first
  try {
    const pool = getKzPool();
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
    logger.info("[KZ Ban Status] Database connection verified");
  } catch (error) {
    logger.error(
      `[KZ Ban Status] Failed to connect to KZ database: ${error.message}`,
    );
    logger.error("[KZ Ban Status] Ban cleanup job will not start");
    return;
  }

  // Initialize stats
  stats.startTime = Date.now();

  // Run initial sync to ensure consistency
  try {
    await syncBannedPlayers();
  } catch (error) {
    logger.error(
      `[KZ Ban Status] Initial sync failed, continuing anyway: ${error.message}`,
    );
  }

  // Run cleanup immediately, then on interval
  setTimeout(() => {
    cleanupExpiredBans().catch((error) => {
      logger.error(`[KZ Ban Status] Cleanup failed: ${error.message}`);
    });

    setInterval(() => {
      cleanupExpiredBans().catch((error) => {
        logger.error(`[KZ Ban Status] Cleanup failed: ${error.message}`);
      });
    }, intervalMs);
  }, 5000); // Small delay to let server initialize
}

/**
 * Get current ban status service statistics
 *
 * @returns {Object} Service statistics
 */
function getStats() {
  const uptime = stats.startTime ? (Date.now() - stats.startTime) / 1000 : 0;
  const timeSinceLastCleanup = lastCleanupRun
    ? (Date.now() - lastCleanupRun) / 1000
    : null;

  return {
    isCleanupRunning,
    uptime: Math.round(uptime),
    cleanupInterval: CLEANUP_INTERVAL / 1000,
    totalBansProcessed: stats.totalBansProcessed,
    totalBans: stats.totalBans,
    totalUnbans: stats.totalUnbans,
    errors: stats.errors,
    lastCleanupTime: stats.lastCleanupTime,
    lastCleanupDuration: stats.lastCleanupDuration,
    timeSinceLastCleanup: timeSinceLastCleanup
      ? Math.round(timeSinceLastCleanup)
      : null,
    nextCleanupIn: timeSinceLastCleanup
      ? Math.max(0, Math.round(CLEANUP_INTERVAL / 1000 - timeSinceLastCleanup))
      : null,
  };
}

/**
 * Manual trigger for ban status update (for specific players)
 * Can be called from admin API
 *
 * @param {Array<string>} steamIds - Optional array of steamid64s to check
 * @returns {Promise<Object>} Update results
 */
async function manualBanStatusUpdate(steamIds = null) {
  logger.info(
    `[KZ Ban Status] Manual ban status update triggered${steamIds ? ` for ${steamIds.length} players` : " (all banned players)"}`,
  );

  if (steamIds && steamIds.length > 0) {
    return await updatePlayerBanStatus(steamIds);
  } else {
    // Update all currently banned players
    return await cleanupExpiredBans();
  }
}

module.exports = {
  startBanCleanupJob,
  updatePlayerBanStatus,
  cleanupExpiredBans,
  syncBannedPlayers,
  manualBanStatusUpdate,
  getStats,
};
