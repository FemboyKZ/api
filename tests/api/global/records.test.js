const request = require("supertest");
const app = require("../../../src/app");
const kzRecords = require("../../../src/db/kzRecords");
const { driveList } = require("../../fixtures/listEndpoint");

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

describe("KZ Records Endpoints", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    kzRecords.getKzPool.mockReturnValue(mockPool);
  });

  describe("GET /global/records", () => {
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
        .get("/global/records")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("data");
      expect(response.body).toHaveProperty("pagination");
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data[0]).toHaveProperty("player_name");
      expect(response.body.data[0]).toHaveProperty("map_name");
      expect(response.body.data[0]).toHaveProperty("time");
    });

    it.each([
      ["map name", "?map=synergy", "map_name LIKE"],
      ["player steamid", "?player=76561198000000001", "steamid64 ="],
      ["mode", "?mode=kz_timer", "mode ="],
      ["stage", "?stage=0", "stage ="],
      ["pro runs only", "?teleports=pro", "teleports = 0"],
      ["nothing, sorting newest first", "", "ORDER BY r.created_on DESC"],
    ])("filters by %s", async (_name, queryString, fragment) => {
      const { rowsQuery } = await driveList(
        app,
        mockPool,
        `/global/records${queryString}`,
      );

      expect(rowsQuery[0]).toContain(fragment);
    });

    // Banned players' records stay out of every listing unless asked for by name.
    it("excludes banned players by default", async () => {
      const { rowsQuery } = await driveList(app, mockPool, "/global/records");

      expect(rowsQuery[0]).toMatch(
        /\(p\.is_banned IS NULL OR p\.is_banned = FALSE\)/,
      );
    });

    it("includes banned players when requested", async () => {
      const { rowsQuery } = await driveList(
        app,
        mockPool,
        "/global/records?include_banned=true",
      );

      expect(rowsQuery[0]).not.toContain("is_banned IS NULL");
    });
  });

  describe("GET /global/records/leaderboard/:mapname", () => {
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
        .get("/global/records/leaderboard/kz_synergy_x")
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

    // mode and stage are always bound, so only their values distinguish the query;
    // teleports is the one filter that changes the SQL.
    it.each([
      ["mode", "?mode=kz_simple", "kz_simple"],
      ["stage", "?stage=1", 1],
    ])(
      "binds %s into the leaderboard query",
      async (_name, queryString, param) => {
        mockPool.query
          .mockResolvedValueOnce([[{ id: 1 }]])
          .mockResolvedValueOnce([[]]);

        await request(app)
          .get(`/global/records/leaderboard/kz_synergy_x${queryString}`)
          .expect(200);

        expect(mockPool.query.mock.calls[1][1]).toContain(param);
      },
    );

    it.each([
      ["pro", "?teleports=pro", "r.teleports = 0"],
      ["tp", "?teleports=tp", "r.teleports > 0"],
    ])(
      "restricts the leaderboard to %s runs",
      async (_name, queryString, fragment) => {
        mockPool.query
          .mockResolvedValueOnce([[{ id: 1 }]])
          .mockResolvedValueOnce([[]]);

        await request(app)
          .get(`/global/records/leaderboard/kz_synergy_x${queryString}`)
          .expect(200);

        expect(mockPool.query.mock.calls[1][0]).toContain(fragment);
      },
    );

    it("should return 404 for non-existent map", async () => {
      mockPool.query.mockResolvedValueOnce([[]]);

      await request(app)
        .get("/global/records/leaderboard/nonexistent_map")
        .expect(404);
    });
  });

  describe("GET /global/records/recent", () => {
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
        .get("/global/records/recent")
        .expect(200);

      expect(response.body).toHaveProperty("data");
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data[0]).toHaveProperty("created_on");
    });

    it("should filter by mode", async () => {
      mockPool.query.mockResolvedValueOnce([[]]);

      await request(app)
        .get("/global/records/recent?mode=kz_timer")
        .expect(200);

      expect(mockPool.query.mock.calls[0][0]).toContain("mode =");
    });

    // The limit is clamped rather than rejected, so a huge one still answers.
    it.each([
      ["honours a limit under the cap", 25, 25],
      ["clamps a limit over the cap", 500, 100],
    ])("%s", async (_name, requested, applied) => {
      mockPool.query.mockResolvedValueOnce([[]]);

      await request(app)
        .get(`/global/records/recent?limit=${requested}`)
        .expect(200);

      expect(mockPool.query.mock.calls[0][1]).toContain(applied);
    });
  });

  describe("GET /global/records/worldrecords", () => {
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
        .get("/global/records/worldrecords")
        .expect(200);

      expect(response.body).toHaveProperty("mode");
      expect(response.body).toHaveProperty("data");
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data[0]).toHaveProperty("map_name");
      expect(response.body.data[0]).toHaveProperty("player_name");
    });

    // mode, stage and teleports are all bound, so the values are the whole signal.
    // Teleports defaults to 0: world records mean pro runs unless asked otherwise.
    it.each([
      ["mode", "?mode=kz_simple", "kz_simple"],
      ["stage", "?stage=1", 1],
      ["pro runs by default", "", 0],
    ])(
      "binds %s into the world record query",
      async (_name, queryString, param) => {
        mockPool.query.mockResolvedValueOnce([[]]);

        await request(app)
          .get(`/global/records/worldrecords${queryString}`)
          .expect(200);

        const [sql, params] = mockPool.query.mock.calls[0];
        expect(sql).toContain("wrc.teleports = ?");
        expect(params).toContain(param);
      },
    );
  });

  describe("GET /global/records/:id", () => {
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
        .get("/global/records/1000")
        .expect(200);

      expect(response.body.data).toHaveProperty("original_id", 1000);
      expect(response.body.data).toHaveProperty("map_name");
      expect(response.body.data).toHaveProperty("player_name");
    });

    it("should return 404 for non-existent record", async () => {
      mockPool.query.mockResolvedValueOnce([[]]);

      await request(app).get("/global/records/999999").expect(404);
    });

    it("should return 400 for invalid record id", async () => {
      await request(app).get("/global/records/invalid").expect(400);
    });
  });
});
