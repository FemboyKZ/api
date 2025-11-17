const mysql = require("mysql2/promise");
require("dotenv").config();
const logger = require("../utils/logger");

let kzPool;
let retryCount = 0;
const MAX_RETRIES = 5;
const RETRY_DELAY = 5000; // 5 seconds

/**
 * Creates KZ records database connection pool with retry logic
 */
function createKzPool() {
  return mysql.createPool({
    host: process.env.KZ_DB_HOST || "localhost",
    port: process.env.KZ_DB_PORT || 3308,
    user: process.env.KZ_DB_USER || "kz_user",
    password: process.env.KZ_DB_PASSWORD || "kz_password",
    database: process.env.KZ_DB_NAME || "kz_records",
    waitForConnections: true,
    connectionLimit: 50,    // Increased from 10 - critical for 25M+ records DB
    queueLimit: 100,        // Limit queue to fail fast
    acquireTimeout: 30000,  // 30s timeout to acquire connection
    connectTimeout: 60000,  // 60 seconds
    timeout: 60000,         // 60 seconds for queries
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    jsonStrings: false,
  });
}

/**
 * Tests KZ database connection with retry logic
 */
async function testKzConnection() {
  try {
    const connection = await kzPool.getConnection();
    await connection.ping();
    connection.release();
    logger.info("KZ Records database connection successful");
    retryCount = 0; // Reset retry count on success
    return true;
  } catch (error) {
    logger.error(`KZ Records database connection failed: ${error.message}`);

    if (retryCount < MAX_RETRIES) {
      retryCount++;
      logger.info(
        `Retrying KZ database connection (${retryCount}/${MAX_RETRIES}) in ${RETRY_DELAY / 1000}s...`,
      );

      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
      return testKzConnection();
    } else {
      logger.error("Max KZ database connection retries reached");
      throw new Error(
        "Failed to connect to KZ database after multiple attempts",
      );
    }
  }
}

/**
 * Initialize KZ records database connection
 */
async function initKzDatabase() {
  kzPool = createKzPool();

  // Handle connection errors
  kzPool.on("error", (err) => {
    logger.error(`KZ Database pool error: ${err.message}`);
    if (err.code === "PROTOCOL_CONNECTION_LOST") {
      logger.info("KZ Database connection lost, reconnecting...");
      testKzConnection().catch((e) => {
        logger.error(`KZ Reconnection failed: ${e.message}`);
      });
    }
  });

  await testKzConnection();
  return kzPool;
}

/**
 * Close KZ database pool gracefully
 */
async function closeKzDatabase() {
  if (kzPool) {
    await kzPool.end();
    logger.info("KZ Records database connection pool closed");
  }
}

/**
 * Get KZ database pool (lazy initialization)
 */
function getKzPool() {
  if (!kzPool) {
    kzPool = createKzPool();
  }
  return kzPool;
}

module.exports = {
  getKzPool,
  initKzDatabase,
  closeKzDatabase,
};
