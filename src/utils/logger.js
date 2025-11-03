const winston = require("winston");
const path = require("path");

// Determine environment
const isProduction = process.env.NODE_ENV === "production";
const isDevelopment = process.env.NODE_ENV === "development";
const isTest = process.env.NODE_ENV === "test";

// Custom format for better readability
const customFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json(),
);

// Console format with colors for development
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let msg = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(meta).length > 0) {
      msg += ` ${JSON.stringify(meta)}`;
    }
    return msg;
  }),
);

// Create logs directory if it doesn't exist
const fs = require("fs");
const logsDir = path.join(__dirname, "../../logs");
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Configure transports based on environment
const transports = [];

// Console transport (always enabled except in test)
if (!isTest) {
  transports.push(
    new winston.transports.Console({
      format: isDevelopment ? consoleFormat : customFormat,
      level: isDevelopment ? "debug" : "info",
    }),
  );
}

// File transports for production and development
if (isProduction || isDevelopment) {
  // Combined log (all levels)
  transports.push(
    new winston.transports.File({
      filename: path.join(logsDir, "combined.log"),
      format: customFormat,
      maxsize: 10485760, // 10MB
      maxFiles: 5,
      tailable: true,
    }),
  );

  // Error log (errors only)
  transports.push(
    new winston.transports.File({
      filename: path.join(logsDir, "error.log"),
      level: "error",
      format: customFormat,
      maxsize: 10485760, // 10MB
      maxFiles: 5,
      tailable: true,
    }),
  );

  // Access log (info level for API requests)
  transports.push(
    new winston.transports.File({
      filename: path.join(logsDir, "access.log"),
      level: "info",
      format: customFormat,
      maxsize: 10485760, // 10MB
      maxFiles: 5,
      tailable: true,
    }),
  );
}

// Create logger instance
const logger = winston.createLogger({
  level: isDevelopment ? "debug" : "info",
  format: customFormat,
  transports,
  exitOnError: false,
});

// Add request logging helper
logger.logRequest = (req, res, duration) => {
  const logData = {
    method: req.method,
    url: req.url,
    status: res.statusCode,
    duration: `${duration}ms`,
    ip:
      req.ip || req.headers["x-forwarded-for"] || req.connection.remoteAddress,
    userAgent: req.get("user-agent"),
  };

  if (res.statusCode >= 500) {
    logger.error("Request failed", logData);
  } else if (res.statusCode >= 400) {
    logger.warn("Client error", logData);
  } else {
    logger.info("Request completed", logData);
  }
};

// Add query logging helper
logger.logQuery = (query, params, duration, error = null) => {
  const logData = {
    query: query.substring(0, 200), // Truncate long queries
    params: params ? JSON.stringify(params).substring(0, 100) : null,
    duration: duration ? `${duration}ms` : null,
  };

  if (error) {
    logger.error("Database query failed", { ...logData, error: error.message });
  } else if (isDevelopment) {
    logger.debug("Database query executed", logData);
  }
};

// Log startup environment
if (!isTest) {
  logger.info("Logger initialized", {
    environment: process.env.NODE_ENV || "development",
    logLevel: logger.level,
    transports: transports.map((t) => t.constructor.name),
  });
}

module.exports = logger;
