require("dotenv").config();
const http = require("http");
const app = require("./app");
const logger = require("./utils/logger");
const { validateEnvironment } = require("./utils/envValidator");
const { initDatabase, closeDatabase } = require("./db");
const { startUpdateLoop } = require("./services/updater");
const { startAvatarUpdateJob } = require("./services/steamAvatars");
const { initWebSocket } = require("./services/websocket");
const { initRedis, closeRedis } = require("./db/redis");

const port = process.env.PORT || 3000;
const host = process.env.HOST || '0.0.0.0'; // Use 127.0.0.1 in production with reverse proxy

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

    // Step 2: Close database connection pool
    logger.info("Closing database connections...");
    await closeDatabase();

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
  logger.error(`Uncaught Exception: ${error.message}`);
  logger.error(error.stack);
  gracefulShutdown("uncaughtException");
});

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  logger.error(`Unhandled Rejection at: ${promise}, reason: ${reason}`);
  gracefulShutdown("unhandledRejection");
});
