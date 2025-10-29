const { getCache, setCache } = require("../db/redis");
const logger = require("./logger");

/**
 * Cache middleware factory
 * @param {number} ttl - Time to live in seconds (default: 30)
 * @param {function} keyGenerator - Optional function to generate cache key from request
 */
function cacheMiddleware(ttl = 30, keyGenerator = null) {
  return async (req, res, next) => {
    // Generate cache key based on URL and query parameters
    const cacheKey =
      keyGenerator?.(req) ||
      `cache:${req.baseUrl}${req.path}:${JSON.stringify(req.query)}`;

    try {
      // Try to get from cache
      const cachedData = await getCache(cacheKey);

      if (cachedData) {
        // Cache hit - return cached response
        return res.json(cachedData);
      }

      // Cache miss - intercept res.json to cache the response
      const originalJson = res.json.bind(res);

      res.json = function (data) {
        // Only cache successful responses
        if (res.statusCode === 200) {
          setCache(cacheKey, data, ttl).catch((err) => {
            logger.error(`Failed to cache response: ${err.message}`);
          });
        }
        return originalJson(data);
      };

      next();
    } catch (error) {
      logger.error(`Cache middleware error: ${error.message}`);
      // On error, continue without cache
      next();
    }
  };
}

/**
 * Cache key generator for servers endpoint
 */
function serversKeyGenerator(req) {
  const { game, status, region } = req.query;
  return `cache:servers:${game || "all"}:${status !== undefined ? status : "online"}:${region || "all"}`;
}

/**
 * Cache key generator for players endpoint
 */
function playersKeyGenerator(req) {
  const { page, limit, sort, order, name, game, server } = req.query;
  return `cache:players:${page || 1}:${limit || 10}:${sort || "total_playtime"}:${order || "desc"}:${name || "all"}:${game || "all"}:${server || "all"}`;
}

/**
 * Cache key generator for maps endpoint
 */
function mapsKeyGenerator(req) {
  const { page, limit, sort, order, server, name, game } = req.query;
  return `cache:maps:${page || 1}:${limit || 10}:${sort || "total_playtime"}:${order || "desc"}:${server || "all"}:${name || "all"}:${game || "all"}`;
}

/**
 * Generic cache key generator from params and query
 * @param {string} prefix - Cache key prefix (e.g., "history:server")
 * @param {object} params - Route params
 * @param {object} query - Query params
 * @returns {string} Generated cache key
 */
function generateCacheKey(prefix, params = {}, query = {}) {
  const paramStr = Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v}`)
    .join(":");
  
  const queryStr = Object.entries(query)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v}`)
    .join(":");
  
  return `cache:${prefix}${paramStr ? `:${paramStr}` : ""}${queryStr ? `:${queryStr}` : ""}`;
}

module.exports = {
  cacheMiddleware,
  serversKeyGenerator,
  playersKeyGenerator,
  mapsKeyGenerator,
  generateCacheKey,
};
