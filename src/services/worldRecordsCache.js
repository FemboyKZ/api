const { getKzPool } = require("../db/kzRecords");
const logger = require("../utils/logger");

async function refreshWorldRecordsCache() {
  const pool = getKzPool();
  const maxRetries = 3;
  let retryCount = 0;

  while (retryCount < maxRetries) {
    try {
      logger.info("Refreshing world records cache...");
      await pool.query("CALL refresh_worldrecords_cache()");
      logger.info("World records cache refreshed successfully");
      return; // Success, exit
    } catch (error) {
      // Handle duplicate key error (race condition)
      if (error.code === "ER_DUP_ENTRY" && retryCount < maxRetries - 1) {
        retryCount++;
        logger.warn(
          `Duplicate key error refreshing world records cache (attempt ${retryCount}/${maxRetries}), retrying after delay...`,
        );
        // Exponential backoff: 100ms, 200ms, 400ms
        await new Promise((resolve) =>
          setTimeout(resolve, 100 * Math.pow(2, retryCount - 1)),
        );
        continue;
      }

      // Log error and exit on final retry or non-retryable error
      logger.error(
        `Failed to refresh world records cache after ${retryCount + 1} attempt(s): ${error.message}`,
      );
      return;
    }
  }
}

function startWorldRecordsCacheJob(intervalMs = 5 * 60 * 1000) {
  logger.info(
    `Starting world records cache refresh job (interval: ${intervalMs / 1000}s)`,
  );
  refreshWorldRecordsCache();
  setInterval(refreshWorldRecordsCache, intervalMs);
}

module.exports = { startWorldRecordsCacheJob, refreshWorldRecordsCache };
