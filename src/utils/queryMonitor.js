const logger = require("./logger");

function monitorQuery(query, params) {
  const start = Date.now();
  return pool.query(query, params).then((result) => {
    const duration = Date.now() - start;
    if (duration > 1000) {
      logger.warn(`Slow query (${duration}ms):`, {
        query: query.substring(0, 200),
        params,
        duration,
      });
    }
    return result;
  });
}

module.exports = { monitorQuery };
