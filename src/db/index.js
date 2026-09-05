const {
  createPool,
  setupPoolErrorHandler,
  testConnection,
  closePool,
} = require("./poolFactory");
require("dotenv").config();

/**
 * Main application database configuration
 */
const dbConfig = {
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectionLimit: 50, // Increased from 10 for better concurrency
  queueLimit: 100, // Limit queue to fail fast vs. waiting indefinitely
};

// One pool for the process. Created on require, since callers do `const pool = require("../db")`;
// init/close operate on this same instance.
const pool = createPool(dbConfig);

/**
 * Initialize database connection: attach the error handler and verify connectivity with retries.
 */
async function initDatabase() {
  setupPoolErrorHandler(pool, "Main");
  await testConnection(pool, "Main");
  return pool;
}

/**
 * Close database pool gracefully
 */
async function closeDatabase() {
  await closePool(pool, "Main");
}

module.exports = pool;
module.exports.initDatabase = initDatabase;
module.exports.closeDatabase = closeDatabase;
