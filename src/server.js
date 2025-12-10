require("dotenv").config();
const http = require("http");
const app = require("./app");
const logger = require("./utils/logger");
const { validateEnvironment } = require("./utils/envValidator");
const { initDatabase, closeDatabase } = require("./db");
const { initKzDatabase, closeKzDatabase } = require("./db/kzRecords");
const { initAllKzLocalDatabases, closeAllKzLocalDatabases } = require("./db/kzLocal");
const { startUpdateLoop } = require("./services/updater");
const { startAvatarUpdateJob } = require("./services/steamQuery");
const { startScraperJob } = require("./services/kzRecordsScraper");
const { startBanCleanupJob } = require("./services/kzBanStatus");
const { initWebSocket } = require("./services/websocket");
const { initRedis, closeRedis } = require("./db/redis");
const { loadMessageIds } = require("./services/discordWebhook");
const { startWorldRecordsCacheJob } = require("./services/worldRecordsCache");
const { startStatisticsJob } = require("./services/kzStatistics");

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
    logger.info("Initializing KZ Records database connection...");
    await initKzDatabase();

    // Step 2b: Initialize FKZ Local Records database
    logger.info("Initializing FKZ Local Records database connections...");
    await initAllKzLocalDatabases();

    // Step 3: Initialize Redis (optional)
    logger.info("Initializing Redis...");
    await initRedis();
    logger.info("Redis initialization completed");

    // Step 4: Create HTTP server (needed for Socket.IO)
    const httpServer = http.createServer(app);

    // Step 5: Initialize WebSocket
    logger.info("Initializing WebSocket server...");
    initWebSocket(httpServer);

    // Step 6: Load Discord message IDs from database (before starting server)
    if (process.env.DISCORD_WEBHOOK_ENABLED === "true") {
      logger.info("Loading Discord message IDs...");
      await loadMessageIds();
    }

    // Step 7: Start HTTP server
    httpServer.listen(port, host, () => {
      logger.info(`Server listening on ${host}:${port}`);
      logger.info(`WebSocket available at ws://${host}:${port}`);
      logger.info("Server initialization complete");

      // Step 8: Start background update loop
      startUpdateLoop(30 * 1000);

      // Step 9: Start avatar update job (runs every hour)
      // startAvatarUpdateJob(60 * 60 * 1000);

      // Step 10: Start world records cache refresh job (runs every 5 minutes)
      startWorldRecordsCacheJob(5 * 60 * 1000);

      // Step 11: Start KZ records scraper (runs every 3.75s for 80% rate limit utilization)
      if (process.env.KZ_SCRAPER_ENABLED !== "false") {
        const scraperInterval =
          parseInt(process.env.KZ_SCRAPER_INTERVAL) || 3750; // 3.75 seconds for 80% rate limit (400 req/5min)
        const scraperIdleInterval =
          parseInt(process.env.KZ_SCRAPER_IDLE_INTERVAL) || 30000; // 30 seconds when caught up
        startScraperJob(scraperInterval, scraperIdleInterval);
        logger.info(
          `KZ Records scraper enabled (normal: ${scraperInterval}ms, idle: ${scraperIdleInterval}ms)`,
        );

        // Step 12: Start ban status cleanup job (runs every hour by default)
        const banCleanupInterval =
          parseInt(process.env.KZ_BAN_CLEANUP_INTERVAL) || 3600000; // 1 hour
        startBanCleanupJob(banCleanupInterval);
        logger.info(
          `KZ Ban cleanup job enabled (interval: ${banCleanupInterval / 1000}s)`,
        );

        // Step 13: Start KZ statistics refresh job (runs every 6 hours by default)
        const statsInterval =
          parseInt(process.env.KZ_STATS_INTERVAL) || 6 * 60 * 60 * 1000; // 6 hours
        startStatisticsJob(statsInterval);
        logger.info(
          `KZ Statistics refresh job enabled (interval: ${statsInterval / 1000 / 60} minutes)`,
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
    await closeKzDatabase();
    await closeAllKzLocalDatabases();

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
