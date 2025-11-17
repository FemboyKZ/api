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

      expect(response.body).toHaveProperty("uptime");
      expect(response.body).toHaveProperty("servers");
      expect(response.body.servers).toEqual({
        total: 10,
        online: 8,
        offline: 2,
      });
      expect(response.body).toHaveProperty("players");
      expect(response.body.players).toEqual({
        total: 100,
        active_24h: 50,
      });
      expect(response.body).toHaveProperty("maps");
      expect(response.body.maps).toEqual({
        total: 20,
      });
      expect(response.body).toHaveProperty("websocket");
      expect(response.body).toHaveProperty("cache");
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

    it("should handle null values in stats correctly", async () => {
      pool.query.mockResolvedValueOnce([
        [
          {
            server_total: 0,
            server_online: 0,
            server_offline: 0,
            player_total: 0,
            players_active_24h: 0,
            map_total: 0,
          },
        ],
      ]);

      const response = await request(app)
        .get("/health/stats")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body.servers.total).toBe(0);
      expect(response.body.players.total).toBe(0);
      expect(response.body.maps.total).toBe(0);
    });

    it("should include all required fields in stats response", async () => {
      pool.query.mockResolvedValueOnce([
        [
          {
            server_total: 5,
            server_online: 3,
            server_offline: 2,
            player_total: 50,
            players_active_24h: 20,
            map_total: 10,
          },
        ],
      ]);

      const response = await request(app)
        .get("/health/stats")
        .expect("Content-Type", /json/)
        .expect(200);

      // Verify structure
      expect(response.body).toHaveProperty("uptime");
      expect(typeof response.body.uptime).toBe("number");

      expect(response.body).toHaveProperty("servers");
      expect(response.body.servers).toHaveProperty("total");
      expect(response.body.servers).toHaveProperty("online");
      expect(response.body.servers).toHaveProperty("offline");

      expect(response.body).toHaveProperty("players");
      expect(response.body.players).toHaveProperty("total");
      expect(response.body.players).toHaveProperty("active_24h");

      expect(response.body).toHaveProperty("maps");
      expect(response.body.maps).toHaveProperty("total");

      expect(response.body).toHaveProperty("websocket");
      expect(response.body.websocket).toHaveProperty("connected");
      expect(response.body.websocket).toHaveProperty("clients");

      expect(response.body).toHaveProperty("cache");
      expect(response.body.cache).toHaveProperty("enabled");
    });
  });
});
