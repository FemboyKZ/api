const request = require("supertest");
const express = require("express");

// Mock the dependencies before requiring the router
jest.mock("../src/db/kzLocal", () => ({
  getKzLocalCS2Pool: jest.fn(),
}));

jest.mock("../src/utils/logger", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

jest.mock("../src/utils/cacheMiddleware", () => ({
  cacheMiddleware: () => (req, res, next) => next(),
  kzKeyGenerator: jest.fn(),
}));

const { getKzLocalCS2Pool } = require("../src/db/kzLocal");
const kzLocalCS2Router = require("../src/api/kzLocalCS2");

const app = express();
app.use(express.json());
app.use("/kzlocal-cs2", kzLocalCS2Router);

describe("KZ Local CS2 Endpoints", () => {
  let mockPool;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPool = {
      query: jest.fn(),
    };
    getKzLocalCS2Pool.mockReturnValue(mockPool);
  });

  // ==================== PLAYERS ENDPOINTS ====================
  describe("GET /kzlocal-cs2/players", () => {
    it("should return paginated list of players", async () => {
      const mockPlayers = [
        {
          steamid64: BigInt("76561198000000000"),
          name: "TestPlayer",
          is_cheater: 0,
          last_played: new Date(),
          created: new Date(),
          records_count: 50,
        },
      ];

      mockPool.query
        .mockResolvedValueOnce([mockPlayers])
        .mockResolvedValueOnce([[{ total: 1 }]]);

      const res = await request(app).get("/kzlocal-cs2/players");

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

      const res = await request(app).get("/kzlocal-cs2/players?name=Test");

      expect(res.status).toBe(200);
      const firstCallParams = mockPool.query.mock.calls[0][1];
      expect(firstCallParams).toContain("%Test%");
    });

    it("should sort by different fields", async () => {
      mockPool.query
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([[{ total: 0 }]]);

      const res = await request(app).get(
        "/kzlocal-cs2/players?sort=name&order=asc",
      );

      expect(res.status).toBe(200);
      const firstCallQuery = mockPool.query.mock.calls[0][0];
      expect(firstCallQuery).toContain("ORDER BY p.Alias ASC");
    });

    it("should handle database errors", async () => {
      mockPool.query.mockRejectedValue(new Error("Database error"));

      const res = await request(app).get("/kzlocal-cs2/players");

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Failed to fetch players");
    });
  });

  describe("GET /kzlocal-cs2/players/:steamid", () => {
    it("should return player profile with statistics", async () => {
      const mockPlayer = {
        steamid64: BigInt("76561198000000000"),
        name: "TestPlayer",
        is_cheater: 0,
        last_played: new Date(),
        created: new Date(),
      };
      const mockModeStats = [
        {
          mode_id: 1,
          mode_name: "Classic",
          mode_short: "CL",
          records_count: 30,
          best_time: 45.5,
        },
      ];
      const mockMapsCompleted = { maps_completed: 25 };
      const mockRecentRecords = [
        {
          id: 1,
          run_time: 45.5,
          teleports: 0,
          created: new Date(),
          map_name: "kz_test",
          course_name: "Main",
          mode_name: "Classic",
          mode_short: "CL",
        },
      ];

      mockPool.query
        .mockResolvedValueOnce([[mockPlayer]])
        .mockResolvedValueOnce([mockModeStats])
        .mockResolvedValueOnce([[mockMapsCompleted]])
        .mockResolvedValueOnce([mockRecentRecords]);

      const res = await request(app).get(
        "/kzlocal-cs2/players/76561198000000000",
      );

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("TestPlayer");
      expect(res.body.mode_statistics).toHaveLength(1);
      expect(res.body.recent_records).toHaveLength(1);
    });

    it("should return 404 for invalid SteamID format", async () => {
      // When SteamID is invalid format, it's passed directly to DB query which returns no results
      mockPool.query.mockResolvedValueOnce([[]]); // No player found

      const res = await request(app).get("/kzlocal-cs2/players/invalid");

      // Current behavior: invalid format is passed to DB, no player found -> 404
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Player not found");
    });

    it("should return 404 for non-existent player", async () => {
      mockPool.query.mockResolvedValueOnce([[]]);

      const res = await request(app).get(
        "/kzlocal-cs2/players/76561198000000000",
      );

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Player not found");
    });

    it("should handle database errors", async () => {
      mockPool.query.mockRejectedValue(new Error("Database error"));

      const res = await request(app).get(
        "/kzlocal-cs2/players/76561198000000000",
      );

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Failed to fetch player");
    });
  });

  // ==================== MAPS ENDPOINTS ====================
  describe("GET /kzlocal-cs2/maps", () => {
    it("should return paginated list of maps", async () => {
      const mockMaps = [
        {
          id: 1,
          name: "kz_test",
          last_played: new Date(),
          created: new Date(),
          courses_count: 2,
          records_count: 100,
        },
      ];

      mockPool.query
        .mockResolvedValueOnce([mockMaps])
        .mockResolvedValueOnce([[{ total: 1 }]]);

      const res = await request(app).get("/kzlocal-cs2/maps");

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe("kz_test");
      expect(res.body.pagination).toBeDefined();
    });

    it("should filter by map name", async () => {
      mockPool.query
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([[{ total: 0 }]]);

      const res = await request(app).get("/kzlocal-cs2/maps?name=example");

      expect(res.status).toBe(200);
      const firstCallParams = mockPool.query.mock.calls[0][1];
      expect(firstCallParams).toContain("%example%");
    });

    it("should handle sorting", async () => {
      mockPool.query
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([[{ total: 0 }]]);

      const res = await request(app).get(
        "/kzlocal-cs2/maps?sort=records&order=desc",
      );

      expect(res.status).toBe(200);
      const firstCallQuery = mockPool.query.mock.calls[0][0];
      expect(firstCallQuery).toContain("ORDER BY records_count DESC");
    });

    it("should handle database errors", async () => {
      mockPool.query.mockRejectedValue(new Error("Database error"));

      const res = await request(app).get("/kzlocal-cs2/maps");

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Failed to fetch maps");
    });
  });

  describe("GET /kzlocal-cs2/maps/:mapname", () => {
    it("should return map details with courses and statistics", async () => {
      const mockMap = {
        id: 1,
        name: "kz_test",
        last_played: new Date(),
        created: new Date(),
      };
      const mockCourses = [
        {
          id: 1,
          name: "Main",
          stage_id: 0,
          created: new Date(),
          records_count: 50,
        },
      ];
      const mockModeStats = [
        {
          mode_id: 1,
          mode_name: "Classic",
          mode_short: "CL",
          records_count: 30,
          best_time: 45.5,
          unique_players: 20,
        },
      ];
      const mockWorldRecords = [
        {
          course_name: "Main",
          mode_name: "Classic",
          mode_short: "CL",
          time: 45.5,
          player_name: "TestPlayer",
          steamid64: BigInt("76561198000000000"),
          teleports: 0,
        },
      ];

      mockPool.query
        .mockResolvedValueOnce([[mockMap]])
        .mockResolvedValueOnce([mockCourses])
        .mockResolvedValueOnce([mockModeStats])
        .mockResolvedValueOnce([mockWorldRecords]);

      const res = await request(app).get("/kzlocal-cs2/maps/kz_test");

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("kz_test");
      expect(res.body.courses).toHaveLength(1);
      expect(res.body.mode_statistics).toHaveLength(1);
      expect(res.body.world_records).toHaveLength(1);
    });

    it("should return 404 for non-existent map", async () => {
      mockPool.query.mockResolvedValueOnce([[]]);

      const res = await request(app).get("/kzlocal-cs2/maps/nonexistent");

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Map not found");
    });

    it("should handle database errors", async () => {
      mockPool.query.mockRejectedValue(new Error("Database error"));

      const res = await request(app).get("/kzlocal-cs2/maps/kz_test");

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Failed to fetch map");
    });
  });

  // ==================== RECORDS ENDPOINTS ====================
  describe("GET /kzlocal-cs2/records", () => {
    it("should return paginated list of records", async () => {
      const mockRecords = [
        {
          id: 1,
          steamid64: BigInt("76561198000000000"),
          player_name: "TestPlayer",
          map_name: "kz_test",
          map_id: 1,
          course_name: "Main",
          stage_id: 0,
          mode_id: 1,
          mode_name: "Classic",
          mode_short: "CL",
          style_flags: 0,
          run_time: 45.5,
          teleports: 0,
          created: new Date(),
        },
      ];

      mockPool.query
        .mockResolvedValueOnce([mockRecords])
        .mockResolvedValueOnce([[{ total: 1 }]]);

      const res = await request(app).get("/kzlocal-cs2/records");

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].player_name).toBe("TestPlayer");
      expect(res.body.pagination).toBeDefined();
    });

    it("should filter by map name", async () => {
      mockPool.query
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([[{ total: 0 }]]);

      const res = await request(app).get("/kzlocal-cs2/records?map=kz_test");

      expect(res.status).toBe(200);
    });

    it("should filter by player SteamID", async () => {
      mockPool.query
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([[{ total: 0 }]]);

      const res = await request(app).get(
        "/kzlocal-cs2/records?player=76561198000000000",
      );

      expect(res.status).toBe(200);
    });

    it("should filter by player name", async () => {
      mockPool.query
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([[{ total: 0 }]]);

      const res = await request(app).get(
        "/kzlocal-cs2/records?player=TestPlayer",
      );

      expect(res.status).toBe(200);
      const firstCallParams = mockPool.query.mock.calls[0][1];
      expect(firstCallParams).toContain("%TestPlayer%");
    });

    it("should filter pro runs", async () => {
      mockPool.query
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([[{ total: 0 }]]);

      const res = await request(app).get("/kzlocal-cs2/records?teleports=pro");

      expect(res.status).toBe(200);
      const firstCallQuery = mockPool.query.mock.calls[0][0];
      expect(firstCallQuery).toContain("t.Teleports = 0");
    });

    it("should filter tp runs", async () => {
      mockPool.query
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([[{ total: 0 }]]);

      const res = await request(app).get("/kzlocal-cs2/records?teleports=tp");

      expect(res.status).toBe(200);
      const firstCallQuery = mockPool.query.mock.calls[0][0];
      expect(firstCallQuery).toContain("t.Teleports > 0");
    });

    it("should handle database errors", async () => {
      mockPool.query.mockRejectedValue(new Error("Database error"));

      const res = await request(app).get("/kzlocal-cs2/records");

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Failed to fetch records");
    });
  });

  describe("GET /kzlocal-cs2/records/:id", () => {
    it("should return record details", async () => {
      const mockRecord = {
        id: "test-uuid",
        steamid64: BigInt("76561198000000000"),
        player_name: "TestPlayer",
        is_cheater: 0,
        map_id: 1,
        map_name: "kz_test",
        course_id: 1,
        course_name: "Main",
        stage_id: 0,
        mode_id: 1,
        mode_name: "Classic",
        mode_short: "CL",
        style_flags: 0,
        run_time: 45.5,
        teleports: 0,
        metadata: null,
        created: new Date(),
      };

      // Mock the first query for record details
      mockPool.query.mockResolvedValueOnce([[mockRecord]]);
      // Mock the second query for rank calculation
      mockPool.query.mockResolvedValueOnce([[{ rank: 1 }]]);

      const res = await request(app).get("/kzlocal-cs2/records/test-uuid");

      expect(res.status).toBe(200);
      expect(res.body.id).toBe("test-uuid");
      expect(res.body.player_name).toBe("TestPlayer");
      expect(res.body.rank).toBe(1);
    });

    it("should return 404 for non-existent record", async () => {
      mockPool.query.mockResolvedValueOnce([[]]);

      const res = await request(app).get("/kzlocal-cs2/records/nonexistent");

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Record not found");
    });

    it("should handle database errors", async () => {
      mockPool.query.mockRejectedValue(new Error("Database error"));

      const res = await request(app).get("/kzlocal-cs2/records/test-uuid");

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Failed to fetch record");
    });
  });

  describe("GET /kzlocal-cs2/records/top/:mapname", () => {
    it("should return top records for a map", async () => {
      const mockMap = { ID: 1 };
      const mockRecords = [
        {
          id: "test-uuid",
          steamid64: BigInt("76561198000000000"),
          player_name: "TestPlayer",
          course_name: "Main",
          mode_id: 1,
          mode_name: "Classic",
          mode_short: "CL",
          run_time: 45.5,
          teleports: 0,
          created: new Date(),
        },
      ];

      mockPool.query
        .mockResolvedValueOnce([[mockMap]])
        .mockResolvedValueOnce([mockRecords]);

      const res = await request(app).get("/kzlocal-cs2/records/top/kz_test");

      expect(res.status).toBe(200);
      expect(res.body.map_name).toBe("kz_test");
      expect(res.body.records).toHaveLength(1);
      expect(res.body.records[0].rank).toBe(1);
    });

    it("should return 404 for non-existent map", async () => {
      mockPool.query.mockResolvedValueOnce([[]]);

      const res = await request(app).get(
        "/kzlocal-cs2/records/top/nonexistent",
      );

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Map not found");
    });

    it("should filter by mode", async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ ID: 1 }]])
        .mockResolvedValueOnce([[]]);

      const res = await request(app).get(
        "/kzlocal-cs2/records/top/kz_test?mode=1",
      );

      expect(res.status).toBe(200);
    });

    it("should handle database errors", async () => {
      mockPool.query.mockRejectedValue(new Error("Database error"));

      const res = await request(app).get("/kzlocal-cs2/records/top/kz_test");

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Failed to fetch top records");
    });
  });

  // ==================== JUMPSTATS ENDPOINTS ====================
  describe("GET /kzlocal-cs2/jumpstats", () => {
    it("should return paginated list of jumpstats", async () => {
      const mockJumpstats = [
        {
          id: 1,
          steamid64: BigInt("76561198000000000"),
          player_name: "TestPlayer",
          jump_type: 0,
          mode_id: 1,
          mode_name: "Classic",
          mode_short: "CL",
          distance: 256.5,
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

      const res = await request(app).get("/kzlocal-cs2/jumpstats");

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].jump_type).toBe("longjump");
      expect(res.body.pagination).toBeDefined();
    });

    it("should filter by jump type", async () => {
      mockPool.query
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([[{ total: 0 }]]);

      const res = await request(app).get("/kzlocal-cs2/jumpstats?jump_type=0");

      expect(res.status).toBe(200);
    });

    it("should filter by block jumps", async () => {
      mockPool.query
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([[{ total: 0 }]]);

      const res = await request(app).get("/kzlocal-cs2/jumpstats?block=true");

      expect(res.status).toBe(200);
      const firstCallQuery = mockPool.query.mock.calls[0][0];
      expect(firstCallQuery).toContain("j.IsBlockJump = 1");
    });

    it("should handle database errors", async () => {
      mockPool.query.mockRejectedValue(new Error("Database error"));

      const res = await request(app).get("/kzlocal-cs2/jumpstats");

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Failed to fetch jumpstats");
    });
  });

  describe("GET /kzlocal-cs2/jumpstats/top", () => {
    it("should return top jumpstats", async () => {
      const mockJumpstats = [
        {
          id: 1,
          steamid64: BigInt("76561198000000000"),
          player_name: "TestPlayer",
          is_cheater: 0,
          jump_type: 0,
          mode_id: 1,
          mode_name: "Classic",
          mode_short: "CL",
          distance: 256.5,
          is_block: 1,
          block: 256,
          strafes: 8,
          sync: 85.5,
          pre: 280.0,
          max: 290.0,
          airtime: 0.65,
          created: new Date(),
        },
      ];

      mockPool.query.mockResolvedValueOnce([mockJumpstats]);

      const res = await request(app).get("/kzlocal-cs2/jumpstats/top");

      expect(res.status).toBe(200);
      expect(res.body.records).toHaveLength(1);
      expect(res.body.records[0].rank).toBe(1);
    });

    it("should filter by jump type and mode", async () => {
      mockPool.query.mockResolvedValueOnce([[]]);

      const res = await request(app).get(
        "/kzlocal-cs2/jumpstats/top?jump_type=1&mode=1",
      );

      expect(res.status).toBe(200);
    });

    it("should handle database errors", async () => {
      mockPool.query.mockRejectedValue(new Error("Database error"));

      const res = await request(app).get("/kzlocal-cs2/jumpstats/top");

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Failed to fetch top jumpstats");
    });
  });

  // ==================== MODES/STYLES/COURSES/STATS ENDPOINTS ====================
  describe("GET /kzlocal-cs2/modes", () => {
    it("should return list of modes", async () => {
      const mockModes = [
        { id: 1, name: "Classic", short_name: "CL" },
        { id: 2, name: "Vanilla", short_name: "VN" },
      ];

      mockPool.query.mockResolvedValueOnce([mockModes]);

      const res = await request(app).get("/kzlocal-cs2/modes");

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
    });

    it("should handle database errors", async () => {
      mockPool.query.mockRejectedValue(new Error("Database error"));

      const res = await request(app).get("/kzlocal-cs2/modes");

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Failed to fetch modes");
    });
  });

  describe("GET /kzlocal-cs2/styles", () => {
    it("should return list of styles", async () => {
      const mockStyles = [
        { id: 1, name: "Normal", short_name: "NM" },
        { id: 2, name: "Low Gravity", short_name: "LG" },
      ];

      mockPool.query.mockResolvedValueOnce([mockStyles]);

      const res = await request(app).get("/kzlocal-cs2/styles");

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
    });

    it("should handle database errors", async () => {
      mockPool.query.mockRejectedValue(new Error("Database error"));

      const res = await request(app).get("/kzlocal-cs2/styles");

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Failed to fetch styles");
    });
  });

  describe("GET /kzlocal-cs2/courses", () => {
    it("should return paginated list of courses", async () => {
      const mockCourses = [
        {
          id: 1,
          name: "Main",
          stage_id: 0,
          map_id: 1,
          map_name: "kz_test",
          created: new Date(),
          records_count: 50,
        },
      ];

      mockPool.query
        .mockResolvedValueOnce([mockCourses])
        .mockResolvedValueOnce([[{ total: 1 }]]);

      const res = await request(app).get("/kzlocal-cs2/courses");

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe("Main");
      expect(res.body.pagination).toBeDefined();
    });

    it("should filter by map name", async () => {
      mockPool.query
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([[{ total: 0 }]]);

      const res = await request(app).get("/kzlocal-cs2/courses?map=kz_test");

      expect(res.status).toBe(200);
      const firstCallParams = mockPool.query.mock.calls[0][1];
      expect(firstCallParams).toContain("%kz_test%");
    });

    it("should handle database errors", async () => {
      mockPool.query.mockRejectedValue(new Error("Database error"));

      const res = await request(app).get("/kzlocal-cs2/courses");

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Failed to fetch courses");
    });
  });

  describe("GET /kzlocal-cs2/stats", () => {
    it("should return server statistics", async () => {
      const mockStats = {
        total_players: 1000,
        total_maps: 50,
        total_courses: 75,
        total_records: 50000,
        total_jumpstats: 10000,
        total_modes: 2,
        total_styles: 3,
      };
      const mockRecentStats = {
        records_24h: 100,
        records_7d: 500,
        active_players_24h: 50,
        active_players_7d: 200,
      };

      mockPool.query
        .mockResolvedValueOnce([[mockStats]])
        .mockResolvedValueOnce([[mockRecentStats]]);

      const res = await request(app).get("/kzlocal-cs2/stats");

      expect(res.status).toBe(200);
      expect(res.body.total_players).toBe(1000);
      expect(res.body.total_maps).toBe(50);
      expect(res.body.recent_activity).toBeDefined();
      expect(res.body.recent_activity.records_24h).toBe(100);
    });

    it("should handle database errors", async () => {
      mockPool.query.mockRejectedValue(new Error("Database error"));

      const res = await request(app).get("/kzlocal-cs2/stats");

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Failed to fetch stats");
    });
  });
});
