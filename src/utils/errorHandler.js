/**
 * Backstop for anything route handlers do not catch themselves.
 * Express 5 forwards both synchronous throws and rejected async handlers here.
 *
 * Stack traces are only exposed in development.
 */

const logger = require("./logger");

function errorHandler(err, req, res, next) {
  logger.error(`Error processing ${req.method} ${req.path}: ${err.message}`, {
    error: err.stack,
    method: req.method,
    path: req.path,
    query: req.query,
    ip: req.ip,
  });

  const isDevelopment = process.env.NODE_ENV === "development";

  res.status(err.status || 500).json({
    error: isDevelopment ? err.message : "Internal Server Error",
    ...(isDevelopment && { stack: err.stack }),
  });
}

module.exports = errorHandler;
