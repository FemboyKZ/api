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
      pool.query
        .mockResolvedValueOnce([
          [
            {
              name: "de_dust2",
              game: "csgo",
              total_playtime: 123456,
            },
            {
              name: "de_mirage",
              game: "csgo",
              total_playtime: 98765,
            },
          ],
        ])
        .mockResolvedValueOnce([[{ total: 2 }]]);

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
    });

    it("should filter by game type", async () => {
      pool.query
        .mockResolvedValueOnce([
          [
            {
              name: "de_dust2",
              game: "csgo",
              total_playtime: 123456,
            },
          ],
        ])
        .mockResolvedValueOnce([[{ total: 1 }]]);

      const response = await request(app)
        .get("/maps?game=csgo")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("data");
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data[0].game).toBe("csgo");
    });

    it("should search by map name", async () => {
      pool.query
        .mockResolvedValueOnce([
          [
            {
              name: "de_dust2",
              game: "csgo",
              total_playtime: 123456,
            },
          ],
        ])
        .mockResolvedValueOnce([[{ total: 1 }]]);

      const response = await request(app)
        .get("/maps?name=dust")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("data");
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data[0].name).toContain("dust");
    });

    it("should handle pagination parameters", async () => {
      pool.query
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([[{ total: 0 }]]);

      const response = await request(app)
        .get("/maps?page=2&limit=10")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("data");
      expect(response.body).toHaveProperty("pagination");
      expect(Array.isArray(response.body.data)).toBe(true);
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
