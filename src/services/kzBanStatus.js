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
const DEADLOCK_MAX_RETRIES = 5; // Increased for lock wait timeouts
const DEADLOCK_RETRY_DELAY = 500; // ms - base delay, will use exponential backoff

// State tracking
let isCleanupRunning = false;
let lastCleanupRun = 0;
const stats = {
  startTime: null,
  totalBansProcessed: 0,
  totalUnbans: 0,
  totalBans: 0,
  totalRecordsArchived: 0,
  totalRecordsRestored: 0,
  lastCleanupDuration: 0,
  lastCleanupTime: null,
  errors: 0,
};

/**
 * Helper to retry a query on deadlock or lock wait timeout
 * @param {Function} queryFn - Async function that executes the query
 * @param {number} maxRetries - Maximum number of retry attempts
 * @param {number} delayMs - Delay between retries in milliseconds
 * @returns {Promise<any>} Query result
 */
async function retryOnDeadlock(
  queryFn,
  maxRetries = DEADLOCK_MAX_RETRIES,
  delayMs = DEADLOCK_RETRY_DELAY,
) {
  // Retryable lock-related errors
  const RETRYABLE_ERRORS = ["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"];

  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await queryFn();
    } catch (error) {
      lastError = error;
      if (RETRYABLE_ERRORS.includes(error.code) && attempt < maxRetries) {
        // Exponential backoff with jitter
        const jitter = Math.random() * delayMs;
        const waitTime = delayMs * Math.pow(2, attempt - 1) + jitter;
        logger.warn(
          `[KZ Ban Status] Lock error (${error.code}), retrying in ${Math.round(waitTime)}ms (attempt ${attempt}/${maxRetries})`,
        );
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      } else {
        throw error;
      }
    }
  }
  throw lastError;
}

/**
 * Archive records for a permanently banned player
 * Moves records from kz_records_partitioned to kz_banned_records
 *
 * @param {string} steamid64 - Player's steamid64
 * @param {number|null} banId - Ban ID from kz_bans table (optional)
 * @returns {Promise<Object>} Archive statistics
 */
async function archiveBannedPlayerRecords(steamid64, banId = null) {
  const pool = getKzPool();
  const connection = await pool.getConnection();

  try {
    // Call the stored procedure
    const [results] = await connection.query(
      "CALL archive_banned_player_records(?, ?)",
      [steamid64, banId],
    );

    const result = results[0] || { records_archived: 0, already_archived: 0 };

    if (result.records_archived > 0) {
      stats.totalRecordsArchived += result.records_archived;
      logger.info(
        `[KZ Ban Status] Archived ${result.records_archived} records for player ${steamid64}`,
      );
    } else if (result.already_archived > 0) {
      logger.debug(
        `[KZ Ban Status] Player ${steamid64} already has ${result.already_archived} archived records`,
      );
    }

    return {
      archived: result.records_archived,
      alreadyArchived: result.already_archived,
    };
  } catch (error) {
    // If stored procedure doesn't exist, log warning and continue
    if (error.code === "ER_SP_DOES_NOT_EXIST") {
      logger.warn(
        "[KZ Ban Status] archive_banned_player_records procedure not found. Run the migration: db/migrations/add_banned_records_archive.sql",
      );
      return { archived: 0, alreadyArchived: 0, error: "procedure_not_found" };
    }
    logger.error(
      `[KZ Ban Status] Error archiving records for ${steamid64}:`,
      error,
    );
    stats.errors++;
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Restore records for an unbanned player
 * Moves records back from kz_banned_records to kz_records_partitioned
 *
 * @param {string} steamid64 - Player's steamid64
 * @returns {Promise<Object>} Restore statistics
 */
async function restoreUnbannedPlayerRecords(steamid64) {
  const pool = getKzPool();
  const connection = await pool.getConnection();

  try {
    // Call the stored procedure
    const [results] = await connection.query(
      "CALL restore_unbanned_player_records(?)",
      [steamid64],
    );

    const result = results[0] || { records_restored: 0 };

    if (result.records_restored > 0) {
      stats.totalRecordsRestored += result.records_restored;
      logger.info(
        `[KZ Ban Status] Restored ${result.records_restored} records for player ${steamid64}`,
      );
    }

    return { restored: result.records_restored };
  } catch (error) {
    // If stored procedure doesn't exist, log warning and continue
    if (error.code === "ER_SP_DOES_NOT_EXIST") {
      logger.warn(
        "[KZ Ban Status] restore_unbanned_player_records procedure not found. Run the migration: db/migrations/add_banned_records_archive.sql",
      );
      return { restored: 0, error: "procedure_not_found" };
    }
    logger.error(
      `[KZ Ban Status] Error restoring records for ${steamid64}:`,
      error,
    );
    stats.errors++;
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Batch archive records for all permanently banned players
 * More efficient than archiving one by one
 *
 * @returns {Promise<Object>} Archive statistics
 */
async function batchArchiveBannedRecords() {
  const pool = getKzPool();
  const connection = await pool.getConnection();

  try {
    logger.info("[KZ Ban Status] Starting batch archive of banned records...");

    // Call the stored procedure
    const [results] = await connection.query(
      "CALL batch_archive_banned_records()",
    );

    const result = results[0] || { records_archived: 0, players_processed: 0 };

    if (result.records_archived > 0) {
      stats.totalRecordsArchived += result.records_archived;
      logger.info(
        `[KZ Ban Status] Batch archived ${result.records_archived} records for ${result.players_processed} banned players`,
      );
    } else {
      logger.debug("[KZ Ban Status] No records to archive");
    }

    return {
      archived: result.records_archived,
      playersProcessed: result.players_processed,
    };
  } catch (error) {
    // If stored procedure doesn't exist, log warning and continue
    if (error.code === "ER_SP_DOES_NOT_EXIST") {
      logger.warn(
        "[KZ Ban Status] batch_archive_banned_records procedure not found. Run the migration: db/migrations/add_banned_records_archive.sql",
      );
      return { archived: 0, playersProcessed: 0, error: "procedure_not_found" };
    }
    logger.error(`[KZ Ban Status] Error in batch archive:`, error);
    stats.errors++;
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Update ban status for specific players
 * Called when new bans are inserted/updated in kz_bans table
 * Also archives records for permanently banned players
 *
 * @param {Array<string>} steamIds - Array of steamid64 values to check
 * @param {boolean} archiveRecords - Whether to archive records for permanent bans (default: true)
 * @returns {Promise<Object>} Update statistics
 */
async function updatePlayerBanStatus(steamIds, archiveRecords = true) {
  if (!steamIds || steamIds.length === 0) {
    return { banned: 0, unbanned: 0, recordsArchived: 0, recordsRestored: 0 };
  }

  const pool = getKzPool();
  const connection = await pool.getConnection();

  try {
    let bannedCount = 0;
    let unbannedCount = 0;
    let recordsArchived = 0;
    let recordsRestored = 0;

    // Process in batches of 100 to avoid too large IN clauses
    const batchSize = 100;
    for (let i = 0; i < steamIds.length; i += batchSize) {
      const batch = steamIds.slice(i, i + batchSize);
      const placeholders = batch.map(() => "?").join(",");

      // Find players with active bans (including permanent and temporary)
      const [activeBans] = await connection.query(
        `
        SELECT DISTINCT b.steamid64, b.id AS ban_id, b.expires_on
        FROM kz_bans b
        WHERE b.steamid64 IN (${placeholders})
          AND b.expires_on > NOW()
      `,
        batch,
      );

      const activeSteamIds = activeBans.map((row) => row.steamid64);
      // Permanent bans have expires_on = '9999-12-31 23:59:59'
      const permanentBanDate = new Date("9999-12-31T23:59:59Z").getTime();
      const permanentBans = activeBans.filter((row) => {
        if (!row.expires_on) return false;
        const expiresTime = new Date(row.expires_on).getTime();
        return expiresTime === permanentBanDate;
      });
      const inactiveSteamIds = batch.filter(
        (id) => !activeSteamIds.includes(id),
      );

      // Update players with active bans to banned
      if (activeSteamIds.length > 0) {
        const activePlaceholders = activeSteamIds.map(() => "?").join(",");
        const [banResult] = await retryOnDeadlock(() =>
          connection.query(
            `
          UPDATE kz_players
          SET is_banned = TRUE, updated_at = CURRENT_TIMESTAMP
          WHERE steamid64 IN (${activePlaceholders})
            AND is_banned = FALSE
        `,
            activeSteamIds,
          ),
        );
        bannedCount += banResult.affectedRows;
      }

      // Archive records for permanently banned players
      if (archiveRecords && permanentBans.length > 0) {
        // Release connection before calling archive (it gets its own)
        connection.release();

        for (const ban of permanentBans) {
          try {
            const result = await archiveBannedPlayerRecords(
              ban.steamid64,
              ban.ban_id,
            );
            recordsArchived += result.archived || 0;
          } catch (archiveError) {
            // Log but don't fail the whole operation
            logger.warn(
              `[KZ Ban Status] Failed to archive records for ${ban.steamid64}: ${archiveError.message}`,
            );
          }
        }

        // Get a new connection for the rest of the operations
        const newConnection = await pool.getConnection();

        // Update players with no active bans to unbanned
        if (inactiveSteamIds.length > 0) {
          const inactivePlaceholders = inactiveSteamIds
            .map(() => "?")
            .join(",");
          const [unbanResult] = await retryOnDeadlock(() =>
            newConnection.query(
              `
            UPDATE kz_players
            SET is_banned = FALSE, updated_at = CURRENT_TIMESTAMP
            WHERE steamid64 IN (${inactivePlaceholders})
              AND is_banned = TRUE
          `,
              inactiveSteamIds,
            ),
          );
          unbannedCount += unbanResult.affectedRows;

          // Restore records for unbanned players
          for (const steamid64 of inactiveSteamIds) {
            try {
              const result = await restoreUnbannedPlayerRecords(steamid64);
              recordsRestored += result.restored || 0;
            } catch (restoreError) {
              logger.warn(
                `[KZ Ban Status] Failed to restore records for ${steamid64}: ${restoreError.message}`,
              );
            }
          }
        }

        newConnection.release();
        // Skip the finally block since we already released
        stats.totalBans += bannedCount;
        stats.totalUnbans += unbannedCount;

        logger.debug(
          `[KZ Ban Status] Updated ${steamIds.length} players: ${bannedCount} banned, ${unbannedCount} unbanned, ${recordsArchived} records archived, ${recordsRestored} records restored`,
        );

        return {
          banned: bannedCount,
          unbanned: unbannedCount,
          recordsArchived,
          recordsRestored,
        };
      }

      // Update players with no active bans to unbanned (when no archiving needed)
      if (inactiveSteamIds.length > 0) {
        const inactivePlaceholders = inactiveSteamIds.map(() => "?").join(",");
        const [unbanResult] = await retryOnDeadlock(() =>
          connection.query(
            `
          UPDATE kz_players
          SET is_banned = FALSE, updated_at = CURRENT_TIMESTAMP
          WHERE steamid64 IN (${inactivePlaceholders})
            AND is_banned = TRUE
        `,
            inactiveSteamIds,
          ),
        );
        unbannedCount += unbanResult.affectedRows;
      }
    }

    stats.totalBans += bannedCount;
    stats.totalUnbans += unbannedCount;

    logger.debug(
      `[KZ Ban Status] Updated ${steamIds.length} players: ${bannedCount} banned, ${unbannedCount} unbanned`,
    );

    return {
      banned: bannedCount,
      unbanned: unbannedCount,
      recordsArchived,
      recordsRestored,
    };
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
          AND expires_on > NOW()
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
        const [result] = await retryOnDeadlock(() =>
          connection.query(
            `
          UPDATE kz_players
          SET is_banned = FALSE, updated_at = CURRENT_TIMESTAMP
          WHERE steamid64 IN (${expiredPlaceholders})
        `,
            expiredSteamIds,
          ),
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

    // Get all unique steamid64s from active bans
    const [bannedSteamIds] = await connection.query(`
      SELECT DISTINCT steamid64, player_name, steam_id
      FROM kz_bans
      WHERE steamid64 IS NOT NULL
        AND expires_on > NOW()
    `);

    let created = 0;
    let updated = 0;

    for (const ban of bannedSteamIds) {
      // Insert player if doesn't exist, or update ban status if exists
      const [result] = await retryOnDeadlock(() =>
        connection.query(
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
        ),
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
    totalRecordsArchived: stats.totalRecordsArchived,
    totalRecordsRestored: stats.totalRecordsRestored,
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
  archiveBannedPlayerRecords,
  restoreUnbannedPlayerRecords,
  batchArchiveBannedRecords,
  getStats,
};
