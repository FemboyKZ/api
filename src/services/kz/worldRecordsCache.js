/**
 * Refreshes the kz_worldrecords_cache table from data already stored.
 *
 * Not to be confused with services/kz/worldRecordsSync.js.
 */

const { getKzPool } = require("../../db/kzRecords");
const logger = require("../../utils/logger");
const { withRetry } = require("../../utils/retry");

const REFRESH_ATTEMPTS = 3;

async function refreshWorldRecordsCache() {
  const pool = getKzPool();

  try {
    await withRetry(
      async () => {
        logger.info("Refreshing world records cache...");
        await pool.query("CALL refresh_worldrecords_cache()");
        logger.info("World records cache refreshed successfully");
      },
      {
        attempts: REFRESH_ATTEMPTS,
        baseMs: 100,
        // A concurrent refresh collides on the unique key; that clears on retry.
        isRetryable: (error) => error.code === "ER_DUP_ENTRY",
        onRetry: ({ attempt }) =>
          logger.warn(
            `Duplicate key error refreshing world records cache (attempt ${attempt}/${REFRESH_ATTEMPTS}), retrying after delay...`,
          ),
      },
    );
  } catch (error) {
    // Failing a refresh is not fatal; the next scheduled run retries.
    logger.error(`Failed to refresh world records cache: ${error.message}`);
  }
}

let cacheTimer = null;

function startWorldRecordsCacheJob(intervalMs = 5 * 60 * 1000) {
  logger.info(
    `Starting world records cache refresh job (interval: ${intervalMs / 1000}s)`,
  );
  refreshWorldRecordsCache();
  cacheTimer = setInterval(refreshWorldRecordsCache, intervalMs);
}

function stopWorldRecordsCacheJob() {
  clearInterval(cacheTimer);
  cacheTimer = null;
}

module.exports = {
  startWorldRecordsCacheJob,
  stopWorldRecordsCacheJob,
  refreshWorldRecordsCache,
};
