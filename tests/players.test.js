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

describe("Players Endpoints", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("GET /players", () => {
    it("should return all players with default pagination", async () => {
      pool.query
        .mockResolvedValueOnce([
          [
            {
              steamid: "76561198000000001",
              name: "Player1",
              game: "csgo",
              total_playtime: 12345,
            },
            {
              steamid: "76561198000000002",
              name: "Player2",
              game: "csgo",
              total_playtime: 54321,
            },
          ],
        ])
        .mockResolvedValueOnce([[{ total: 2 }]]);

      const response = await request(app)
        .get("/players")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("data");
      expect(response.body).toHaveProperty("pagination");
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBe(2);
      expect(response.body.data[0]).toHaveProperty("steamid");
      expect(response.body.data[0]).toHaveProperty("name");
      expect(response.body.data[0]).toHaveProperty("game");
      expect(response.body.data[0]).toHaveProperty("total_playtime");
    });

    it("should filter by game type", async () => {
      pool.query
        .mockResolvedValueOnce([
          [
            {
              steamid: "76561198000000001",
              name: "Player1",
              game: "csgo",
              total_playtime: 12345,
            },
          ],
        ])
        .mockResolvedValueOnce([[{ total: 1 }]]);

      const response = await request(app)
        .get("/players?game=csgo")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("data");
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data[0].game).toBe("csgo");
    });

    it("should filter by name", async () => {
      pool.query
        .mockResolvedValueOnce([
          [
            {
              steamid: "76561198000000001",
              name: "TestPlayer",
              game: "csgo",
              total_playtime: 12345,
            },
          ],
        ])
        .mockResolvedValueOnce([[{ total: 1 }]]);

      const response = await request(app)
        .get("/players?name=Test")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("data");
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data[0].name).toContain("Test");
    });

    it("should handle pagination parameters", async () => {
      pool.query.mockResolvedValueOnce([[]]).mockResolvedValueOnce([[{ total: 0 }]]);

      const response = await request(app)
        .get("/players?page=2&limit=5")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("data");
      expect(response.body).toHaveProperty("pagination");
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it("should handle database errors", async () => {
      pool.query.mockRejectedValueOnce(new Error("Database error"));

      const response = await request(app)
        .get("/players")
        .expect("Content-Type", /json/)
        .expect(500);

      expect(response.body).toHaveProperty("error");
    });
  });

  describe("GET /players/:steamid", () => {
    it("should return specific player details", async () => {
      pool.query
        .mockResolvedValueOnce([
          [
            {
              steamid: "76561198000000001",
              name: "Player1",
              game: "csgo",
              total_playtime: 12345,
            },
          ],
        ])
        .mockResolvedValueOnce([[{ total: 1 }]]);

      const response = await request(app)
        .get("/players/76561198000000001")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("steamid");
      expect(response.body).toHaveProperty("sessions");
      expect(response.body).toHaveProperty("stats");
    });

    it("should return 400 for invalid SteamID", async () => {
      const response = await request(app)
        .get("/players/invalid-steamid")
        .expect("Content-Type", /json/)
        .expect(400);

      expect(response.body).toHaveProperty("error");
    });

    it("should return 404 for non-existent player", async () => {
      pool.query.mockResolvedValueOnce([[]]).mockResolvedValueOnce([[{ total: 0 }]]);

      await request(app).get("/players/76561198000000001").expect(404);
    });

    it("should handle database errors", async () => {
      pool.query.mockRejectedValueOnce(new Error("Database error"));

      const response = await request(app)
        .get("/players/76561198000000001")
        .expect("Content-Type", /json/)
        .expect(500);

      expect(response.body).toHaveProperty("error");
    });
  });
});
