const request = require("supertest");
const app = require("../src/app");
const kzRecords = require("../src/db/kzRecords");

// Create a single shared mock pool
const mockPool = {
  query: jest.fn(),
};

jest.mock("../src/db/kzRecords");

jest.mock("../src/db/redis", () => ({
  isRedisConnected: jest.fn(() => false),
  getCachedData: jest.fn(() => null),
  setCachedData: jest.fn(),
}));

describe("KZ Records Endpoints", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    kzRecords.getKzPool.mockReturnValue(mockPool);
  });

  describe("GET /kzglobal/records", () => {
    it("should return paginated list of records", async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ total: 2 }]])
        .mockResolvedValueOnce([
          [
            {
              id: 1,
              original_id: 1000,
              player_id: "76561198000000001",
              player_name: "remulian",
              steamid64: "76561198000000001",
              is_banned: false,
              map_id: 1,
              map_name: "kz_synergy_x",
              server_id: 123,
              server_name: "Test Server",
              mode: "kz_timer",
              stage: 0,
              time: 125.456,
              teleports: 0,
              points: 50,
              tickrate: 128,
              created_on: "2025-01-15T12:00:00Z",
            },
          ],
        ]);

      const response = await request(app)
        .get("/kzglobal/records")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("data");
      expect(response.body).toHaveProperty("pagination");
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data[0]).toHaveProperty("player_name");
      expect(response.body.data[0]).toHaveProperty("map_name");
      expect(response.body.data[0]).toHaveProperty("time");
    });

    it("should filter by map name", async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ total: 0 }]])
        .mockResolvedValueOnce([[]]);

      await request(app).get("/kzglobal/records?map=synergy").expect(200);

      const call = mockPool.query.mock.calls[1];
      expect(call[0]).toContain("map_name LIKE");
    });

    it("should filter by player steamid", async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ total: 0 }]])
        .mockResolvedValueOnce([[]]);

      await request(app)
        .get("/kzglobal/records?player=76561198000000001")
        .expect(200);

      const call = mockPool.query.mock.calls[1];
      expect(call[0]).toContain("steamid64 =");
    });

    it("should filter by mode", async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ total: 0 }]])
        .mockResolvedValueOnce([[]]);

      await request(app).get("/kzglobal/records?mode=kz_timer").expect(200);

      const call = mockPool.query.mock.calls[1];
      expect(call[0]).toContain("mode =");
    });

    it("should filter by stage", async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ total: 0 }]])
        .mockResolvedValueOnce([[]]);

      await request(app).get("/kzglobal/records?stage=0").expect(200);

      const call = mockPool.query.mock.calls[1];
      expect(call[0]).toContain("stage =");
    });

    it("should filter pro runs only", async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ total: 0 }]])
        .mockResolvedValueOnce([[]]);

      await request(app).get("/kzglobal/records?teleports=pro").expect(200);

      const call = mockPool.query.mock.calls[1];
      expect(call[0]).toContain("teleports = 0");
    });

    it("should exclude banned players by default", async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ total: 0 }]])
        .mockResolvedValueOnce([[]]);

      await request(app).get("/kzglobal/records").expect(200);

      const call = mockPool.query.mock.calls[1];
      expect(call[0]).toMatch(
        /\(p\.is_banned IS NULL OR p\.is_banned = FALSE\)/,
      );
    });

    it("should include banned players when requested", async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ total: 0 }]])
        .mockResolvedValueOnce([[]]);

      await request(app)
        .get("/kzglobal/records?include_banned=true")
        .expect(200);

      const call = mockPool.query.mock.calls[1];
      expect(call[0]).not.toContain("is_banned IS NULL");
    });

    it("should sort by created_on desc by default", async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ total: 0 }]])
        .mockResolvedValueOnce([[]]);

      await request(app).get("/kzglobal/records").expect(200);

      const call = mockPool.query.mock.calls[1];
      expect(call[0]).toContain("ORDER BY r.created_on DESC");
    });
  });

  describe("GET /kzglobal/records/leaderboard/:mapname", () => {
    it("should return leaderboard with best times per player", async () => {
      const leaderboardData = [
        {
          id: 1,
          original_id: 1000,
          player_name: "Player1",
          steamid64: "76561198000000001",
          is_banned: false,
          time: 125.456,
          teleports: 0,
          points: 50,
          tickrate: 128,
          server_id: 1,
          server_name: "Test Server",
          created_on: "2025-01-15T12:00:00Z",
          rank: 1,
        },
        {
          id: 2,
          original_id: 1001,
          player_name: "Player2",
          steamid64: "76561198000000002",
          is_banned: false,
          time: 135.789,
          teleports: 0,
          points: 45,
          tickrate: 128,
          server_id: 1,
          server_name: "Test Server",
          created_on: "2025-01-14T10:00:00Z",
          rank: 2,
        },
      ];

      mockPool.query
        .mockResolvedValueOnce([[{ id: 1 }]])
        .mockResolvedValueOnce([leaderboardData]);

      const response = await request(app)
        .get("/kzglobal/records/leaderboard/kz_synergy_x")
        .expect(200);

      expect(response.body).toHaveProperty("map", "kz_synergy_x");
      expect(response.body).toHaveProperty("mode");
      expect(response.body).toHaveProperty("data");
      expect(response.body.data).toHaveLength(2);
      expect(response.body.data[0].rank).toBe(1);
      expect(response.body.data[0].time).toBeLessThan(
        response.body.data[1].time,
      );
    });

    it("should filter by mode", async () => {
      mockPool.query.mockResolvedValueOnce([[{ id: 1 }]]);
      mockPool.query.mockResolvedValueOnce([[]]);

      await request(app)
        .get("/kzglobal/records/leaderboard/kz_synergy_x?mode=kz_simple")
        .expect(200);

      const call = mockPool.query.mock.calls[1];
      expect(call[1]).toContain("kz_simple");
    });

    it("should filter by stage", async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ id: 1 }]])
        .mockResolvedValueOnce([[]]);

      await request(app)
        .get("/kzglobal/records/leaderboard/kz_synergy_x?stage=1")
        .expect(200);

      const call = mockPool.query.mock.calls[1];
      expect(call[1]).toContain(1);
    });

    it("should filter tp runs", async () => {
      mockPool.query.mockResolvedValueOnce([[{ id: 1 }]]);
      mockPool.query.mockResolvedValueOnce([[]]);

      await request(app)
        .get("/kzglobal/records/leaderboard/kz_synergy_x?teleports=tp")
        .expect(200);

      const call = mockPool.query.mock.calls[1];
      expect(call[0]).toContain("teleports > 0");
    });

    it("should return 404 for non-existent map", async () => {
      mockPool.query.mockResolvedValueOnce([[]]);

      await request(app)
        .get("/kzglobal/records/leaderboard/nonexistent_map")
        .expect(404);
    });
  });

  describe("GET /kzglobal/records/recent", () => {
    it("should return most recent records", async () => {
      mockPool.query.mockResolvedValueOnce([
        [
          {
            id: 1,
            player_name: "Player1",
            map_name: "kz_synergy_x",
            mode: "kz_timer",
            time: 125.456,
            teleports: 0,
            created_on: "2025-01-15T12:00:00Z",
          },
        ],
      ]);

      const response = await request(app)
        .get("/kzglobal/records/recent")
        .expect(200);

      expect(response.body).toHaveProperty("data");
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data[0]).toHaveProperty("created_on");
    });

    it("should filter by mode", async () => {
      mockPool.query.mockResolvedValueOnce([[]]);

      await request(app)
        .get("/kzglobal/records/recent?mode=kz_timer")
        .expect(200);

      const call = mockPool.query.mock.calls[0];
      expect(call[0]).toContain("mode =");
    });

    it("should respect limit parameter", async () => {
      mockPool.query.mockResolvedValueOnce([[]]);

      await request(app).get("/kzglobal/records/recent?limit=25").expect(200);

      const call = mockPool.query.mock.calls[0];
      expect(call[1]).toContain(25);
    });

    it("should enforce maximum limit", async () => {
      mockPool.query.mockResolvedValueOnce([[]]);

      await request(app).get("/kzglobal/records/recent?limit=500").expect(200);

      const call = mockPool.query.mock.calls[0];
      expect(call[1]).toContain(100); // Max is 100
    });
  });

  describe("GET /kzglobal/records/worldrecords", () => {
    it("should return current world records", async () => {
      const wrRecord = {
        id: 1,
        map_name: "kz_synergy_x",
        player_name: "Player1",
        steamid64: "76561198000000001",
        time: 125.456,
        points: 50,
        server_name: "Test Server",
        created_on: "2025-01-15T12:00:00Z",
      };

      mockPool.query.mockResolvedValueOnce([[wrRecord]]);

      const response = await request(app)
        .get("/kzglobal/records/worldrecords")
        .expect(200);

      expect(response.body).toHaveProperty("mode");
      expect(response.body).toHaveProperty("data");
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data[0]).toHaveProperty("map_name");
      expect(response.body.data[0]).toHaveProperty("player_name");
    });

    it("should filter by mode", async () => {
      mockPool.query.mockResolvedValueOnce([[]]);

      await request(app)
        .get("/kzglobal/records/worldrecords?mode=kz_simple")
        .expect(200);

      const call = mockPool.query.mock.calls[0];
      expect(call[1]).toContain("kz_simple");
    });

    it("should filter by stage", async () => {
      mockPool.query.mockResolvedValueOnce([[]]);

      await request(app)
        .get("/kzglobal/records/worldrecords?stage=1")
        .expect(200);

      const call = mockPool.query.mock.calls[0];
      expect(call[1]).toContain(1);
    });

    it("should default to pro runs", async () => {
      mockPool.query.mockResolvedValueOnce([[]]);

      await request(app).get("/kzglobal/records/worldrecords").expect(200);

      const call = mockPool.query.mock.calls[0];
      expect(call[0]).toContain("teleports = 0");
    });
  });

  describe("GET /kzglobal/records/:id", () => {
    it("should return detailed record information", async () => {
      const recordDetails = {
        id: 1,
        original_id: 1000,
        player_name: "Player1",
        steamid64: "76561198000000001",
        map_name: "kz_synergy_x",
        server_name: "Test Server",
        mode: "kz_timer",
        stage: 0,
        time: 125.456,
        teleports: 0,
        points: 50,
        tickrate: 128,
        created_on: "2025-01-15T12:00:00Z",
      };

      mockPool.query.mockResolvedValueOnce([[recordDetails]]);

      const response = await request(app)
        .get("/kzglobal/records/1000")
        .expect(200);

      expect(response.body.data).toHaveProperty("original_id", 1000);
      expect(response.body.data).toHaveProperty("map_name");
      expect(response.body.data).toHaveProperty("player_name");
    });

    it("should return 404 for non-existent record", async () => {
      mockPool.query.mockResolvedValueOnce([[]]);

      await request(app).get("/kzglobal/records/999999").expect(404);
    });

    it("should return 400 for invalid record id", async () => {
      await request(app).get("/kzglobal/records/invalid").expect(400);
    });
  });
});
