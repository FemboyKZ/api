const { Server } = require("socket.io");
const logger = require("../utils/logger");

let io = null;

/**
 * Initialize Socket.IO server
 * @param {http.Server} httpServer - HTTP server instance
 */
function initWebSocket(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: process.env.CORS_ORIGIN || "*",
      methods: ["GET", "POST"],
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  io.on("connection", (socket) => {
    logger.info(`WebSocket client connected: ${socket.id}`);

    // Track connection count
    const clientCount = io.engine.clientsCount;
    logger.info(`Total connected clients: ${clientCount}`);

    // Handle client subscription to specific channels
    socket.on("subscribe", (channel) => {
      if (["servers", "players", "maps", "all"].includes(channel)) {
        socket.join(channel);
        logger.info(`Client ${socket.id} subscribed to ${channel}`);
        socket.emit("subscribed", { channel, success: true });
      } else {
        socket.emit("subscribed", {
          channel,
          success: false,
          error: "Invalid channel",
        });
      }
    });

    socket.on("unsubscribe", (channel) => {
      socket.leave(channel);
      logger.info(`Client ${socket.id} unsubscribed from ${channel}`);
      socket.emit("unsubscribed", { channel });
    });

    socket.on("disconnect", (reason) => {
      logger.info(`WebSocket client disconnected: ${socket.id} (${reason})`);
    });

    socket.on("error", (error) => {
      logger.error(`WebSocket error from ${socket.id}: ${error.message}`);
    });

    // Send initial connection acknowledgment
    socket.emit("connected", {
      message: "Connected to server-api WebSocket",
      timestamp: new Date().toISOString(),
    });
  });

  logger.info("WebSocket server initialized");
  return io;
}

/**
 * Emit server update event
 * @param {Object} data - Server update data
 */
function emitServerUpdate(data) {
  if (!io) return;

  io.to("servers").to("all").emit("server:update", {
    type: "server:update",
    data,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Emit server status change event
 * @param {Object} data - Server status change data
 */
function emitServerStatusChange(data) {
  if (!io) return;

  io.to("servers").to("all").emit("server:status", {
    type: "server:status",
    data,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Emit player update event
 * @param {Object} data - Player update data
 */
function emitPlayerUpdate(data) {
  if (!io) return;

  io.to("players").to("all").emit("player:update", {
    type: "player:update",
    data,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Emit map update event
 * @param {Object} data - Map update data
 */
function emitMapUpdate(data) {
  if (!io) return;

  io.to("maps").to("all").emit("map:update", {
    type: "map:update",
    data,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Emit statistics update event
 * @param {Object} stats - Statistics data
 */
function emitStatsUpdate(stats) {
  if (!io) return;

  io.to("all").emit("stats:update", {
    type: "stats:update",
    data: stats,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Broadcast message to all connected clients
 * @param {string} event - Event name
 * @param {Object} data - Event data
 */
function broadcast(event, data) {
  if (!io) return;

  io.emit(event, {
    ...data,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Get current WebSocket statistics
 */
function getWebSocketStats() {
  if (!io) {
    return { connected: false, clients: 0 };
  }

  return {
    connected: true,
    clients: io.engine.clientsCount,
  };
}

/**
 * Close WebSocket server
 */
function closeWebSocket() {
  if (io) {
    io.close(() => {
      logger.info("WebSocket server closed");
    });
    io = null;
  }
}

module.exports = {
  initWebSocket,
  emitServerUpdate,
  emitServerStatusChange,
  emitPlayerUpdate,
  emitMapUpdate,
  emitStatsUpdate,
  broadcast,
  getWebSocketStats,
  closeWebSocket,
};
