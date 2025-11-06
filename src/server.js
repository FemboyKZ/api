require("dotenv").config();
const http = require("http");
const app = require("./app");
const logger = require("./utils/logger");
const { validateEnvironment } = require("./utils/envValidator");
const { initDatabase, closeDatabase } = require("./db");
const { initKzDatabase, closeKzDatabase } = require("./db/kzRecords");
const { startUpdateLoop } = require("./services/updater");
const { startAvatarUpdateJob } = require("./services/steamQuery");
const { startScraperJob } = require("./services/kzRecordsScraper");
const { initWebSocket } = require("./services/websocket");
const { initRedis, closeRedis } = require("./db/redis");

const port = process.env.PORT || 3000;
const host = process.env.HOST || "0.0.0.0"; // Use 127.0.0.1 in production with reverse proxy

/**
 * Startup sequence with proper error handling
 */
async function startServer() {
  try {
    // Step 1: Validate environment variables
    logger.info("Starting server initialization...");
    validateEnvironment();

    // Step 2: Initialize database with retry logic
    logger.info("Initializing database connection...");
    await initDatabase();

    // Step 2b: Initialize KZ Records database (if scraper enabled)
    if (process.env.KZ_SCRAPER_ENABLED !== "false") {
      logger.info("Initializing KZ Records database connection...");
      await initKzDatabase();
    }

    // Step 3: Initialize Redis (optional)
    logger.info("Initializing Redis...");
    await initRedis();
    logger.info("Redis initialization completed");

    // Step 4: Create HTTP server (needed for Socket.IO)
    const httpServer = http.createServer(app);

    // Step 5: Initialize WebSocket
    logger.info("Initializing WebSocket server...");
    initWebSocket(httpServer);

    // Step 6: Start HTTP server
    httpServer.listen(port, host, () => {
      logger.info(`Server listening on ${host}:${port}`);
      logger.info(`WebSocket available at ws://${host}:${port}`);
      logger.info("Server initialization complete");

      // Step 7: Start background update loop
      startUpdateLoop(30 * 1000);

      // Step 8: Start avatar update job (runs every hour)
      startAvatarUpdateJob(60 * 60 * 1000);

      // Step 9: Start KZ records scraper (runs every 10 seconds by default)
      if (process.env.KZ_SCRAPER_ENABLED !== "false") {
        const scraperInterval =
          parseInt(process.env.KZ_SCRAPER_INTERVAL) || 10000; // Increased from 5s to 10s
        startScraperJob(scraperInterval);
        logger.info(
          `KZ Records scraper enabled (interval: ${scraperInterval}ms)`,
        );
      }
    });

    return httpServer;
  } catch (error) {
    logger.error(`Failed to start server: ${error.message}`);
    process.exit(1);
  }
}

// Start the server
const serverInstance = startServer();

// Graceful shutdown handler
async function gracefulShutdown(signal) {
  logger.info(`${signal} received, shutting down gracefully...`);

  const server = await serverInstance;

  // Set a timeout to force shutdown if graceful shutdown takes too long
  const forceShutdownTimeout = setTimeout(() => {
    logger.error("Graceful shutdown timeout, forcing exit");
    process.exit(1);
  }, 30000); // 30 seconds timeout

  try {
    // Step 1: Close Redis connection
    logger.info("Closing Redis connection...");
    await closeRedis();

    // Step 2: Close database connection pools
    logger.info("Closing database connections...");
    await closeDatabase();

    // Step 2b: Close KZ database connection pool
    if (process.env.KZ_SCRAPER_ENABLED !== "false") {
      await closeKzDatabase();
    }

    // Step 3: Close HTTP server
    logger.info("Closing HTTP server...");
    server.close(() => {
      logger.info("Server shutdown complete");
      clearTimeout(forceShutdownTimeout);
      process.exit(0);
    });
  } catch (error) {
    logger.error(`Error during shutdown: ${error.message}`);
    clearTimeout(forceShutdownTimeout);
    process.exit(1);
  }
}

// Handle shutdown signals
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  logger.error("Uncaught Exception detected", {
    message: error.message,
    stack: error.stack,
    code: error.code,
  });

  // For stateless API servers with process managers (PM2/systemd/Docker),
  // logging and continuing is often acceptable. The process manager will
  // restart if the process becomes unresponsive or exits.
  //
  // Known safe exceptions to ignore:
  // - Third-party library issues (rcon-srcds packet decoder RangeErrors)
  // - Transient network errors
  // - Individual request handler failures
  //
  // Consider uncommenting gracefulShutdown() below if you experience:
  // - Cascading failures after exceptions
  // - Memory leaks or zombie connections
  // - Database corruption or inconsistent state
  //
  // gracefulShutdown("uncaughtException");
});

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled Promise Rejection detected", {
    reason: reason,
    promise: promise,
    stack: reason?.stack,
  });

  // Log only - same rationale as uncaughtException above.
  // Unhandled rejections are typically from:
  // - Forgot to await async database calls
  // - Third-party library promise chains
  // - Network timeouts in background jobs
  //
  // These rarely corrupt process state in stateless APIs.
  //
  // Uncomment to trigger shutdown on unhandled rejections:
  // gracefulShutdown("unhandledRejection");
});
