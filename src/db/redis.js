const redis = require("redis");
const logger = require("../utils/logger");

let client = null;
let isConnected = false;

// Redis connection configuration
const redisConfig = {
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT, 10) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  database: parseInt(process.env.REDIS_DB, 10) || 0,
};

// Only enable Redis if explicitly configured
const REDIS_ENABLED = process.env.REDIS_ENABLED === "true";

async function initRedis() {
  if (!REDIS_ENABLED) {
    logger.info("Redis caching is disabled (set REDIS_ENABLED=true to enable)");
    return null;
  }

  try {
    client = redis.createClient({
      socket: {
        host: redisConfig.host,
        port: redisConfig.port,
      },
      password: redisConfig.password,
      database: redisConfig.database,
    });

    client.on("error", (err) => {
      logger.error(`Redis error: ${err.message}`);
      isConnected = false;
    });

    client.on("connect", () => {
      logger.info(
        `Redis connected to ${redisConfig.host}:${redisConfig.port}`,
      );
      isConnected = true;
    });

    client.on("ready", () => {
      logger.info("Redis client is ready");
    });

    client.on("end", () => {
      logger.info("Redis connection closed");
      isConnected = false;
    });

    await client.connect();
    return client;
  } catch (error) {
    logger.error(`Failed to connect to Redis: ${error.message}`);
    logger.info("Continuing without cache - all requests will hit the database");
    client = null;
    isConnected = false;
    return null;
  }
}

async function getCache(key) {
  if (!client || !isConnected) return null;

  try {
    const data = await client.get(key);
    if (data) {
      logger.info(`Cache hit: ${key}`);
      return JSON.parse(data);
    }
    logger.info(`Cache miss: ${key}`);
    return null;
  } catch (error) {
    logger.error(`Redis get error for key ${key}: ${error.message}`);
    return null;
  }
}

async function setCache(key, value, ttlSeconds = 30) {
  if (!client || !isConnected) return false;

  try {
    await client.setEx(key, ttlSeconds, JSON.stringify(value));
    logger.info(`Cache set: ${key} (TTL: ${ttlSeconds}s)`);
    return true;
  } catch (error) {
    logger.error(`Redis set error for key ${key}: ${error.message}`);
    return false;
  }
}

async function deleteCache(pattern) {
  if (!client || !isConnected) return false;

  try {
    // If it's a specific key, just delete it
    if (!pattern.includes("*")) {
      await client.del(pattern);
      logger.info(`Cache deleted: ${pattern}`);
      return true;
    }

    // If it's a pattern, find and delete all matching keys
    const keys = await client.keys(pattern);
    if (keys.length > 0) {
      await client.del(keys);
      logger.info(`Cache invalidated: ${keys.length} keys matching ${pattern}`);
    }
    return true;
  } catch (error) {
    logger.error(`Redis delete error for pattern ${pattern}: ${error.message}`);
    return false;
  }
}

async function flushCache() {
  if (!client || !isConnected) return false;

  try {
    await client.flushDb();
    logger.info("Cache flushed");
    return true;
  } catch (error) {
    logger.error(`Redis flush error: ${error.message}`);
    return false;
  }
}

function isRedisConnected() {
  return isConnected;
}

async function closeRedis() {
  if (client) {
    await client.quit();
    client = null;
    isConnected = false;
    logger.info("Redis connection closed gracefully");
  }
}

module.exports = {
  initRedis,
  getCache,
  setCache,
  deleteCache,
  flushCache,
  isRedisConnected,
  closeRedis,
};
