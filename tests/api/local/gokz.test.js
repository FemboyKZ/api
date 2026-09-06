const request = require("supertest");
const express = require("express");

// Mock the dependencies before requiring the router
jest.mock("../../../src/db/kzLocal", () => ({
  getKzLocalCSGOPool: jest.fn(),
  getKzLocalCS2Pool: jest.fn(),
}));

jest.mock("../../../src/utils/logger", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

const {
  getKzLocalCSGOPool,
  getKzLocalCS2Pool,
} = require("../../../src/db/kzLocal");
const kzLocalRouter = require("../../../src/api/local/gokz");

const app = express();
app.use(express.json());
app.use("/local/gokz", kzLocalRouter);

describe("KZ Local Endpoints (CS:GO)", () => {
  let mockPool;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPool = {
      query: jest.fn(),
    };
    getKzLocalCSGOPool.mockReturnValue(mockPool);
  });

  // ==================== MAPS ENDPOINTS ====================
  describe("GET /local/gokz/maps", () => {
    it("should return paginated list of maps", async () => {
      const mockMaps = [
        {
          id: 1,
          name: "kz_example",
          last_played: new Date(),
          created: new Date(),
          in_ranked_pool: 1,
          courses_count: 2,
          records_count: 100,
        },
      ];

      mockPool.query
        .mockResolvedValueOnce([mockMaps])
        .mockResolvedValueOnce([[{ total: 1 }]]);

      const res = await request(app).get("/local/gokz/maps");

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe("kz_example");
      expect(res.body.data[0].in_ranked_pool).toBe(true);
      expect(res.body.data[0].tickrate).toBe(128);
      expect(res.body.pagination).toBeDefined();
    });

    it("should filter by map name", async () => {
      mockPool.query
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([[{ total: 0 }]]);

      const res = await request(app).get("/local/gokz/maps?name=example");

      expect(res.status).toBe(200);
      expect(mockPool.query).toHaveBeenCalled();
      const firstCallParams = mockPool.query.mock.calls[0][1];
      expect(firstCallParams).toContain("%example%");
    });

    it("passes the requested tickrate through to the pool selector", async () => {
      mockPool.query
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([[{ total: 0 }]]);

      const res = await request(app).get("/local/gokz/maps?tickrate=64");

      expect(res.status).toBe(200);
      // Which pool that maps to is db/kzLocal's business - see kzLocalPools.test.js
      expect(getKzLocalCSGOPool).toHaveBeenCalledWith("64");
    });

    it("should filter by ranked status", async () => {
      mockPool.query
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([[{ total: 0 }]]);

      const res = await request(app).get("/local/gokz/maps?ranked=true");

      expect(res.status).toBe(200);
      const firstCallParams = mockPool.query.mock.calls[0][1];
      expect(firstCallParams).toContain(1);
    });
  });

  describe("GET /local/gokz/maps/:mapname", () => {
    it("should return map details with courses", async () => {
      const mockMap = {
        id: 1,
        name: "kz_test",
        last_played: new Date(),
        created: new Date(),
        in_ranked_pool: 1,
      };
      const mockCourses = [
        { id: 1, course: 0, created: new Date(), records_count: 50 },
        { id: 2, course: 1, created: new Date(), records_count: 20 },
      ];
      const mockModeStats = [
        { course: 0, mode: 0, count: 30, best_time: 45000 },
        { course: 0, mode: 1, count: 20, best_time: 48000 },
      ];

      mockPool.query
        .mockResolvedValueOnce([[mockMap]])
        .mockResolvedValueOnce([mockCourses])
        .mockResolvedValueOnce([mockModeStats]);

      const res = await request(app).get("/local/gokz/maps/kz_test");

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("kz_test");
      expect(res.body.courses).toHaveLength(2);
      expect(res.body.in_ranked_pool).toBe(true);
    });

    it("should return 404 for non-existent map", async () => {
      mockPool.query.mockResolvedValueOnce([[]]);

      const res = await request(app).get("/local/gokz/maps/nonexistent");

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Map not found");
    });
  });

  // ==================== RECORDS ENDPOINTS ====================
  describe("GET /local/gokz/records", () => {
    it("should return paginated list of records", async () => {
      const mockRecords = [
        {
          id: 1,
          steamid32: 12345,
          player_name: "TestPlayer",
          map_name: "kz_test",
          map_id: 1,
          course: 0,
          mode: 0,
          style: 0,
          run_time: 45000,
          teleports: 0,
          created: new Date(),
          time_guid: "test-guid",
        },
      ];

      mockPool.query
        .mockResolvedValueOnce([mockRecords])
        .mockResolvedValueOnce([[{ total: 1 }]]);

      const res = await request(app).get("/local/gokz/records");

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].player_name).toBe("TestPlayer");
      expect(res.body.data[0].mode).toBe("vanilla");
      expect(res.body.pagination).toBeDefined();
    });

    // Which columns each filter reaches for is the point; api/local/filters.js
    // builds them once and localFilters.test.js pins that both queries get them.
    it.each([
      ["map name", "?map=kz_test", " AND m.Name LIKE ?", ["%kz_test%"]],
      [
        "player SteamID",
        "?player=76561198000000000",
        " AND t.SteamID32 = ?",
        [39734272],
      ],
      [
        "player name",
        "?player=TestPlayer",
        " AND p.Alias LIKE ?",
        ["%TestPlayer%"],
      ],
      ["mode", "?mode=1", " AND t.Mode = ?", [1]],
      ["pro runs", "?teleports=pro", " AND t.Teleports = 0", []],
      ["tp runs", "?teleports=tp", " AND t.Teleports > 0", []],
    ])(
      "filters records by %s",
      async (_name, queryString, fragment, params) => {
        mockPool.query
          .mockResolvedValueOnce([[]])
          .mockResolvedValueOnce([[{ total: 0 }]]);

        await request(app).get(`/local/gokz/records${queryString}`).expect(200);

        const [sql, args] = mockPool.query.mock.calls[0];
        expect(sql).toContain(fragment);
        expect(args).toEqual(expect.arrayContaining(params));
      },
    );
  });

  describe("GET /local/gokz/records/:id", () => {
    it("should return record details", async () => {
      const mockRecord = {
        id: 1,
        steamid32: 12345,
        player_name: "TestPlayer",
        player_country: "US",
        map_name: "kz_test",
        map_id: 1,
        course: 0,
        map_course_id: 1,
        mode: 0,
        style: 0,
        run_time: 45000,
        teleports: 0,
        created: new Date(),
        time_guid: "test-guid",
      };

      mockPool.query.mockResolvedValueOnce([[mockRecord]]);

      const res = await request(app).get("/local/gokz/records/1");

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(1);
      expect(res.body.player_name).toBe("TestPlayer");
      expect(res.body.mode).toBe("vanilla");
    });

    it("should return 404 for non-existent record", async () => {
      mockPool.query.mockResolvedValueOnce([[]]);

      const res = await request(app).get("/local/gokz/records/99999");

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Record not found");
    });
  });

  // ==================== JUMPSTATS ENDPOINTS ====================
  describe("GET /local/gokz/jumpstats", () => {
    it("should return paginated list of jumpstats", async () => {
      const mockJumpstats = [
        {
          id: 1,
          steamid32: 12345,
          player_name: "TestPlayer",
          jump_type: 0,
          mode: 0,
          distance: 256.5,
          is_block_jump: 1,
          block: 256,
          strafes: 8,
          sync: 85.5,
          pre: 280.0,
          max: 290.0,
          airtime: 0.65,
          created: new Date(),
        },
      ];

      mockPool.query
        .mockResolvedValueOnce([mockJumpstats])
        .mockResolvedValueOnce([[{ total: 1 }]]);

      const res = await request(app).get("/local/gokz/jumpstats");

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].jump_type).toBe("longjump");
      expect(res.body.pagination).toBeDefined();
    });

    it.each([
      ["jump type", "?jump_type=0", " AND j.JumpType = ?", [0]],
      ["block jumps", "?is_block=true", " AND j.IsBlockJump = ?", [1]],
      ["a minimum distance", "?min_distance=250", " AND j.Distance >= ?", []],
    ])(
      "filters jumpstats by %s",
      async (_name, queryString, fragment, params) => {
        mockPool.query
          .mockResolvedValueOnce([[]])
          .mockResolvedValueOnce([[{ total: 0 }]]);

        await request(app)
          .get(`/local/gokz/jumpstats${queryString}`)
          .expect(200);

        const [sql, args] = mockPool.query.mock.calls[0];
        expect(sql).toContain(fragment);
        expect(args).toEqual(expect.arrayContaining(params));
      },
    );
  });

  describe("GET /local/gokz/jumpstats/:id", () => {
    it("should return jumpstat details", async () => {
      const mockJumpstat = {
        id: 1,
        steamid32: 12345,
        player_name: "TestPlayer",
        player_country: "US",
        jump_type: 0,
        mode: 0,
        distance: 256.5,
        is_block_jump: 1,
        block: 256,
        strafes: 8,
        sync: 85.5,
        pre: 280.0,
        max: 290.0,
        airtime: 0.65,
        created: new Date(),
      };

      mockPool.query.mockResolvedValueOnce([[mockJumpstat]]);

      const res = await request(app).get("/local/gokz/jumpstats/1");

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(1);
      expect(res.body.jump_type).toBe("longjump");
      expect(res.body.is_block_jump).toBe(true);
    });

    it("should return 404 for non-existent jumpstat", async () => {
      mockPool.query.mockResolvedValueOnce([[]]);

      const res = await request(app).get("/local/gokz/jumpstats/99999");

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Jumpstat not found");
    });
  });

  // ==================== PLAYERS ENDPOINTS ====================
  describe("GET /local/gokz/players", () => {
    it("should return paginated list of players", async () => {
      const mockPlayers = [
        {
          steamid32: 12345,
          alias: "TestPlayer",
          country: "US",
          cheater: 0,
          last_played: new Date(),
          created: new Date(),
          records_count: 50,
          jumpstats_count: 100,
        },
      ];

      mockPool.query
        .mockResolvedValueOnce([mockPlayers])
        .mockResolvedValueOnce([[{ total: 1 }]]);

      const res = await request(app).get("/local/gokz/players");

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe("TestPlayer");
      expect(res.body.data[0].is_cheater).toBe(false);
      expect(res.body.pagination).toBeDefined();
    });

    it("should filter by player name", async () => {
      mockPool.query
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([[{ total: 0 }]]);

      const res = await request(app).get("/local/gokz/players?name=Test");

      expect(res.status).toBe(200);
      const firstCallParams = mockPool.query.mock.calls[0][1];
      expect(firstCallParams).toContain("%Test%");
    });

    it("should filter by country", async () => {
      mockPool.query
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([[{ total: 0 }]]);

      const res = await request(app).get("/local/gokz/players?country=US");

      expect(res.status).toBe(200);
      const firstCallParams = mockPool.query.mock.calls[0][1];
      expect(firstCallParams).toContain("%US%");
    });
  });

  describe("GET /local/gokz/players/:player", () => {
    it("should return player profile with statistics", async () => {
      const mockPlayer = {
        steamid32: 12345,
        alias: "TestPlayer",
        country: "US",
        cheater: 0,
        last_played: new Date(),
        created: new Date(),
      };
      const mockRecordStats = [
        {
          mode: 0,
          total_records: 50,
          pro_records: 30,
          tp_records: 20,
          first_record: new Date(),
          last_record: new Date(),
        },
      ];
      const mockJumpStats = [
        {
          jump_type: 0,
          mode: 0,
          total: 100,
          best_distance: 265.5,
          avg_distance: 250.0,
        },
      ];
      const mockAirStats = [{ mode: 0, air_type: 0, count: 500 }];
      const mockBhopStats = [
        { mode: 0, stat_type1: 0, stat_type2: 0, count: 1000 },
      ];

      mockPool.query
        .mockResolvedValueOnce([[mockPlayer]])
        .mockResolvedValueOnce([mockRecordStats])
        .mockResolvedValueOnce([mockJumpStats])
        .mockResolvedValueOnce([mockAirStats])
        .mockResolvedValueOnce([mockBhopStats]);

      const res = await request(app).get(
        "/local/gokz/players/76561198000000000",
      );

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("TestPlayer");
      expect(res.body.records_statistics).toHaveLength(1);
      expect(res.body.jumpstats_statistics).toHaveLength(1);
      expect(res.body.air_stats).toHaveLength(1);
      expect(res.body.bhop_stats).toHaveLength(1);
    });

    it("should accept steamid32 as direct input", async () => {
      const mockPlayer = {
        steamid32: 12345,
        alias: "TestPlayer",
        country: "US",
        cheater: 0,
        last_played: new Date(),
        created: new Date(),
      };

      mockPool.query
        .mockResolvedValueOnce([[mockPlayer]])
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([[]]);

      const res = await request(app).get("/local/gokz/players/12345");

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("TestPlayer");
    });

    it("should return 400 for invalid player identifier", async () => {
      const res = await request(app).get("/local/gokz/players/invalid-id");

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid player identifier");
    });

    it("should return 404 for non-existent player", async () => {
      mockPool.query.mockResolvedValueOnce([[]]);

      const res = await request(app).get(
        "/local/gokz/players/76561198000000000",
      );

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Player not found");
    });
  });

  // Every read endpoint funnels a failed query into the same 500, differing only in the noun.
  describe("database failures", () => {
    it.each([
      ["/local/gokz/maps", "Failed to fetch maps"],
      ["/local/gokz/maps/kz_test", "Failed to fetch map"],
      ["/local/gokz/records", "Failed to fetch records"],
      ["/local/gokz/records/1", "Failed to fetch record"],
      ["/local/gokz/jumpstats", "Failed to fetch jumpstats"],
      ["/local/gokz/jumpstats/1", "Failed to fetch jumpstat"],
      ["/local/gokz/players", "Failed to fetch players"],
      ["/local/gokz/players/76561198000000000", "Failed to fetch player"],
    ])("GET %s 500s with %p", async (path, error) => {
      mockPool.query.mockRejectedValue(new Error("Database error"));

      const res = await request(app).get(path);

      expect(res.status).toBe(500);
      expect(res.body.error).toBe(error);
    });
  });
});
