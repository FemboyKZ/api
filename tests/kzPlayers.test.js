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

describe("KZ Players Endpoints", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    kzRecords.getKzPool.mockReturnValue(mockPool);
  });

  describe("GET /kzglobal/players", () => {
    it("should return paginated list of players with stats", async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ count: 0 }]]) // tableExists query 1
        .mockResolvedValueOnce([[{ count: 0 }]]) // tableExists query 2
        .mockResolvedValueOnce([[{ count: 0 }]]) // tableExists query 3
        .mockResolvedValueOnce([[{ total: 2 }]])
        .mockResolvedValueOnce([
          [
            {
              id: 1,
              steamid64: "76561198000000001",
              steam_id: "STEAM_1:1:19999500",
              player_name: "remulian",
              is_banned: false,
              records: 150,
              points: 5000,
              maps_completed: 45,
              best_time: 45.123,
              last_record: "2025-01-15T12:00:00Z",
            },
            {
              id: 2,
              steamid64: "76561198000000002",
              steam_id: "STEAM_1:0:19999501",
              player_name: "kz_pro",
              is_banned: false,
              records: 500,
              points: 15000,
              maps_completed: 120,
              best_time: 30.456,
              last_record: "2025-01-16T10:00:00Z",
            },
          ],
        ]);

      const response = await request(app)
        .get("/kzglobal/players")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("data");
      expect(response.body).toHaveProperty("pagination");
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data[0]).toHaveProperty("steamid64");
      expect(response.body.data[0]).toHaveProperty("records");
      expect(response.body.data[0]).toHaveProperty("points");
    });

    it("should filter by player name", async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ count: 0 }]]) // tableExists query 1
        .mockResolvedValueOnce([[{ count: 0 }]]) // tableExists query 2
        .mockResolvedValueOnce([[{ count: 0 }]]) // tableExists query 3
        .mockResolvedValueOnce([[{ total: 0 }]])
        .mockResolvedValueOnce([[]]);

      await request(app).get("/kzglobal/players?name=remulian").expect(200);

      const call = mockPool.query.mock.calls[4]; // Index 4 after 3x tableExists + total
      expect(call[0]).toContain("player_name LIKE");
      expect(call[1]).toContain("%remulian%");
    });

    it("should filter by banned status", async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ count: 0 }]]) // tableExists query 1
        .mockResolvedValueOnce([[{ count: 0 }]]) // tableExists query 2
        .mockResolvedValueOnce([[{ count: 0 }]]) // tableExists query 3
        .mockResolvedValueOnce([[{ total: 0 }]])
        .mockResolvedValueOnce([[]]);

      await request(app).get("/kzglobal/players?banned=true").expect(200);

      const call = mockPool.query.mock.calls[4]; // Index 4 after 3x tableExists + total
      expect(call[0]).toContain("is_banned =");
    });

    it("should sort by records desc by default", async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ count: 0 }]]) // tableExists query 1
        .mockResolvedValueOnce([[{ count: 0 }]]) // tableExists query 2
        .mockResolvedValueOnce([[{ count: 0 }]]) // tableExists query 3
        .mockResolvedValueOnce([[{ total: 0 }]])
        .mockResolvedValueOnce([[]]);

      await request(app).get("/kzglobal/players").expect(200);

      const call = mockPool.query.mock.calls[4]; // Index 4 after 3x tableExists + total
      expect(call[0]).toContain("ORDER BY records DESC");
    });

    it("should sort by player name", async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ count: 0 }]]) // tableExists query 1
        .mockResolvedValueOnce([[{ count: 0 }]]) // tableExists query 2
        .mockResolvedValueOnce([[{ count: 0 }]]) // tableExists query 3
        .mockResolvedValueOnce([[{ total: 0 }]])
        .mockResolvedValueOnce([[]]);

      await request(app)
        .get("/kzglobal/players?sort=name&order=asc")
        .expect(200);

      const call = mockPool.query.mock.calls[4]; // Index 4 after 3x tableExists + total
      expect(call[0]).toContain("ORDER BY p.player_name ASC");
    });
  });

  describe("GET /kzglobal/players/:steamid", () => {
    it("should return player details with comprehensive stats", async () => {
      mockPool.query
        .mockResolvedValueOnce([
          [
            {
              id: 1,
              steamid64: "76561198000000001",
              steam_id: "STEAM_1:1:19999500",
              player_name: "remulian",
              is_banned: false,
            },
          ],
        ])
        .mockResolvedValueOnce([[{ count: 0 }]]) // tableExists query for kz_player_statistics
        .mockResolvedValueOnce([
          [
            {
              total_records: 150,
              maps_completed: 45,
              total_points: 5000,
              avg_time: 180.5,
              best_time: 45.123,
              worst_time: 450.789,
              pro_records: 120,
              tp_records: 30,
              first_record: "2024-01-01T00:00:00Z",
              last_record: "2025-01-15T12:00:00Z",
            },
          ],
        ])
        .mockResolvedValueOnce([[{ count: 0 }]]) // tableExists query for kz_worldrecords_cache
        .mockResolvedValueOnce([[{ world_records: 5 }]])
        .mockResolvedValueOnce([
          [
            {
              mode: "kz_timer",
              records: 100,
              points: 3500,
              avg_time: 170.5,
              best_time: 45.123,
            },
            {
              mode: "kz_simple",
              records: 50,
              points: 1500,
              avg_time: 190.2,
              best_time: 50.456,
            },
          ],
        ])
        .mockResolvedValueOnce([[]]);

      const response = await request(app)
        .get("/kzglobal/players/76561198000000001")
        .expect(200);

      expect(response.body).toHaveProperty("player");
      expect(response.body).toHaveProperty("statistics");
      expect(response.body).toHaveProperty("recent_records");
      expect(response.body.player.steamid64).toBe("76561198000000001");
      expect(response.body.statistics).toHaveProperty("world_records");
      expect(response.body.statistics.mode_breakdown).toHaveLength(2);
    });

    it("should support SteamID3 format", async () => {
      // Player lookup returns empty (404)
      mockPool.query.mockResolvedValueOnce([[]]);

      await request(app).get("/kzglobal/players/[U:1:40000001]").expect(404);

      // Verify the converted SteamID64 was used in query
      expect(mockPool.query).toHaveBeenCalled();
    });

    it("should return 400 for invalid steamid", async () => {
      await request(app).get("/kzglobal/players/invalid").expect(400);
    });

    it("should return 404 for non-existent player", async () => {
      mockPool.query.mockResolvedValueOnce([[]]);

      await request(app).get("/kzglobal/players/76561198999999999").expect(404);
    });
  });

  describe("GET /kzglobal/players/:steamid/records", () => {
    it("should return paginated records for a player", async () => {
      const recordData = {
        id: 1,
        map_name: "kz_synergy_x",
        mode: "kz_timer",
        stage: 0,
        time: 125.456,
        teleports: 0,
        points: 50,
        server_name: "Test Server",
        created_on: "2025-01-15T12:00:00Z",
      };

      mockPool.query
        .mockResolvedValueOnce([[{ count: 0 }]]) // tableExists query for kz_player_statistics
        .mockResolvedValueOnce([[{ total: 1 }]])
        .mockResolvedValueOnce([[recordData]]);

      const response = await request(app)
        .get("/kzglobal/players/76561198000000001/records")
        .expect(200);

      expect(response.body).toHaveProperty("data");
      expect(response.body).toHaveProperty("pagination");
      expect(response.body.data[0]).toHaveProperty("map_name");
      expect(response.body.data[0]).toHaveProperty("time");
    });

    it("should filter by map name", async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ total: 0 }]])
        .mockResolvedValueOnce([[]]);

      const response = await request(app)
        .get("/kzglobal/players/76561198000000001/records?map=synergy")
        .expect(200);

      expect(response.body).toHaveProperty("data");
      const call = mockPool.query.mock.calls[0];
      expect(call[0]).toContain("map_name LIKE");
    });

    it("should filter by mode", async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ total: 0 }]])
        .mockResolvedValueOnce([[]]);

      const response = await request(app)
        .get("/kzglobal/players/76561198000000001/records?mode=kz_timer")
        .expect(200);

      expect(response.body).toHaveProperty("data");
      const call = mockPool.query.mock.calls[0];
      expect(call[0]).toContain("mode =");
    });

    it("should sort by time ascending", async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ count: 0 }]]) // tableExists query for kz_player_statistics
        .mockResolvedValueOnce([[{ total: 0 }]])
        .mockResolvedValueOnce([[]]);

      const response = await request(app)
        .get("/kzglobal/players/76561198000000001/records?sort=time&order=asc")
        .expect(200);

      expect(response.body).toHaveProperty("data");
      const call = mockPool.query.mock.calls[2];
      expect(call[0]).toMatch(/ORDER BY r\.time ASC/);
    });

    it("should return 400 for invalid steamid", async () => {
      await request(app).get("/kzglobal/players/invalid/records").expect(400);
    });
  });
});
