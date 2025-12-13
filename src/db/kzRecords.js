const {
  createPool,
  initPool,
  closePool,
  createLazyPool,
} = require("./poolFactory");
require("dotenv").config();
const logger = require("../utils/logger");

/**
 * KZ Records database configuration
 */
const kzConfig = {
  host: process.env.KZ_DB_HOST || "localhost",
  port: process.env.KZ_DB_PORT || 3308,
  user: process.env.KZ_DB_USER || "kz_user",
  password: process.env.KZ_DB_PASSWORD || "kz_password",
  database: process.env.KZ_DB_NAME || "kz_records",
  connectionLimit: 50, // Increased from 10 - critical for 25M+ records DB
  queueLimit: 100, // Limit queue to fail fast
};

// Lazy-initialized pool
const kzPoolManager = createLazyPool(() => createPool(kzConfig));

/**
 * Initialize KZ records database connection
 */
async function initKzDatabase() {
  const pool = await initPool(kzConfig, "KZ Records");
  kzPoolManager.set(pool);
  return pool;
}

/**
 * Close KZ database pool gracefully
 */
async function closeKzDatabase() {
  await kzPoolManager.close("KZ Records");
}

/**
 * Get KZ database pool (lazy initialization)
 */
function getKzPool() {
  return kzPoolManager.get();
}

module.exports = {
  getKzPool,
  initKzDatabase,
  closeKzDatabase,
};
