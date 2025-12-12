/**
 * KZ Statistics Update Service
 *
 * Background service that refreshes pre-calculated statistics tables
 * for players, maps, and servers. Replaces database events with
 * application-controlled scheduling for better observability.
 *
 * Statistics tables:
 * - kz_player_statistics: Player leaderboard data
 * - kz_map_statistics: Map popularity and records
 * - kz_server_statistics: Server activity metrics
 *
 * Update strategy:
 * - Only refreshes statistics older than 24 hours
 * - Processes in batches to avoid overwhelming the database
 * - Uses stored procedures for consistent logic
 */

const { getKzPool } = require("../db/kzRecords");
const logger = require("../utils/logger");

// Configuration
const DEFAULT_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours
const MAX_RETRIES = 3;
const RETRY_DELAY_BASE = 1000; // 1 second base delay
const BATCH_SIZE = 5000; // Players per batch
const MAX_BATCHES = 0; // 0 = unlimited

/**
 * Refresh player statistics using batched procedure
 * Updates stats for players not refreshed in 24 hours
 * @param {number} batchSize - Number of players per batch (default: 5000)
 * @param {number} maxBatches - Maximum batches to process (0 = unlimited)
 */
async function refreshPlayerStatistics(
  batchSize = BATCH_SIZE,
  maxBatches = MAX_BATCHES,
) {
  const pool = getKzPool();
  let retryCount = 0;

  while (retryCount < MAX_RETRIES) {
    let connection;
    try {
      logger.info("Refreshing player statistics (batched)...");
      const startTime = Date.now();

      // Get a dedicated connection for longer timeout
      connection = await pool.getConnection();

      // Set longer timeout for this connection (10 minutes per batch should be plenty)
      await connection.query("SET SESSION innodb_lock_wait_timeout = 600");
      await connection.query("SET SESSION wait_timeout = 28800");

      // Call batched procedure
      const [results] = await connection.query(
        "CALL refresh_player_statistics_batched(?, ?)",
        [batchSize, maxBatches],
      );

      // Extract results (last result set contains summary)
      const summary = Array.isArray(results)
        ? results[results.length - 1]
        : results;
      const playersProcessed = summary?.[0]?.players_processed || 0;
      const batches = summary?.[0]?.batches || 0;

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      logger.info(
        `Player statistics refreshed: ${playersProcessed} players in ${batches} batches (${elapsed}s)`,
      );

      connection.release();
      return { success: true, playersProcessed, batches };
    } catch (error) {
      if (connection) connection.release();
      retryCount++;
      if (retryCount < MAX_RETRIES) {
        logger.warn(
          `Error refreshing player statistics (attempt ${retryCount}/${MAX_RETRIES}): ${error.message}`,
        );
        await new Promise((resolve) =>
          setTimeout(resolve, RETRY_DELAY_BASE * Math.pow(2, retryCount - 1)),
        );
        continue;
      }
      logger.error(
        `Failed to refresh player statistics after ${MAX_RETRIES} attempts: ${error.message}`,
      );
      return { success: false, error: error.message };
    }
  }
}

/**
 * Refresh map statistics
 * Updates stats for maps not refreshed in 24 hours
 */
async function refreshMapStatistics() {
  const pool = getKzPool();
  let retryCount = 0;

  while (retryCount < MAX_RETRIES) {
    try {
      logger.info("Refreshing map statistics...");
      const startTime = Date.now();

      await pool.query("CALL refresh_all_map_statistics()");

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      logger.info(`Map statistics refreshed successfully in ${elapsed}s`);
      return true;
    } catch (error) {
      retryCount++;
      if (retryCount < MAX_RETRIES) {
        logger.warn(
          `Error refreshing map statistics (attempt ${retryCount}/${MAX_RETRIES}): ${error.message}`,
        );
        await new Promise((resolve) =>
          setTimeout(resolve, RETRY_DELAY_BASE * Math.pow(2, retryCount - 1)),
        );
        continue;
      }
      logger.error(
        `Failed to refresh map statistics after ${MAX_RETRIES} attempts: ${error.message}`,
      );
      return false;
    }
  }
}

/**
 * Refresh server statistics
 * Updates stats for servers not refreshed in 24 hours
 */
async function refreshServerStatistics() {
  const pool = getKzPool();
  let retryCount = 0;

  while (retryCount < MAX_RETRIES) {
    try {
      logger.info("Refreshing server statistics...");
      const startTime = Date.now();

      await pool.query("CALL refresh_all_server_statistics()");

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      logger.info(`Server statistics refreshed successfully in ${elapsed}s`);
      return true;
    } catch (error) {
      retryCount++;
      if (retryCount < MAX_RETRIES) {
        logger.warn(
          `Error refreshing server statistics (attempt ${retryCount}/${MAX_RETRIES}): ${error.message}`,
        );
        await new Promise((resolve) =>
          setTimeout(resolve, RETRY_DELAY_BASE * Math.pow(2, retryCount - 1)),
        );
        continue;
      }
      logger.error(
        `Failed to refresh server statistics after ${MAX_RETRIES} attempts: ${error.message}`,
      );
      return false;
    }
  }
}

/**
 * Refresh all statistics tables
 * Runs player, map, and server statistics refresh in sequence
 */
async function refreshAllStatistics() {
  logger.info("Starting full statistics refresh...");
  const startTime = Date.now();

  const results = {
    players: await refreshPlayerStatistics(),
    maps: await refreshMapStatistics(),
    servers: await refreshServerStatistics(),
  };

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const successCount = Object.values(results).filter(Boolean).length;

  if (successCount === 3) {
    logger.info(`All statistics refreshed successfully in ${elapsed}s`);
  } else {
    logger.warn(
      `Statistics refresh completed with ${3 - successCount} failures in ${elapsed}s`,
    );
  }

  return results;
}

/**
 * Populate statistics tables (initial population)
 * Used for first-time setup or full rebuild
 */
async function populateAllStatistics() {
  const pool = getKzPool();
  logger.info("Starting full statistics population (this may take a while)...");
  const startTime = Date.now();

  try {
    logger.info("Populating player statistics...");
    await pool.query("CALL populate_player_statistics()");
    logger.info("Player statistics populated");

    logger.info("Populating map statistics...");
    await pool.query("CALL populate_map_statistics()");
    logger.info("Map statistics populated");

    logger.info("Populating server statistics...");
    await pool.query("CALL populate_server_statistics()");
    logger.info("Server statistics populated");

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.info(`All statistics populated successfully in ${elapsed}s`);
    return true;
  } catch (error) {
    logger.error(`Failed to populate statistics: ${error.message}`);
    return false;
  }
}

/**
 * Get statistics summary
 * Returns counts from each statistics table for monitoring
 */
async function getStatisticsSummary() {
  const pool = getKzPool();

  try {
    const [[playerStats]] = await pool.query(
      "SELECT COUNT(*) as count, MAX(updated_at) as last_update FROM kz_player_statistics",
    );
    const [[mapStats]] = await pool.query(
      "SELECT COUNT(*) as count, MAX(updated_at) as last_update FROM kz_map_statistics",
    );
    const [[serverStats]] = await pool.query(
      "SELECT COUNT(*) as count, MAX(updated_at) as last_update FROM kz_server_statistics",
    );

    return {
      players: {
        count: playerStats.count,
        lastUpdate: playerStats.last_update,
      },
      maps: {
        count: mapStats.count,
        lastUpdate: mapStats.last_update,
      },
      servers: {
        count: serverStats.count,
        lastUpdate: serverStats.last_update,
      },
    };
  } catch (error) {
    logger.error(`Failed to get statistics summary: ${error.message}`);
    return null;
  }
}

/**
 * Start statistics refresh job
 * Runs periodically to keep statistics up-to-date
 *
 * @param {number} intervalMs - Interval between refreshes (default: 6 hours)
 */
function startStatisticsJob(intervalMs = DEFAULT_INTERVAL) {
  logger.info(
    `Starting KZ statistics refresh job (interval: ${intervalMs / 1000 / 60} minutes)`,
  );

  // Run immediately on startup
  refreshAllStatistics();

  // Schedule periodic refresh
  setInterval(refreshAllStatistics, intervalMs);
}

/**
 * Start statistics refresh job with custom per-type intervals
 *
 * @param {Object} options - Interval options
 * @param {number} options.playerInterval - Interval for player stats (default: 6 hours)
 * @param {number} options.mapInterval - Interval for map stats (default: 6 hours)
 * @param {number} options.serverInterval - Interval for server stats (default: 6 hours)
 */
function startStatisticsJobsIndividual(options = {}) {
  const playerInterval = options.playerInterval || DEFAULT_INTERVAL;
  const mapInterval = options.mapInterval || DEFAULT_INTERVAL;
  const serverInterval = options.serverInterval || DEFAULT_INTERVAL;

  logger.info("Starting individual KZ statistics refresh jobs:");
  logger.info(`  - Player stats: every ${playerInterval / 1000 / 60} minutes`);
  logger.info(`  - Map stats: every ${mapInterval / 1000 / 60} minutes`);
  logger.info(`  - Server stats: every ${serverInterval / 1000 / 60} minutes`);

  // Stagger initial runs to avoid all hitting DB at once
  setTimeout(refreshPlayerStatistics, 0);
  setTimeout(refreshMapStatistics, 30 * 1000); // 30s delay
  setTimeout(refreshServerStatistics, 60 * 1000); // 60s delay

  // Schedule periodic refreshes
  setInterval(refreshPlayerStatistics, playerInterval);
  setInterval(refreshMapStatistics, mapInterval);
  setInterval(refreshServerStatistics, serverInterval);
}

module.exports = {
  refreshPlayerStatistics,
  refreshMapStatistics,
  refreshServerStatistics,
  refreshAllStatistics,
  populateAllStatistics,
  getStatisticsSummary,
  startStatisticsJob,
  startStatisticsJobsIndividual,
};
