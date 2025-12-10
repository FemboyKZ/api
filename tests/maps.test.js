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

describe("Maps Endpoints", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("GET /maps", () => {
    it("should return all maps with default pagination", async () => {
      // Optimized: Single query with window function (COUNT(*) OVER())
      pool.query.mockResolvedValueOnce([
        [
          {
            name: "de_dust2",
            game: "csgo",
            total_playtime: 123456,
            total_count: 2, // Window function adds this to all rows
          },
          {
            name: "de_mirage",
            game: "csgo",
            total_playtime: 98765,
            total_count: 2,
          },
        ],
      ]);

      const response = await request(app)
        .get("/maps")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("data");
      expect(response.body).toHaveProperty("pagination");
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBe(2);
      expect(response.body.data[0]).toHaveProperty("name");
      expect(response.body.data[0]).toHaveProperty("game");
      expect(response.body.data[0]).toHaveProperty("total_playtime");
      // total_count should be removed from response
      expect(response.body.data[0]).not.toHaveProperty("total_count");
    });

    it("should filter by game type", async () => {
      pool.query.mockResolvedValueOnce([
        [
          {
            name: "de_dust2",
            game: "csgo",
            total_playtime: 123456,
            total_count: 1,
          },
        ],
      ]);

      const response = await request(app)
        .get("/maps?game=csgo")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("data");
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data[0].game).toBe("csgo");
    });

    it("should search by map name", async () => {
      pool.query.mockResolvedValueOnce([
        [
          {
            name: "de_dust2",
            game: "csgo",
            total_playtime: 123456,
            total_count: 1,
          },
        ],
      ]);

      const response = await request(app)
        .get("/maps?name=dust")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("data");
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data[0].name).toContain("dust");
    });

    it("should handle pagination parameters", async () => {
      pool.query.mockResolvedValueOnce([[]]);

      const response = await request(app)
        .get("/maps?page=2&limit=10")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("data");
      expect(response.body).toHaveProperty("pagination");
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it("should filter by server IP and port", async () => {
      pool.query.mockResolvedValueOnce([
        [
          {
            name: "de_dust2",
            game: "csgo",
            total_playtime: 123456,
            total_count: 1,
          },
        ],
      ]);

      const response = await request(app)
        .get("/maps?server=185.107.96.59:27015")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("data");
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it("should handle invalid server format gracefully", async () => {
      pool.query.mockResolvedValueOnce([[]]);

      const response = await request(app)
        .get("/maps?server=invalid-server-format")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("data");
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it("should handle empty result set correctly", async () => {
      pool.query.mockResolvedValueOnce([[]]);

      const response = await request(app)
        .get("/maps?name=nonexistent")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body.data).toHaveLength(0);
      expect(response.body.pagination.total).toBe(0);
      expect(response.body.pagination.totalPages).toBe(0);
    });

    it("should sort by name correctly", async () => {
      pool.query.mockResolvedValueOnce([
        [
          {
            name: "aim_map",
            game: "csgo",
            total_playtime: 1000,
            total_count: 2,
          },
          {
            name: "bhop_map",
            game: "csgo",
            total_playtime: 2000,
            total_count: 2,
          },
        ],
      ]);

      const response = await request(app)
        .get("/maps?sort=name&order=asc")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body.data).toHaveLength(2);
      expect(response.body.data[0].name).toBe("aim_map");
    });

    it("should handle database errors", async () => {
      pool.query.mockRejectedValueOnce(new Error("Database error"));

      const response = await request(app)
        .get("/maps")
        .expect("Content-Type", /json/)
        .expect(500);

      expect(response.body).toHaveProperty("error");
    });
  });
});
