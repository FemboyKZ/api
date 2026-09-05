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

const { getKzPool } = require("../../db/kzRecords");
const logger = require("../../utils/logger");
const { sleep } = require("../../utils/retry");

// Configuration
const DEFAULT_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours
const STATS_INTERVAL =
  parseInt(process.env.KZ_STATS_INTERVAL, 10) || DEFAULT_INTERVAL;
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
        await sleep(RETRY_DELAY_BASE * Math.pow(2, retryCount - 1));
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
 * Call a refresh stored procedure, retrying with exponential backoff.
 *
 * @param {string} procedure - Stored procedure to CALL
 * @param {string} label - Noun used in the log lines ("map", "server")
 * @returns {Promise<boolean>} True if the procedure completed
 */
async function callRefreshProcedure(procedure, label) {
  const pool = getKzPool();

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      logger.info(`Refreshing ${label} statistics...`);
      const startTime = Date.now();

      await pool.query(`CALL ${procedure}()`);

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      logger.info(
        `${label[0].toUpperCase()}${label.slice(1)} statistics refreshed successfully in ${elapsed}s`,
      );
      return true;
    } catch (error) {
      if (attempt < MAX_RETRIES) {
        logger.warn(
          `Error refreshing ${label} statistics (attempt ${attempt}/${MAX_RETRIES}): ${error.message}`,
        );
        await sleep(RETRY_DELAY_BASE * Math.pow(2, attempt - 1));
        continue;
      }
      logger.error(
        `Failed to refresh ${label} statistics after ${MAX_RETRIES} attempts: ${error.message}`,
      );
      return false;
    }
  }
}

/**
 * Refresh map statistics
 * Updates stats for maps not refreshed in 24 hours
 */
async function refreshMapStatistics() {
  return callRefreshProcedure("refresh_all_map_statistics", "map");
}

/**
 * Refresh server statistics
 * Updates stats for servers not refreshed in 24 hours
 */
async function refreshServerStatistics() {
  return callRefreshProcedure("refresh_all_server_statistics", "server");
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
  // refreshPlayerStatistics resolves to an object ({ success, ... }), the other two to a boolean.
  const succeeded = (r) =>
    typeof r === "object" && r !== null ? r.success : r;
  const successCount = Object.values(results).filter(succeeded).length;

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
const statsTimers = [];

function startStatisticsJob(intervalMs = STATS_INTERVAL) {
  logger.info(
    `Starting KZ statistics refresh job (interval: ${intervalMs / 1000 / 60} minutes)`,
  );

  // Run immediately on startup
  refreshAllStatistics();

  // Schedule periodic refresh
  statsTimers.push(setInterval(refreshAllStatistics, intervalMs));
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
  statsTimers.push(
    setTimeout(refreshPlayerStatistics, 0),
    setTimeout(refreshMapStatistics, 30 * 1000), // 30s delay
    setTimeout(refreshServerStatistics, 60 * 1000), // 60s delay
    setInterval(refreshPlayerStatistics, playerInterval),
    setInterval(refreshMapStatistics, mapInterval),
    setInterval(refreshServerStatistics, serverInterval),
  );
}

/** Clears the timers started by either function above. */
function stopStatisticsJobs() {
  for (const timer of statsTimers) {
    clearInterval(timer);
    clearTimeout(timer);
  }
  statsTimers.length = 0;
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
  stopStatisticsJobs,
  STATS_INTERVAL,
};
