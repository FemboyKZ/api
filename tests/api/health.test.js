const request = require("supertest");
const app = require("../../src/app");
const pool = require("../../src/db");

// Mock database pool
jest.mock("../../src/db", () => ({
  query: jest.fn(),
}));

// Mock redis
jest.mock("../../src/db/redis", () => ({
  isRedisConnected: jest.fn(() => false),
}));

// Mock websocket
jest.mock("../../src/services/comms/websocket", () => ({
  getWebSocketStats: jest.fn(() => ({ connected: false, clients: 0 })),
}));

describe("Health Endpoints", () => {
  describe("GET /health", () => {
    it("should return 200 and healthy status", async () => {
      // Mock successful database query
      pool.query.mockResolvedValueOnce([[{ result: 1 }]]);

      const response = await request(app)
        .get("/health")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("status", "ok");
      expect(response.body).toHaveProperty("timestamp");
      expect(response.body).toHaveProperty("database", "connected");
    });
  });

  describe("GET /health/stats", () => {
    it("should return 200 and statistics", async () => {
      // Optimized: Single combined query with subqueries
      pool.query.mockResolvedValueOnce([
        [
          {
            server_total: 10,
            server_online: 8,
            server_offline: 2,
            player_total: 100,
            players_active_24h: 50,
            map_total: 20,
          },
        ],
      ]);

      const response = await request(app)
        .get("/health/stats")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toEqual({
        uptime: expect.any(Number),
        servers: { total: 10, online: 8, offline: 2 },
        players: { total: 100, active_24h: 50 },
        maps: { total: 20 },
        websocket: { connected: false, clients: 0 },
        cache: { enabled: false },
      });
    });

    it("should handle database errors gracefully", async () => {
      pool.query.mockRejectedValueOnce(new Error("Database connection failed"));

      const response = await request(app)
        .get("/health/stats")
        .expect("Content-Type", /json/)
        .expect(500);

      expect(response.body).toHaveProperty("error");
      expect(response.body.error).toBe("Failed to fetch statistics");
    });
  });
});
