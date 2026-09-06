const request = require("supertest");
const app = require("../../src/app");
const pool = require("../../src/db");
const kzStatistics = require("../../src/services/kz/statistics");

// Mock database pool
jest.mock("../../src/db", () => ({
  query: jest.fn(),
}));

// Mock redis
jest.mock("../../src/db/redis", () => ({
  isRedisConnected: jest.fn(() => false),
  getCachedData: jest.fn(() => null),
  setCachedData: jest.fn(),
}));

// Mock adminAuth to allow all requests in tests
jest.mock("../../src/utils/auth", () => ({
  adminAuth: (req, res, next) => {
    req.adminAuth = { method: "test", ip: "127.0.0.1" };
    next();
  },
  optionalAdminAuth: (req, res, next) => {
    req.isAdmin = true;
    req.adminAuth = { method: "test", ip: "127.0.0.1" };
    next();
  },
  apiKeyMiddleware: (req, res, next) => next(),
  shouldSkipRateLimit: () => true,
  getClientIP: () => "127.0.0.1",
  isLocalhost: () => true,
  isWhitelisted: () => false,
  isApiWhitelisted: () => false,
  generateAPIKey: () => "test-api-key",
}));

// Mock kzStatistics service
jest.mock("../../src/services/kz/statistics", () => ({
  refreshAllStatistics: jest.fn(),
  refreshPlayerStatistics: jest.fn(),
  refreshMapStatistics: jest.fn(),
  refreshServerStatistics: jest.fn(),
  populateAllStatistics: jest.fn(),
  getStatisticsSummary: jest.fn(),
}));

describe("Admin Endpoints", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Reset kzStatistics mocks with default implementations
    kzStatistics.refreshAllStatistics.mockResolvedValue({
      players: true,
      maps: true,
      servers: true,
    });
    kzStatistics.refreshPlayerStatistics.mockResolvedValue(true);
    kzStatistics.refreshMapStatistics.mockResolvedValue(true);
    kzStatistics.refreshServerStatistics.mockResolvedValue(true);
    kzStatistics.populateAllStatistics.mockResolvedValue(true);
    kzStatistics.getStatisticsSummary.mockResolvedValue({
      players: { count: 1000, lastUpdate: new Date() },
      maps: { count: 500, lastUpdate: new Date() },
      servers: { count: 50, lastUpdate: new Date() },
    });
  });

  describe("POST /admin/aggregate-daily", () => {
    it("should aggregate daily server history", async () => {
      // Mock the complex aggregation queries
      pool.query
        .mockResolvedValueOnce([[]]) // Server stats aggregation
        .mockResolvedValueOnce([[]]) // Player stats aggregation
        .mockResolvedValueOnce([[{ total_servers: 5 }]]); // Count result

      const response = await request(app)
        .post("/admin/aggregate-daily")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("message");
      expect(response.body.message).toContain("aggregated");
    });

    it("aggregates the requested date rather than today", async () => {
      pool.query
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([[{ total_servers: 5 }]]);

      const response = await request(app)
        .post("/admin/aggregate-daily?date=2025-10-25")
        .expect(200);

      expect(response.body.date).toBe("2025-10-25");
      expect(pool.query).toHaveBeenCalledWith(expect.any(String), [
        "2025-10-25",
      ]);
    });

    it("should handle database errors", async () => {
      pool.query.mockRejectedValueOnce(new Error("Database error"));

      const response = await request(app)
        .post("/admin/aggregate-daily")
        .expect("Content-Type", /json/)
        .expect(500);

      expect(response.body).toHaveProperty("error");
    });
  });

  describe("POST /admin/cleanup-history", () => {
    beforeEach(() => {
      // Explicitly reset pool.query mock before each cleanup-history test
      pool.query.mockReset();
    });

    it("should cleanup old history records", async () => {
      // Mock all three DELETE queries - pool.query returns [result, fields] and code destructures [result]
      pool.query
        .mockResolvedValueOnce([{ affectedRows: 100 }, null])
        .mockResolvedValueOnce([{ affectedRows: 50 }, null])
        .mockResolvedValueOnce([{ affectedRows: 25 }, null]);

      const response = await request(app)
        .post("/admin/cleanup-history")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body.deleted).toEqual({
        serverHistory: 100,
        playerSessions: 50,
        mapHistory: 25,
      });
    });

    it("passes a custom retention window to every delete", async () => {
      pool.query
        .mockResolvedValueOnce([{ affectedRows: 200 }, null])
        .mockResolvedValueOnce([{ affectedRows: 100 }, null])
        .mockResolvedValueOnce([{ affectedRows: 50 }, null]);

      await request(app).post("/admin/cleanup-history?days=60").expect(200);

      // Parsed to an integer: the raw query string would land in the SQL as "60".
      expect(pool.query).toHaveBeenCalledTimes(3);
      for (const [, params] of pool.query.mock.calls) {
        expect(params).toEqual([60]);
      }
    });

    it("should handle database errors", async () => {
      // First call throws
      pool.query.mockRejectedValueOnce(new Error("Database error"));

      const response = await request(app)
        .post("/admin/cleanup-history")
        .expect("Content-Type", /json/)
        .expect(500);

      expect(response.body).toHaveProperty("error");
    });
  });

  describe("GET /admin/kz-statistics", () => {
    it("should return statistics summary", async () => {
      const response = await request(app)
        .get("/admin/kz-statistics")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body).toHaveProperty("statistics");
      expect(response.body.statistics).toHaveProperty("players");
      expect(response.body.statistics).toHaveProperty("maps");
      expect(response.body.statistics).toHaveProperty("servers");
    });
  });

  describe("POST /admin/refresh-kz-statistics", () => {
    it("should refresh all statistics by default", async () => {
      const response = await request(app)
        .post("/admin/refresh-kz-statistics")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body).toHaveProperty("type", "all");
      expect(response.body.result).toEqual({
        players: true,
        maps: true,
        servers: true,
      });
    });

    it.each([
      ["players", "refreshPlayerStatistics"],
      ["maps", "refreshMapStatistics"],
      ["servers", "refreshServerStatistics"],
    ])("type=%s refreshes only %s", async (type, method) => {
      const response = await request(app)
        .post(`/admin/refresh-kz-statistics?type=${type}`)
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body).toHaveProperty("type", type);
      expect(kzStatistics[method]).toHaveBeenCalled();
      expect(kzStatistics.refreshAllStatistics).not.toHaveBeenCalled();
    });
  });

  describe("POST /admin/populate-kz-statistics", () => {
    it("should populate all statistics tables", async () => {
      const response = await request(app)
        .post("/admin/populate-kz-statistics")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body).toHaveProperty("message");
      expect(response.body.message).toContain("populated successfully");
    });
  });
});
