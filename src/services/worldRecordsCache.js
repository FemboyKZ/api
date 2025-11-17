const { getKzPool } = require("../db/kzRecords");
const logger = require("../utils/logger");

async function refreshWorldRecordsCache() {
  const pool = getKzPool();
  try {
    logger.info("Refreshing world records cache...");
    await pool.query("CALL refresh_worldrecords_cache()");
    logger.info("World records cache refreshed successfully");
  } catch (error) {
    logger.error(`Failed to refresh world records cache: ${error.message}`);
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
