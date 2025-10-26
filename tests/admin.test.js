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
  getCachedData: jest.fn(() => null),
  setCachedData: jest.fn(),
}));

describe("Admin Endpoints", () => {
  beforeEach(() => {
    jest.resetAllMocks();
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
    it("should cleanup old history records", async () => {
      // Mock all three DELETE queries
      pool.query
        .mockResolvedValueOnce([{ affectedRows: 100 }])
        .mockResolvedValueOnce([{ affectedRows: 50 }])
        .mockResolvedValueOnce([{ affectedRows: 25 }]);

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
        .mockResolvedValueOnce([{ affectedRows: 200 }])
        .mockResolvedValueOnce([{ affectedRows: 100 }])
        .mockResolvedValueOnce([{ affectedRows: 50 }]);

      const response = await request(app)
        .post("/admin/cleanup-history?days=60")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body).toHaveProperty("deleted");
    });

    it("should handle database errors", async () => {
      pool.query.mockRejectedValue(new Error("Database error"));

      const response = await request(app)
        .post("/admin/cleanup-history")
        .expect("Content-Type", /json/)
        .expect(500);

      expect(response.body).toHaveProperty("error");
    });
  });
});
