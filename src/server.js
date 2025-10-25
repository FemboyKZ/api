require("dotenv").config();
const http = require("http");
const app = require("./app");
const logger = require("./utils/logger");
const { startUpdateLoop } = require("./services/updater");
const { initWebSocket } = require("./services/websocket");
const { initRedis, closeRedis } = require("./db/redis");

const port = process.env.PORT || 3000;

// Create HTTP server (needed for Socket.IO)
const httpServer = http.createServer(app);

// Initialize Redis
initRedis()
  .then(() => {
    logger.info("Redis initialization completed");
  })
  .catch((err) => {
    logger.error(`Redis initialization failed: ${err.message}`);
  });

// Initialize WebSocket
initWebSocket(httpServer);

// Start HTTP server
httpServer.listen(port, () => {
  logger.info(`Server listening on port ${port}`);
  logger.info(`WebSocket available at ws://localhost:${port}`);
  startUpdateLoop(30 * 1000);
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  logger.info("SIGTERM received, shutting down gracefully");
  await closeRedis();
  httpServer.close(() => {
    logger.info("Server closed");
    process.exit(0);
  });
});

process.on("SIGINT", async () => {
  logger.info("SIGINT received, shutting down gracefully");
  await closeRedis();
  httpServer.close(() => {
    logger.info("Server closed");
    process.exit(0);
  });
});
