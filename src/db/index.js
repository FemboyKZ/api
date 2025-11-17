const mysql = require("mysql2/promise");
require("dotenv").config();
const logger = require("../utils/logger");

let pool;
let retryCount = 0;
const MAX_RETRIES = 5;
const RETRY_DELAY = 5000; // 5 seconds

/**
 * Creates database connection pool with retry logic
 */
function createPool() {
  return mysql.createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 50,    // Increased from 10 for better concurrency
    queueLimit: 100,        // Limit queue to fail fast vs. waiting indefinitely
    acquireTimeout: 30000,  // 30s timeout to acquire connection from pool
    connectTimeout: 60000,  // 60 seconds
    timeout: 60000,         // 60 seconds for queries
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    jsonStrings: false, // Automatically parse JSON columns to objects
  });
}

/**
 * Tests database connection with retry logic
 */
async function testConnection() {
  try {
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
    logger.info("Database connection successful");
    retryCount = 0; // Reset retry count on success
    return true;
  } catch (error) {
    logger.error(`Database connection failed: ${error.message}`);

    if (retryCount < MAX_RETRIES) {
      retryCount++;
      logger.info(
        `Retrying database connection (${retryCount}/${MAX_RETRIES}) in ${RETRY_DELAY / 1000}s...`,
      );

      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
      return testConnection();
    } else {
      logger.error("Max database connection retries reached");
      throw new Error("Failed to connect to database after multiple attempts");
    }
  }
}

/**
 * Initialize database connection
 */
async function initDatabase() {
  pool = createPool();

  // Handle connection errors
  pool.on("error", (err) => {
    logger.error(`Database pool error: ${err.message}`);
    if (err.code === "PROTOCOL_CONNECTION_LOST") {
      logger.info("Database connection lost, reconnecting...");
      testConnection().catch((e) => {
        logger.error(`Reconnection failed: ${e.message}`);
      });
    }
  });

  await testConnection();
  return pool;
}

/**
 * Close database pool gracefully
 */
async function closeDatabase() {
  if (pool) {
    await pool.end();
    logger.info("Database connection pool closed");
  }
}

// Initialize pool on require (for backward compatibility)
pool = createPool();

module.exports = pool;
module.exports.initDatabase = initDatabase;
module.exports.closeDatabase = closeDatabase;
