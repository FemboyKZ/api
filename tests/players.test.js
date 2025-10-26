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
    it("should return all players grouped by game with default pagination", async () => {
      pool.query.mockResolvedValueOnce([
        [
          {
            steamid: "76561198000000001",
            name: "Player1",
            game: "csgo",
            total_playtime: 12345,
            last_seen: "2025-10-26T12:00:00Z",
          },
          {
            steamid: "76561198000000001",
            name: "Player1",
            game: "counterstrike2",
            total_playtime: 5000,
            last_seen: "2025-10-26T14:00:00Z",
          },
          {
            steamid: "76561198000000002",
            name: "Player2",
            game: "csgo",
            total_playtime: 54321,
            last_seen: "2025-10-25T10:00:00Z",
          },
        ],
      ]);

      const response = await request(app)
        .get("/players")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("data");
      expect(response.body).toHaveProperty("pagination");
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBe(2); // 2 unique players
      
      // Check structure has game-specific data
      expect(response.body.data[0]).toHaveProperty("steamid");
      expect(response.body.data[0]).toHaveProperty("name");
      expect(response.body.data[0]).toHaveProperty("csgo");
      expect(response.body.data[0]).toHaveProperty("counterstrike2");
      
      // Player 1 should have both games
      const player1 = response.body.data.find(p => p.steamid === "76561198000000001");
      expect(player1.csgo).toHaveProperty("total_playtime");
      expect(player1.counterstrike2).toHaveProperty("total_playtime");
      
      // Player 2 should have only CS:GO
      const player2 = response.body.data.find(p => p.steamid === "76561198000000002");
      expect(player2.csgo).toHaveProperty("total_playtime");
      expect(player2.counterstrike2).toEqual({});
    });

    it("should filter by game type", async () => {
      pool.query.mockResolvedValueOnce([
        [
          {
            steamid: "76561198000000001",
            name: "Player1",
            game: "csgo",
            total_playtime: 12345,
            last_seen: "2025-10-26T12:00:00Z",
          },
        ],
      ]);

      const response = await request(app)
        .get("/players?game=csgo")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("data");
      expect(Array.isArray(response.body.data)).toBe(true);
      
      // When filtering by game, only that game's stats should be populated
      const player = response.body.data[0];
      expect(player.csgo).toHaveProperty("total_playtime");
    });

    it("should filter by name", async () => {
      pool.query.mockResolvedValueOnce([
        [
          {
            steamid: "76561198000000001",
            name: "TestPlayer",
            game: "csgo",
            total_playtime: 12345,
            last_seen: "2025-10-26T12:00:00Z",
          },
        ],
      ]);

      const response = await request(app)
        .get("/players?name=Test")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("data");
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data[0].name).toContain("Test");
    });

    it("should handle pagination parameters", async () => {
      pool.query.mockResolvedValueOnce([[]]);

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
    it("should return specific player details grouped by game", async () => {
      pool.query
        .mockResolvedValueOnce([
          [
            {
              id: 1,
              steamid: "76561198000000001",
              latest_name: "Player1",
              game: "csgo",
              playtime: 12345,
              server_ip: "1.2.3.4",
              server_port: 27015,
              last_seen: "2025-10-26T12:00:00Z",
              created_at: "2025-10-20T10:00:00Z",
            },
            {
              id: 2,
              steamid: "76561198000000001",
              latest_name: "Player1",
              game: "counterstrike2",
              playtime: 5000,
              server_ip: "1.2.3.4",
              server_port: 27016,
              last_seen: "2025-10-26T14:00:00Z",
              created_at: "2025-10-21T10:00:00Z",
            },
          ],
        ])
        .mockResolvedValueOnce([
          [
            { game: "csgo", total_playtime: 12345, last_seen: "2025-10-26T12:00:00Z" },
            { game: "counterstrike2", total_playtime: 5000, last_seen: "2025-10-26T14:00:00Z" },
          ],
        ]);

      const response = await request(app)
        .get("/players/76561198000000001")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("steamid");
      expect(response.body).toHaveProperty("csgo");
      expect(response.body).toHaveProperty("counterstrike2");
      
      // Check CS:GO stats
      expect(response.body.csgo).toHaveProperty("total_playtime");
      expect(response.body.csgo).toHaveProperty("last_seen");
      expect(response.body.csgo).toHaveProperty("sessions");
      expect(Array.isArray(response.body.csgo.sessions)).toBe(true);
      
      // Check CS2 stats
      expect(response.body.counterstrike2).toHaveProperty("total_playtime");
      expect(response.body.counterstrike2).toHaveProperty("last_seen");
      expect(response.body.counterstrike2).toHaveProperty("sessions");
    });

    it("should return 400 for invalid SteamID", async () => {
      const response = await request(app)
        .get("/players/invalid-steamid")
        .expect("Content-Type", /json/)
        .expect(400);

      expect(response.body).toHaveProperty("error");
    });

    it("should return 404 for non-existent player", async () => {
      pool.query.mockResolvedValueOnce([[]]);

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
