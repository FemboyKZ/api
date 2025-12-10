const request = require("supertest");
const app = require("../src/app");
const pool = require("../src/db");
const kzStatistics = require("../src/services/kzStatistics");

// Mock database pool
jest.mock("../src/db", () => ({
  query: jest.fn(),
}));

// Mock redis
jest.mock("../src/db/redis", () => ({
  isRedisConnected: jest.fn(() => false),
  getCachedData: jest.fn(() => null),
  setCachedData: jest.fn(),
}));

// Mock adminAuth to allow all requests in tests
jest.mock("../src/utils/adminAuth", () => ({
  adminAuth: (req, res, next) => {
    req.adminAuth = { method: "test", ip: "127.0.0.1" };
    next();
  },
  optionalAdminAuth: (req, res, next) => {
    req.isAdmin = true;
    req.adminAuth = { method: "test", ip: "127.0.0.1" };
    next();
  },
}));

// Mock kzStatistics service
jest.mock("../src/services/kzStatistics", () => ({
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

    it("should handle date parameter", async () => {
      pool.query
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([[{ total_servers: 5 }]]);

      const response = await request(app)
        .post("/admin/aggregate-daily")
        .send({ date: "2025-10-25" })
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("message");
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
      expect(response.body).toHaveProperty("deleted");
      expect(response.body.deleted).toHaveProperty("serverHistory", 100);
      expect(response.body.deleted).toHaveProperty("playerSessions", 50);
      expect(response.body.deleted).toHaveProperty("mapHistory", 25);
    });

    it("should handle custom retention days", async () => {
      pool.query
        .mockResolvedValueOnce([{ affectedRows: 200 }, null])
        .mockResolvedValueOnce([{ affectedRows: 100 }, null])
        .mockResolvedValueOnce([{ affectedRows: 50 }, null]);

      const response = await request(app)
        .post("/admin/cleanup-history?days=60")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body).toHaveProperty("deleted");
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
      expect(response.body.result).toHaveProperty("players", true);
      expect(response.body.result).toHaveProperty("maps", true);
      expect(response.body.result).toHaveProperty("servers", true);
    });

    it("should refresh only player statistics when type=players", async () => {
      const response = await request(app)
        .post("/admin/refresh-kz-statistics?type=players")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body).toHaveProperty("type", "players");
      expect(response.body.result).toHaveProperty("players", true);
    });

    it("should refresh only map statistics when type=maps", async () => {
      const response = await request(app)
        .post("/admin/refresh-kz-statistics?type=maps")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body).toHaveProperty("type", "maps");
      expect(response.body.result).toHaveProperty("maps", true);
    });

    it("should refresh only server statistics when type=servers", async () => {
      const response = await request(app)
        .post("/admin/refresh-kz-statistics?type=servers")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body).toHaveProperty("type", "servers");
      expect(response.body.result).toHaveProperty("servers", true);
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
