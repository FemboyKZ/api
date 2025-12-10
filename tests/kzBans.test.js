const request = require("supertest");
const app = require("../src/app");
const kzRecords = require("../src/db/kzRecords");

// Create a single shared mock pool
const mockPool = {
  query: jest.fn(),
};

// Mock KZ database pool
jest.mock("../src/db/kzRecords");

// Mock redis
jest.mock("../src/db/redis", () => ({
  isRedisConnected: jest.fn(() => false),
  getCachedData: jest.fn(() => null),
  setCachedData: jest.fn(),
}));

describe("KZ Bans Endpoints", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    kzRecords.getKzPool.mockReturnValue(mockPool);
  });

  describe("GET /kzglobal/bans", () => {
    it("should return paginated list of bans", async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ total: 1 }]])
        .mockResolvedValueOnce([
          [
            {
              id: 1,
              ban_type: "Bhop Hack",
              expires_on: null,
              steamid64: "76561198000000001",
              player_name: "Cheater1",
              steam_id: "STEAM_1:1:19999500",
              notes: "Detected bhop script",
              server_id: 123,
              server_name: "Test Server",
              updated_by_id: "76561198000000999",
              created_on: "2025-01-01T00:00:00Z",
              updated_on: "2025-01-01T00:00:00Z",
              is_active: true,
            },
          ],
        ]);

      const response = await request(app)
        .get("/kzglobal/bans")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("data");
      expect(response.body).toHaveProperty("pagination");
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data[0]).toHaveProperty("ban_type");
      expect(response.body.data[0].is_active).toBe(true);
    });

    it("should filter by steamid", async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ total: 0 }]])
        .mockResolvedValueOnce([[]]);

      const response = await request(app)
        .get("/kzglobal/bans?steamid=76561198000000001")
        .expect(200);

      expect(mockPool.query).toHaveBeenCalled();
      expect(response.body.data).toEqual([]);
    });

    it("should filter by ban_type", async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ total: 0 }]])
        .mockResolvedValueOnce([[]]);

      await request(app).get("/kzglobal/bans?ban_type=Bhop Hack").expect(200);

      const call = mockPool.query.mock.calls[0];
      expect(call[0]).toContain("ban_type");
    });

    it("should filter active bans only", async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ total: 0 }]])
        .mockResolvedValueOnce([[]]);

      await request(app).get("/kzglobal/bans?active=true").expect(200);

      const call = mockPool.query.mock.calls[0];
      expect(call[0]).toMatch(
        /\(b\.expires_on IS NULL OR b\.expires_on > NOW\(\)\)/,
      );
    });

    it("should sort by created_on desc by default", async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ total: 0 }]])
        .mockResolvedValueOnce([[]]);

      await request(app).get("/kzglobal/bans").expect(200);

      const call = mockPool.query.mock.calls[1];
      expect(call[0]).toContain("ORDER BY b.created_on DESC");
    });
  });

  describe("GET /kzglobal/bans/active", () => {
    it("should return only active bans", async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ total: 0 }]])
        .mockResolvedValueOnce([[]]);

      await request(app).get("/kzglobal/bans/active").expect(200);

      const call = mockPool.query.mock.calls[0];
      expect(call[0]).toMatch(
        /\(b\.expires_on IS NULL OR b\.expires_on > NOW\(\)\)/,
      );
    });
  });

  describe("GET /kzglobal/bans/stats", () => {
    it("should return ban statistics", async () => {
      const overallStats = [
        {
          total_bans: 150,
          active_bans: 45,
          expired_bans: 105,
          unique_players_banned: 120,
        },
      ];

      mockPool.query
        .mockResolvedValueOnce([overallStats])
        .mockResolvedValueOnce([
          [
            { ban_type: "Bhop Hack", count: 80, active: 20 },
            { ban_type: "Strafe Hack", count: 70, active: 25 },
          ],
        ])
        .mockResolvedValueOnce([[]]);

      const response = await request(app)
        .get("/kzglobal/bans/stats")
        .expect(200);

      expect(response.body).toHaveProperty("statistics");
      expect(response.body).toHaveProperty("ban_type_breakdown");
      expect(response.body).toHaveProperty("recent_bans");
      expect(response.body.statistics).toEqual(overallStats[0]);
      expect(response.body.ban_type_breakdown).toHaveLength(2);
    });
  });

  describe("GET /kzglobal/bans/:id", () => {
    it("should return ban details by id", async () => {
      const banData = {
        id: 1,
        ban_type: "Bhop Hack",
        expires_on: null,
        ip: null,
        steamid64: "76561198000000001",
        player_name: "Cheater1",
        steam_id: "STEAM_1:1:19999500",
        notes: "Detected",
        stats: null,
        server_id: 123,
        server_name: "Test Server",
        updated_by_id: null,
        updated_by_name: null,
        created_on: "2025-01-01T00:00:00Z",
        updated_on: "2025-01-01T00:00:00Z",
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-01T00:00:00Z",
        is_active: true,
      };

      mockPool.query.mockResolvedValueOnce([[banData]]);

      const response = await request(app).get("/kzglobal/bans/1").expect(200);

      expect(response.body).toHaveProperty("data");
      expect(response.body.data).toHaveProperty("id", 1);
      expect(response.body.data).toHaveProperty("ban_type");
    });

    it("should return 404 for non-existent ban", async () => {
      mockPool.query.mockResolvedValueOnce([[]]);

      const response = await request(app)
        .get("/kzglobal/bans/999999")
        .expect(404);
      expect(response.body).toHaveProperty("error");
    });

    it("should return 400 for invalid ban id", async () => {
      await request(app).get("/kzglobal/bans/invalid").expect(400);
    });
  });

  describe("GET /kzglobal/bans/player/:steamid", () => {
    it("should return all bans for a player", async () => {
      mockPool.query.mockResolvedValueOnce([
        [
          {
            id: 1,
            ban_type: "Bhop Hack",
            expires_on: "2020-01-01T00:00:00Z",
            notes: null,
            server_id: 123,
            server_name: "Test Server",
            updated_by_id: null,
            created_on: "2019-01-01T00:00:00Z",
            updated_on: "2019-01-01T00:00:00Z",
            is_active: false,
          },
          {
            id: 2,
            ban_type: "Strafe Hack",
            expires_on: null,
            notes: null,
            server_id: 123,
            server_name: "Test Server",
            updated_by_id: null,
            created_on: "2024-01-01T00:00:00Z",
            updated_on: "2024-01-01T00:00:00Z",
            is_active: true,
          },
        ],
      ]);

      const response = await request(app)
        .get("/kzglobal/bans/player/76561198000000001")
        .expect(200);

      expect(response.body).toHaveProperty("data");
      expect(response.body.data).toHaveLength(2);
      expect(response.body).toHaveProperty("steamid");
      expect(response.body).toHaveProperty("total", 2);
    });

    it("should filter active bans for player", async () => {
      mockPool.query.mockResolvedValueOnce([[]]);

      await request(app)
        .get("/kzglobal/bans/player/76561198000000001?active=true")
        .expect(200);

      const call = mockPool.query.mock.calls[0];
      expect(call[0]).toMatch(
        /\(b\.expires_on IS NULL OR b\.expires_on > NOW\(\)\)/,
      );
    });

    it("should return 400 for invalid steamid", async () => {
      await request(app).get("/kzglobal/bans/player/invalid").expect(400);
    });
  });
});
