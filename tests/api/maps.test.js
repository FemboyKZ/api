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

      expect(response.body.data).toHaveLength(2);
      expect(response.body.pagination.total).toBe(2);
      expect(response.body.data[0]).toHaveProperty("name");
      expect(response.body.data[0]).toHaveProperty("game");
      expect(response.body.data[0]).toHaveProperty("total_playtime");
      // total_count is the window function's scratch column, not part of the response
      expect(response.body.data[0]).not.toHaveProperty("total_count");
    });

    // The response only ever echoes whatever the mock returned, so the filters are
    // checked where they actually take effect: the SQL and its parameters.
    it.each([
      ["game", "?game=csgo", " AND game = ?", ["csgo"]],
      ["name", "?name=dust", " AND name LIKE ?", ["%dust%"]],
      [
        "server",
        "?server=185.107.96.59:27015",
        " AND server_ip = ? AND server_port = ?",
        ["185.107.96.59", 27015],
      ],
      // Sort field and order are interpolated, so they have to come from an allow-list.
      ["sort", "?sort=name&order=asc", "ORDER BY name ASC", []],
      ["pagination", "?page=2&limit=10", "LIMIT ? OFFSET ?", [10, 10]],
    ])("filters by %s", async (_name, queryString, fragment, expected) => {
      pool.query.mockResolvedValueOnce([[]]);

      await request(app).get(`/maps${queryString}`).expect(200);

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain(fragment);
      expect(params).toEqual(expect.arrayContaining(expected));
    });

    // A server that isn't ip:port is dropped rather than rejected.
    it("ignores a malformed server filter instead of failing", async () => {
      pool.query.mockResolvedValueOnce([[]]);

      await request(app).get("/maps?server=invalid-server-format").expect(200);

      expect(pool.query.mock.calls[0][0]).not.toContain("server_ip");
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

    it("should handle database errors", async () => {
      pool.query.mockRejectedValueOnce(new Error("Database error"));

      const response = await request(app)
        .get("/maps")
        .expect("Content-Type", /json/)
        .expect(500);

      expect(response.body.error).toBe("Failed to fetch maps");
    });
  });
});
