const mysql = require("mysql2/promise");
require("dotenv").config();
const logger = require("../utils/logger");

let kzLocalCS2Pool;
let kzLocalCSGO128Pool;
let kzLocalCSGO64Pool;
let retryCount = 0;
const MAX_RETRIES = 5;
const RETRY_DELAY = 5000; // 5 seconds

/**
 * Creates KZ records database connection pool with retry logic
 */
function createKzLocalCS2Pool() {
  return mysql.createPool({
    host: process.env.KZ_LOCAL_CS2_DB_HOST || "localhost",
    port: process.env.KZ_LOCAL_CS2_DB_PORT || 3306,
    user: process.env.KZ_LOCAL_CS2_DB_USER || "kz_user",
    password: process.env.KZ_LOCAL_CS2_DB_PASSWORD || "kz_password",
    database: process.env.KZ_LOCAL_CS2_DB_NAME || "kz_records",
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    connectTimeout: 60000, // 60 seconds
    timeout: 60000, // 60 seconds for queries
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    jsonStrings: false,
  });
}

/**
 * Creates KZ records database connection pool with retry logic
 */
function createKzLocalCSGO128Pool() {
  return mysql.createPool({
    host: process.env.KZ_LOCAL_CSGO128_DB_HOST || "localhost",
    port: process.env.KZ_LOCAL_CSGO128_DB_PORT || 3306,
    user: process.env.KZ_LOCAL_CSGO128_DB_USER || "kz_user",
    password: process.env.KZ_LOCAL_CSGO128_DB_PASSWORD || "kz_password",
    database: process.env.KZ_LOCAL_CSGO128_DB_NAME || "kz_records",
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    connectTimeout: 60000, // 60 seconds
    timeout: 60000, // 60 seconds for queries
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    jsonStrings: false,
  });
}

/**
 * Creates KZ records database connection pool with retry logic
 */
function createKzLocalCSGO64Pool() {
  return mysql.createPool({
    host: process.env.KZ_LOCAL_CSGO64_DB_HOST || "localhost",
    port: process.env.KZ_LOCAL_CSGO64_DB_PORT || 3306,
    user: process.env.KZ_LOCAL_CSGO64_DB_USER || "kz_user",
    password: process.env.KZ_LOCAL_CSGO64_DB_PASSWORD || "kz_password",
    database: process.env.KZ_LOCAL_CSGO64_DB_NAME || "kz_records",
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    connectTimeout: 60000, // 60 seconds
    timeout: 60000, // 60 seconds for queries
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    jsonStrings: false,
  });
}

/**
 * Tests KZ Local database connection with retry logic
 */
async function testKzLocalCS2Connection() {
  try {
    const connection = await kzLocalCS2Pool.getConnection();
    await connection.ping();
    connection.release();
    logger.info("KZ Local CS2 database connection successful");
    retryCount = 0; // Reset retry count on success
    return true;
  } catch (error) {
    logger.error(`KZ Local CS2 database connection failed: ${error.message}`);
    if (retryCount < MAX_RETRIES) {
      retryCount++;
      logger.info(
        `Retrying KZ Local CS2 database connection (${retryCount}/${MAX_RETRIES}) in ${RETRY_DELAY / 1000}s...`,
      );

      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
      return testKzLocalCS2Connection();
    } else {
      logger.error("Max KZ Local CS2 database connection retries reached");
      throw new Error(
        "Failed to connect to KZ Local CS2 database after multiple attempts",
      );
    }
  }
}

/**
 * Tests KZ Local database connection with retry logic
 */
async function testKzLocalCSGO128Connection() {
  try {
    const connection = await kzLocalCSGO128Pool.getConnection();
    await connection.ping();
    connection.release();
    logger.info("KZ Local CSGO128 database connection successful");
    retryCount = 0; // Reset retry count on success
    return true;
  } catch (error) {
    logger.error(`KZ Local CSGO128 database connection failed: ${error.message}`);
    if (retryCount < MAX_RETRIES) {
      retryCount++;
      logger.info(
        `Retrying KZ Local CSGO128 database connection (${retryCount}/${MAX_RETRIES}) in ${RETRY_DELAY / 1000}s...`,
      );

      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
      return testKzLocalCSGO128Connection();
    } else {
      logger.error("Max KZ Local CSGO128 database connection retries reached");
      throw new Error(
        "Failed to connect to KZ Local CSGO128 database after multiple attempts",
      );
    }
  }
}

/**
 * Tests KZ Local database connection with retry logic
 */
async function testKzLocalCSGO64Connection() {
  try {
    const connection = await kzLocalCSGO64Pool.getConnection();
    await connection.ping();
    connection.release();
    logger.info("KZ Local CSGO64 database connection successful");
    retryCount = 0; // Reset retry count on success
    return true;
  } catch (error) {
    logger.error(`KZ Local CSGO64 database connection failed: ${error.message}`);
    if (retryCount < MAX_RETRIES) {
      retryCount++;
      logger.info(
        `Retrying KZ Local CSGO64 database connection (${retryCount}/${MAX_RETRIES}) in ${RETRY_DELAY / 1000}s...`,
      );

      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
      return testKzLocalCSGO64Connection();
    } else {
      logger.error("Max KZ Local CSGO64 database connection retries reached");
      throw new Error(
        "Failed to connect to KZ Local CSGO64 database after multiple attempts",
      );
    }
  }
}

/**
 * Initialize KZ records database connection
 */
async function initKzLocalCS2Database() {
  kzLocalCS2Pool = createKzLocalCS2Pool();

  // Handle connection errors
  kzLocalCS2Pool.on("error", (err) => {
    logger.error(`KZ Local CS2 Database pool error: ${err.message}`);
    if (err.code === "PROTOCOL_CONNECTION_LOST") {
      logger.info("KZ Local CS2 Database connection lost, reconnecting...");
      testKzLocalCS2Connection().catch((e) => {
        logger.error(`KZ Local CS2 Reconnection failed: ${e.message}`);
      });
    }
  });

  await testKzLocalCS2Connection();
  return kzLocalCS2Pool;
}

/**
 * Initialize KZ records database connection
 */
async function initKzLocalCSGO128Database() {
  kzLocalCSGO128Pool = createKzLocalCSGO128Pool();

  // Handle connection errors
  kzLocalCSGO128Pool.on("error", (err) => {
    logger.error(`KZ Local CSGO128 Database pool error: ${err.message}`);
    if (err.code === "PROTOCOL_CONNECTION_LOST") {
      logger.info("KZ Local CSGO128 Database connection lost, reconnecting...");
      testKzLocalCSGO128Connection().catch((e) => {
        logger.error(`KZ Local CSGO128 Reconnection failed: ${e.message}`);
      });
    }
  });

  await testKzLocalCSGO128Connection();
  return kzLocalCSGO128Pool;
}

/**
 * Initialize KZ records database connection
 */
async function initKzLocalCSGO64Database() {
  kzLocalCSGO64Pool = createKzLocalCSGO64Pool();

  // Handle connection errors
  kzLocalCSGO64Pool.on("error", (err) => {
    logger.error(`KZ Local CSGO64 Database pool error: ${err.message}`);
    if (err.code === "PROTOCOL_CONNECTION_LOST") {
      logger.info("KZ Local CSGO64 Database connection lost, reconnecting...");
      testKzLocalCSGO64Connection().catch((e) => {
        logger.error(`KZ Local CSGO64 Reconnection failed: ${e.message}`);
      });
    }
  });

  await testKzLocalCSGO64Connection();
  return kzLocalCSGO64Pool;
}

/**
 *  Initialize all KZ local database connections
 */
async function initAllKzLocalDatabases() {
  await initKzLocalCS2Database();
  await initKzLocalCSGO128Database();
  await initKzLocalCSGO64Database();
}

/**
 * Close KZ local database pool gracefully
 */
async function closeKzLocalCS2Database() {
  if (kzLocalCS2Pool) {
    await kzLocalCS2Pool.end();
    logger.info("KZ Local CS2 database connection pool closed");
  }
}

/**
 * Close KZ local database pool gracefully
 */
async function closeKzLocalCSGO128Database() {
  if (kzLocalCSGO128Pool) {
    await kzLocalCSGO128Pool.end();
    logger.info("KZ Local CSGO128 database connection pool closed");
  }
}

/**
 * Close KZ local database pool gracefully
 */
async function closeKzLocalCSGO64Database() {
  if (kzLocalCSGO64Pool) {
    await kzLocalCSGO64Pool.end();
    logger.info("KZ Local CSGO64 database connection pool closed");
  }
}

/** 
 * Close all KZ local database pools gracefully
 */
async function closeAllKzLocalDatabases() {
  await closeKzLocalCS2Database();
  await closeKzLocalCSGO128Database();
  await closeKzLocalCSGO64Database();
}

/**
 * Get KZ local database pool (lazy initialization)
 */
function getKzLocalCS2Pool() {
  if (!kzLocalCS2Pool) {
    kzLocalCS2Pool = createKzLocalCS2Pool();
  }
  return kzLocalCS2Pool;
}

/**
 * Get KZ local database pool (lazy initialization)
 */
function getKzLocalCSGO128Pool() {
  if (!kzLocalCSGO128Pool) {
    kzLocalCSGO128Pool = createKzLocalCSGO128Pool();
  }
  return kzLocalCSGO128Pool;
}

/**
 * Get KZ local database pool (lazy initialization)
 */
function getKzLocalCSGO64Pool() {
  if (!kzLocalCSGO64Pool) {
    kzLocalCSGO64Pool = createKzLocalCSGO64Pool();
  }
  return kzLocalCSGO64Pool;
}

function getAllKzLocalPools() {
  return {
    cs2: getKzLocalCS2Pool(),
    csgo128: getKzLocalCSGO128Pool(),
    csgo64: getKzLocalCSGO64Pool(),
  };
}


module.exports = {
  getAllKzLocalPools,
  getKzLocalCS2Pool,
  getKzLocalCSGO128Pool,
  getKzLocalCSGO64Pool,
  initAllKzLocalDatabases,
  initKzLocalCS2Database,
  initKzLocalCSGO128Database,
  initKzLocalCSGO64Database,
  closeAllKzLocalDatabases,
  closeKzLocalCS2Database,
  closeKzLocalCSGO128Database,
  closeKzLocalCSGO64Database,
};
