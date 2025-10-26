const request = require("supertest");
const app = require("../src/app");
const pool = require("../src/db");

// Mock database pool
jest.mock("../src/db", () => ({
  query: jest.fn(),
}));

// Mock redis
jest.mock("../src/db/redis", () => ({
  isRedisConnected: jest.fn(() => false),
}));

// Mock websocket
jest.mock("../src/services/websocket", () => ({
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
      // Mock database queries for stats
      pool.query
        .mockResolvedValueOnce([[{ total: 10, online: 8, offline: 2 }]])
        .mockResolvedValueOnce([[{ total: 100 }]])
        .mockResolvedValueOnce([[{ active_24h: 50 }]])
        .mockResolvedValueOnce([[{ total: 20 }]]);

      const response = await request(app)
        .get("/health/stats")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("uptime");
      expect(response.body).toHaveProperty("servers");
      expect(response.body).toHaveProperty("players");
      expect(response.body).toHaveProperty("maps");
    });
  });
});
