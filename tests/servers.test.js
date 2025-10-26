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

describe("Server Endpoints", () => {
  describe("GET /servers", () => {
    it("should return servers list with metadata", async () => {
      // Mock server data
      pool.query.mockResolvedValueOnce([[
        {
          ip: "192.168.1.1",
          port: 27015,
          game: "csgo",
          hostname: "Test Server",
          version: "1.0",
          os: "Linux",
          secure: 1,
          status: 1,
          map: "de_dust2",
          player_count: 10,
          maxplayers: 32,
          bot_count: 0,
          players_list: JSON.stringify([])
        }
      ]]);

      const response = await request(app)
        .get("/servers")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("playersTotal");
      expect(response.body).toHaveProperty("serversOnline");
      expect(typeof response.body.playersTotal).toBe("number");
      expect(typeof response.body.serversOnline).toBe("number");
    });

    it("should filter by game type", async () => {
      pool.query.mockResolvedValueOnce([[
        {
          ip: "192.168.1.1",
          port: 27015,
          game: "csgo",
          hostname: "Test Server",
          version: "1.0",
          os: "Linux",
          secure: 1,
          status: 1,
          map: "de_dust2",
          player_count: 10,
          maxplayers: 32,
          bot_count: 0,
          players_list: JSON.stringify([])
        }
      ]]);

      const response = await request(app)
        .get("/servers?game=csgo")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("playersTotal");
      expect(response.body).toHaveProperty("serversOnline");
    });

    it("should filter by status", async () => {
      pool.query.mockResolvedValueOnce([[
        {
          ip: "192.168.1.1",
          port: 27015,
          game: "csgo",
          hostname: "Test Server",
          version: "1.0",
          os: "Linux",
          secure: 1,
          status: 1,
          map: "de_dust2",
          player_count: 10,
          maxplayers: 32,
          bot_count: 0,
          players_list: JSON.stringify([])
        }
      ]]);

      const response = await request(app)
        .get("/servers?status=1")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("serversOnline");
    });
  });

  describe("GET /servers/:ip", () => {
    it("should return 400 for invalid IP", async () => {
      const response = await request(app)
        .get("/servers/invalid-ip")
        .expect("Content-Type", /json/)
        .expect(400);

      expect(response.body).toHaveProperty("error");
    });

    it("should return 404 for non-existent server", async () => {
      // Mock empty result
      pool.query.mockResolvedValueOnce([[]]);

      await request(app).get("/servers/192.168.1.1").expect(404);
    });
  });
});
