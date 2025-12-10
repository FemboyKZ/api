const request = require("supertest");
const app = require("../src/app");
const pool = require("../src/db");

// Mock database pool
jest.mock("../src/db", () => ({
  query: jest.fn(),
}));

// Mock redis
jest.mock("../src/db/redis", () => ({
  isRedisConnected: jest.fn().mockReturnValue(true),
  clearCache: jest.fn(),
  clearCachePattern: jest.fn(),
}));

// Mock websocket
jest.mock("../src/services/websocket", () => ({
  getWebSocketStats: jest.fn().mockReturnValue({
    connected: 0,
    subscriptions: {},
  }),
}));

describe("History Endpoints", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("GET /history/servers/:ip/:port", () => {
    it("should return server history", async () => {
      pool.query.mockResolvedValueOnce([
        [
          {
            server_ip: "192.168.1.1",
            server_port: 27015,
            status: 1,
            map: "de_dust2",
            player_count: 10,
            maxplayers: 32,
            recorded_at: new Date(),
          },
        ],
      ]);

      const response = await request(app)
        .get("/history/servers/192.168.1.1/27015")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("server");
      expect(response.body).toHaveProperty("data");
    });

    it("should handle time range filters", async () => {
      pool.query.mockResolvedValueOnce([[]]);

      const response = await request(app)
        .get("/history/servers/192.168.1.1/27015?hours=48&interval=120")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("hours", 48);
      expect(response.body).toHaveProperty("interval", 120);
    });

    it("should return 400 for invalid IP", async () => {
      const response = await request(app)
        .get("/history/servers/invalid-ip/27015")
        .expect("Content-Type", /json/)
        .expect(400);

      expect(response.body).toHaveProperty("error");
    });

    it("should handle database errors", async () => {
      pool.query.mockRejectedValueOnce(new Error("Database error"));

      const response = await request(app)
        .get("/history/servers/192.168.1.1/27015")
        .expect("Content-Type", /json/)
        .expect(500);

      expect(response.body).toHaveProperty("error");
    });
  });

  describe("GET /history/players/:steamid", () => {
    it("should return player session history", async () => {
      pool.query.mockResolvedValueOnce([
        [
          {
            steamid: "76561198000000001",
            name: "Player1",
            server_ip: "192.168.1.1",
            server_port: 27015,
            joined_at: new Date(),
            left_at: new Date(),
            duration: 3600,
          },
        ],
      ]);
      pool.query.mockResolvedValueOnce([[{ total: 1 }]]);

      const response = await request(app)
        .get("/history/players/76561198000000001")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("steamid");
      expect(response.body).toHaveProperty("data");
      expect(response.body).toHaveProperty("total");
    });

    it("should handle database errors", async () => {
      pool.query.mockRejectedValueOnce(new Error("Database error"));

      const response = await request(app)
        .get("/history/players/76561198000000001")
        .expect("Content-Type", /json/)
        .expect(500);

      expect(response.body).toHaveProperty("error");
    });
  });

  describe("GET /history/maps", () => {
    it("should return map rotation history", async () => {
      pool.query.mockResolvedValueOnce([
        [
          {
            id: 1,
            server_ip: "192.168.1.1",
            server_port: 27015,
            map_name: "de_dust2",
            started_at: new Date(),
            ended_at: new Date(),
          },
        ],
      ]);
      pool.query.mockResolvedValueOnce([[{ total: 1 }]]);

      const response = await request(app)
        .get("/history/maps")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("data");
      expect(response.body).toHaveProperty("total");
    });

    it("should filter by server", async () => {
      pool.query.mockResolvedValueOnce([[]]);
      pool.query.mockResolvedValueOnce([[{ total: 0 }]]);

      const response = await request(app)
        .get("/history/maps?server=192.168.1.1:27015")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("data");
    });

    it("should handle database errors", async () => {
      pool.query.mockRejectedValueOnce(new Error("Database error"));

      const response = await request(app)
        .get("/history/maps")
        .expect("Content-Type", /json/)
        .expect(500);

      expect(response.body).toHaveProperty("error");
    });
  });

  describe("GET /history/trends/daily", () => {
    it("should return daily aggregated trends", async () => {
      pool.query.mockResolvedValueOnce([
        [
          {
            stat_date: "2024-01-01",
            server_ip: "192.168.1.1",
            server_port: 27015,
            total_players: 100,
            unique_players: 50,
            peak_players: 20,
            avg_players: 10,
            uptime_minutes: 1440,
            total_maps_played: 5,
          },
        ],
      ]);

      const response = await request(app)
        .get("/history/trends/daily")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("data");
      expect(response.body).toHaveProperty("days");
    });

    it("should handle custom time range", async () => {
      pool.query.mockResolvedValueOnce([[]]);

      const response = await request(app)
        .get("/history/trends/daily?days=30")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("days", 30);
    });

    it("should handle database errors", async () => {
      pool.query.mockRejectedValueOnce(new Error("Database error"));

      const response = await request(app)
        .get("/history/trends/daily")
        .expect("Content-Type", /json/)
        .expect(500);

      expect(response.body).toHaveProperty("error");
    });
  });

  describe("GET /history/trends/hourly", () => {
    it("should return hourly trends", async () => {
      pool.query.mockResolvedValueOnce([
        [
          {
            hour: "2024-01-01 12:00:00",
            server_ip: "192.168.1.1",
            server_port: 27015,
            avg_players: 10,
            peak_players: 15,
            min_players: 5,
          },
        ],
      ]);

      const response = await request(app)
        .get("/history/trends/hourly")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("data");
      expect(response.body).toHaveProperty("hours");
    });

    it("should handle database errors", async () => {
      pool.query.mockRejectedValueOnce(new Error("Database error"));

      const response = await request(app)
        .get("/history/trends/hourly")
        .expect("Content-Type", /json/)
        .expect(500);

      expect(response.body).toHaveProperty("error");
    });
  });
});
