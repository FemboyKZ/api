const mysql = require("mysql2/promise");
require("dotenv").config();
const logger = require("../utils/logger");

let kzLocalPool;
let retryCount = 0;
const MAX_RETRIES = 5;
const RETRY_DELAY = 5000; // 5 seconds

/**
 * Creates KZ records database connection pool with retry logic
 */
function createKzLocalPool() {
  return mysql.createPool({
    host: process.env.KZ_LOCAL_DB_HOST || "localhost",
    port: process.env.KZ_LOCAL_DB_PORT || 3306,
    user: process.env.KZ_LOCAL_DB_USER || "kz_user",
    password: process.env.KZ_LOCAL_DB_PASSWORD || "kz_password",
    database: process.env.KZ_LOCAL_DB_NAME || "kz_records",
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    jsonStrings: false,
  });
}

/**
 * Tests KZ Local database connection with retry logic
 */
async function testKzLocalConnection() {
  try {
    const connection = await kzLocalPool.getConnection();
    await connection.ping();
    connection.release();
    logger.info("KZ Local database connection successful");
    retryCount = 0; // Reset retry count on success
    return true;
  } catch (error) {
    logger.error(`KZ Local database connection failed: ${error.message}`);

    if (retryCount < MAX_RETRIES) {
      retryCount++;
      logger.info(
        `Retrying KZ Local database connection (${retryCount}/${MAX_RETRIES}) in ${RETRY_DELAY / 1000}s...`,
      );

      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
      return testKzLocalConnection();
    } else {
      logger.error("Max KZ Local database connection retries reached");
      throw new Error(
        "Failed to connect to KZ Local database after multiple attempts",
      );
    }
  }
}

/**
 * Initialize KZ records database connection
 */
async function initKzLocalDatabase() {
  kzLocalPool = createKzLocalPool();

  // Handle connection errors
  kzLocalPool.on("error", (err) => {
    logger.error(`KZ Local Database pool error: ${err.message}`);
    if (err.code === "PROTOCOL_CONNECTION_LOST") {
      logger.info("KZ Local Database connection lost, reconnecting...");
      testKzLocalConnection().catch((e) => {
        logger.error(`KZ Local Reconnection failed: ${e.message}`);
      });
    }
  });

  await testKzLocalConnection();
  return kzLocalPool;
}

/**
 * Close KZ local database pool gracefully
 */
async function closeKzLocalDatabase() {
  if (kzLocalPool) {
    await kzLocalPool.end();
    logger.info("KZ Local database connection pool closed");
  }
}

/**
 * Get KZ local database pool (lazy initialization)
 */
function getKzLocalPool() {
  if (!kzLocalPool) {
    kzLocalPool = createKzLocalPool();
  }
  return kzLocalPool;
}

module.exports = {
  getKzLocalPool,
  initKzLocalDatabase,
  closeKzLocalDatabase,
};
