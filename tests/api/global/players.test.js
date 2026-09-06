const request = require("supertest");
const app = require("../../../src/app");
const kzRecords = require("../../../src/db/kzRecords");
const { driveList } = require("../../fixtures/listEndpoint");
const { resetSchemaCache } = require("../../../src/db/schema");

// Create a single shared mock pool
const mockPool = {
  query: jest.fn(),
};

jest.mock("../../../src/db/kzRecords");

jest.mock("../../../src/db/redis", () => ({
  isRedisConnected: jest.fn(() => false),
  getCachedData: jest.fn(() => null),
  setCachedData: jest.fn(),
}));

describe("KZ Players Endpoints", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    kzRecords.getKzPool.mockReturnValue(mockPool);
    // schema probes memoise, so start each test from a cold cache.
    resetSchemaCache();
  });

  describe("GET /global/players", () => {
    it("should return paginated list of players with stats", async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ count: 0 }]]) // tableExists: kz_player_statistics
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
        .get("/global/players")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("data");
      expect(response.body).toHaveProperty("pagination");
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data[0]).toHaveProperty("steamid64");
      expect(response.body.data[0]).toHaveProperty("records");
      expect(response.body.data[0]).toHaveProperty("points");
    });

    // A tableExists probe for kz_player_statistics runs ahead of the COUNT.
    it.each([
      ["player name", "?name=remulian", "player_name LIKE", ["%remulian%"]],
      ["banned status", "?banned=true", "is_banned =", []],
      ["nothing, sorting by records", "", "ORDER BY records DESC", []],
      [
        "name, sorted A->Z",
        "?sort=name&order=asc",
        "ORDER BY p.player_name ASC",
        [],
      ],
    ])("filters by %s", async (_name, queryString, fragment, params) => {
      const { rowsQuery } = await driveList(
        app,
        mockPool,
        `/global/players${queryString}`,
        { probes: [[{ count: 0 }]] },
      );

      expect(rowsQuery[0]).toContain(fragment);
      expect(rowsQuery[1]).toEqual(expect.arrayContaining(params));
    });
  });

  describe("GET /global/players/:steamid", () => {
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
        .get("/global/players/76561198000000001")
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

      await request(app).get("/global/players/[U:1:40000001]").expect(404);

      // Verify the converted SteamID64 was used in query
      expect(mockPool.query).toHaveBeenCalled();
    });

    it("should return 400 for invalid steamid", async () => {
      await request(app).get("/global/players/invalid").expect(400);
    });

    it("should return 404 for non-existent player", async () => {
      mockPool.query.mockResolvedValueOnce([[]]);

      await request(app).get("/global/players/76561198999999999").expect(404);
    });
  });

  describe("GET /global/players/:steamid/records", () => {
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
        .mockResolvedValueOnce([[{ total: 1 }]]) // COUNT(*) live count
        .mockResolvedValueOnce([[recordData]]); // records query

      const response = await request(app)
        .get("/global/players/76561198000000001/records")
        .expect(200);

      expect(response.body).toHaveProperty("data");
      expect(response.body).toHaveProperty("pagination");
      expect(response.body.data[0]).toHaveProperty("map_name");
      expect(response.body.data[0]).toHaveProperty("time");
    });

    it.each([
      ["map name", "?map=synergy", "map_name LIKE"],
      ["mode", "?mode=kz_timer", "mode ="],
      ["time, ascending", "?sort=time&order=asc", "ORDER BY r.time ASC"],
    ])(
      "filters a player's records by %s",
      async (_name, queryString, fragment) => {
        const { rowsQuery } = await driveList(
          app,
          mockPool,
          `/global/players/76561198000000001/records${queryString}`,
        );

        expect(rowsQuery[0]).toContain(fragment);
      },
    );

    it("should return 400 for invalid steamid", async () => {
      await request(app).get("/global/players/invalid/records").expect(400);
    });
  });
});
