/**
 * Database Pool Factory
 *
 * Provides a reusable factory for creating MySQL connection pools with:
 * - Retry logic for connection failures
 * - Graceful error handling and reconnection
 * - Consistent configuration across all database connections
 *
 * Used by: db/index.js, db/kzRecords.js, db/kzLocal.js
 */

const mysql = require("mysql2/promise");
const logger = require("../utils/logger");

const MAX_RETRIES = 5;
const RETRY_DELAY = 5000; // 5 seconds

/**
 * Default pool configuration
 */
const DEFAULT_POOL_CONFIG = {
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 60000, // 60 seconds
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  jsonStrings: false, // Automatically parse JSON columns to objects
};

/**
 * Create a database connection pool with consistent configuration
 *
 * @param {object} config - Database configuration
 * @param {string} config.host - Database host
 * @param {number} [config.port=3306] - Database port
 * @param {string} config.user - Database user
 * @param {string} config.password - Database password
 * @param {string} config.database - Database name
 * @param {number} [config.connectionLimit=10] - Max connections
 * @param {number} [config.queueLimit=0] - Queue limit (0 = unlimited)
 * @returns {object} MySQL connection pool
 */
function createPool(config) {
  return mysql.createPool({
    ...DEFAULT_POOL_CONFIG,
    host: config.host,
    port: config.port || 3306,
    user: config.user,
    password: config.password,
    database: config.database,
    connectionLimit:
      config.connectionLimit || DEFAULT_POOL_CONFIG.connectionLimit,
    queueLimit: config.queueLimit ?? DEFAULT_POOL_CONFIG.queueLimit,
  });
}

/**
 * Test database connection with retry logic
 *
 * @param {object} pool - MySQL connection pool
 * @param {string} name - Pool name for logging
 * @param {number} [retryCount=0] - Current retry count
 * @returns {Promise<boolean>} True if connection successful
 */
async function testConnection(pool, name, retryCount = 0) {
  try {
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
    logger.info(`${name} database connection successful`);
    return true;
  } catch (error) {
    logger.error(`${name} database connection failed: ${error.message}`);

    if (retryCount < MAX_RETRIES) {
      const nextRetry = retryCount + 1;
      logger.info(
        `Retrying ${name} database connection (${nextRetry}/${MAX_RETRIES}) in ${RETRY_DELAY / 1000}s...`,
      );
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
      return testConnection(pool, name, nextRetry);
    } else {
      logger.error(`Max ${name} database connection retries reached`);
      throw new Error(
        `Failed to connect to ${name} database after multiple attempts`,
      );
    }
  }
}

/**
 * Set up error handler for pool with auto-reconnection
 *
 * @param {object} pool - MySQL connection pool
 * @param {string} name - Pool name for logging
 */
function setupPoolErrorHandler(pool, name) {
  pool.on("error", (err) => {
    logger.error(`${name} Database pool error: ${err.message}`);
    if (err.code === "PROTOCOL_CONNECTION_LOST") {
      logger.info(`${name} Database connection lost, reconnecting...`);
      testConnection(pool, name).catch((e) => {
        logger.error(`${name} Reconnection failed: ${e.message}`);
      });
    }
  });
}

/**
 * Initialize a database pool with error handling and connection testing
 *
 * @param {object} config - Database configuration
 * @param {string} name - Pool name for logging
 * @returns {Promise<object>} Initialized MySQL connection pool
 */
async function initPool(config, name) {
  const pool = createPool(config);
  setupPoolErrorHandler(pool, name);
  await testConnection(pool, name);
  return pool;
}

/**
 * Close a database pool gracefully
 *
 * @param {object} pool - MySQL connection pool
 * @param {string} name - Pool name for logging
 */
async function closePool(pool, name) {
  if (pool) {
    await pool.end();
    logger.info(`${name} database connection pool closed`);
  }
}

/**
 * Create a lazy-initialized pool getter
 *
 * @param {Function} createFn - Function that creates the pool
 * @returns {object} Object with get() method and pool reference
 */
function createLazyPool(createFn) {
  let pool = null;
  return {
    get() {
      if (!pool) {
        pool = createFn();
      }
      return pool;
    },
    set(newPool) {
      pool = newPool;
    },
    async close(name) {
      if (pool) {
        await closePool(pool, name);
        pool = null;
      }
    },
  };
}

module.exports = {
  // Constants
  DEFAULT_POOL_CONFIG,
  MAX_RETRIES,
  RETRY_DELAY,
  // Pool creation
  createPool,
  createLazyPool,
  // Connection management
  testConnection,
  setupPoolErrorHandler,
  initPool,
  closePool,
};
