const request = require("supertest");
const app = require("../src/app");

// Mock the KZ Local database pools
jest.mock("../src/db/kzLocal", () => ({
  getKzLocalCS2Pool: jest.fn(),
  getKzLocalCSGO128Pool: jest.fn(),
  getKzLocalCSGO64Pool: jest.fn(),
  getAllKzLocalPools: jest.fn(() => ({
    cs2: null,
    csgo128: null,
    csgo64: null,
  })),
}));

// Mock the main database pool
jest.mock("../src/db", () => ({
  query: jest.fn(),
}));

// Mock redis
jest.mock("../src/db/redis", () => ({
  isRedisConnected: jest.fn(() => false),
  getCachedData: jest.fn(() => null),
  setCachedData: jest.fn(),
}));

// Mock adminAuth to allow all requests in tests
jest.mock("../src/utils/auth", () => ({
  adminAuth: (req, res, next) => {
    req.adminAuth = { method: "test", ip: "127.0.0.1" };
    req.adminId = "test-admin";
    next();
  },
  optionalAdminAuth: (req, res, next) => {
    req.isAdmin = true;
    req.adminAuth = { method: "test", ip: "127.0.0.1" };
    next();
  },
  apiKeyMiddleware: (req, res, next) => next(),
  shouldSkipRateLimit: () => true,
  getClientIP: () => "127.0.0.1",
  isLocalhost: () => true,
  isWhitelisted: () => false,
  isApiWhitelisted: () => false,
  generateAPIKey: () => "test-api-key",
}));

// Mock fs for filter loading
const mockFilters = {
  version: "1.0.0",
  filters: [
    {
      id: "test_filter_1",
      name: "Test Filter 1",
      description: "Test filter for unit tests",
      game: "cs2",
      jump_type: 0,
      conditions: [{ field: "distance", operator: ">", value: 300 }],
      enabled: true,
    },
    {
      id: "test_filter_2",
      name: "Test Filter 2",
      description: "Another test filter",
      game: "csgo",
      conditions: [
        { field: "distance", operator: ">", value: 280 },
        { field: "strafe_count", operator: "<", value: 5 },
      ],
      enabled: true,
    },
    {
      id: "disabled_filter",
      name: "Disabled Filter",
      game: "all",
      conditions: [{ field: "distance", operator: ">", value: 100 }],
      enabled: false,
    },
  ],
};

jest.mock("fs", () => {
  const originalFs = jest.requireActual("fs");
  return {
    ...originalFs,
    existsSync: jest.fn((path) => {
      if (path.includes("jumpstat-filters.json")) {
        return true;
      }
      return originalFs.existsSync(path);
    }),
    readFileSync: jest.fn((path, encoding) => {
      if (path.includes("jumpstat-filters.json")) {
        return JSON.stringify(mockFilters);
      }
      return originalFs.readFileSync(path, encoding);
    }),
  };
});

const {
  loadFilters,
  buildWhereClause,
  getAvailableFilters,
  CS2_FIELD_MAP,
  CSGO_FIELD_MAP,
  VALID_OPERATORS,
} = require("../src/services/jumpstatCleanup");

describe("Jumpstat Cleanup Service", () => {
  describe("loadFilters", () => {
    it("should load and validate filters from config file", () => {
      const filters = loadFilters();

      expect(filters).toHaveLength(2); // Only enabled filters
      expect(filters[0].id).toBe("test_filter_1");
      expect(filters[1].id).toBe("test_filter_2");
    });

    it("should exclude disabled filters", () => {
      const filters = loadFilters();
      const disabledFilter = filters.find((f) => f.id === "disabled_filter");

      expect(disabledFilter).toBeUndefined();
    });
  });

  describe("buildWhereClause", () => {
    it("should build WHERE clause for simple condition", () => {
      const filter = {
        conditions: [{ field: "distance", operator: ">", value: 300 }],
      };

      const result = buildWhereClause(filter, CS2_FIELD_MAP);

      expect(result.whereClause).toBe("Distance > ?");
      // Distance is scaled by 10000 (300 * 10000 = 3000000)
      expect(result.params).toEqual([3000000]);
    });

    it("should build WHERE clause with jump_type", () => {
      const filter = {
        jump_type: 1,
        conditions: [{ field: "distance", operator: ">", value: 350 }],
      };

      const result = buildWhereClause(filter, CS2_FIELD_MAP);

      expect(result.whereClause).toBe("JumpType = ? AND Distance > ?");
      // Distance is scaled by 10000 (350 * 10000 = 3500000)
      expect(result.params).toEqual([1, 3500000]);
    });

    it("should build WHERE clause with multiple conditions", () => {
      const filter = {
        conditions: [
          { field: "distance", operator: ">", value: 250 },
          { field: "strafes", operator: "<", value: 10 },
          { field: "sync", operator: "=", value: 100 },
        ],
      };

      const result = buildWhereClause(filter, CS2_FIELD_MAP);

      expect(result.whereClause).toBe(
        "Distance > ? AND Strafes < ? AND Sync = ?",
      );
      // Distance scaled by 10000, sync scaled by 100
      expect(result.params).toEqual([2500000, 10, 10000]);
    });

    it("should handle IS NULL operator", () => {
      const filter = {
        conditions: [{ field: "steamid64", operator: "IS NULL" }],
      };

      const result = buildWhereClause(filter, CSGO_FIELD_MAP);

      expect(result.whereClause).toBe("steamid64 IS NULL");
      expect(result.params).toEqual([]);
    });

    it("should handle IS NOT NULL operator", () => {
      const filter = {
        conditions: [{ field: "steamid64", operator: "IS NOT NULL" }],
      };

      const result = buildWhereClause(filter, CSGO_FIELD_MAP);

      expect(result.whereClause).toBe("steamid64 IS NOT NULL");
      expect(result.params).toEqual([]);
    });

    it("should handle IN operator", () => {
      const filter = {
        conditions: [{ field: "jump_type", operator: "IN", value: [0, 1, 2] }],
      };

      const result = buildWhereClause(filter, CSGO_FIELD_MAP);

      // CSGO uses PascalCase columns
      expect(result.whereClause).toBe("JumpType IN (?, ?, ?)");
      expect(result.params).toEqual([0, 1, 2]);
    });

    it("should handle NOT IN operator", () => {
      const filter = {
        conditions: [
          { field: "jump_type", operator: "NOT IN", value: [4, 5, 6] },
        ],
      };

      const result = buildWhereClause(filter, CS2_FIELD_MAP);

      expect(result.whereClause).toBe("JumpType NOT IN (?, ?, ?)");
      expect(result.params).toEqual([4, 5, 6]);
    });

    it("should handle LIKE operator", () => {
      const filter = {
        conditions: [
          { field: "player_name", operator: "LIKE", value: "%cheater%" },
        ],
      };

      const result = buildWhereClause(filter, CSGO_FIELD_MAP);

      expect(result.whereClause).toBe("player_name LIKE ?");
      expect(result.params).toEqual(["%cheater%"]);
    });

    it("should handle <= and >= operators", () => {
      const filter = {
        conditions: [
          { field: "distance", operator: ">=", value: 100 },
          { field: "distance", operator: "<=", value: 200 },
        ],
      };

      const result = buildWhereClause(filter, CS2_FIELD_MAP);

      expect(result.whereClause).toBe("Distance >= ? AND Distance <= ?");
      // Distance scaled by 10000
      expect(result.params).toEqual([1000000, 2000000]);
    });

    it("should handle != operator", () => {
      const filter = {
        conditions: [{ field: "jump_type", operator: "!=", value: 0 }],
      };

      const result = buildWhereClause(filter, CS2_FIELD_MAP);

      expect(result.whereClause).toBe("JumpType != ?");
      expect(result.params).toEqual([0]);
    });

    it("should return 1=1 for empty conditions", () => {
      const filter = { conditions: [] };

      const result = buildWhereClause(filter, CS2_FIELD_MAP);

      expect(result.whereClause).toBe("1=1");
      expect(result.params).toEqual([]);
    });

    it("should use field name directly if not in map", () => {
      const filter = {
        conditions: [{ field: "custom_field", operator: ">", value: 50 }],
      };

      const result = buildWhereClause(filter, CS2_FIELD_MAP);

      expect(result.whereClause).toBe("custom_field > ?");
      expect(result.params).toEqual([50]);
    });

    it("should build WHERE clause with tickrate filter for CSGO", () => {
      // Note: CSGO Jumpstats table does NOT have a tickrate column
      // Tickrate filtering is done by selecting the correct database pool
      // (csgo128 vs csgo64), not by a WHERE clause
      const filter = {
        jump_type: 1,
        tickrate: 128, // This is ignored in WHERE clause - handled by pool selection
        conditions: [{ field: "distance", operator: ">", value: 290 }],
      };

      const result = buildWhereClause(filter, CSGO_FIELD_MAP);

      // CSGO uses PascalCase columns, and tickrate is NOT in the WHERE clause
      expect(result.whereClause).toBe("JumpType = ? AND Distance > ?");
      // Distance scaled by 10000
      expect(result.params).toEqual([1, 2900000]);
    });

    it("should not add tickrate filter for CS2 (no tickrate field)", () => {
      const filter = {
        jump_type: 0,
        tickrate: 64, // This should be ignored for CS2
        conditions: [{ field: "distance", operator: ">", value: 295 }],
      };

      // CS2 field map doesn't have tickrate, so it should be skipped
      const result = buildWhereClause(filter, CS2_FIELD_MAP);

      expect(result.whereClause).toBe("JumpType = ? AND Distance > ?");
      // Distance scaled by 10000
      expect(result.params).toEqual([0, 2950000]);
    });

    it("should build WHERE clause with mode filter", () => {
      const filter = {
        jump_type: 0, // longjump
        mode: 1, // simplekz
        conditions: [{ field: "distance", operator: ">", value: 302 }],
      };

      const result = buildWhereClause(filter, CSGO_FIELD_MAP);

      // CSGO uses PascalCase columns, and mode filter should be applied
      expect(result.whereClause).toBe(
        "JumpType = ? AND Mode = ? AND Distance > ?",
      );
      // Distance scaled by 10000
      expect(result.params).toEqual([0, 1, 3020000]);
    });
  });

  describe("getAvailableFilters", () => {
    it("should return list of available filters", () => {
      const filters = getAvailableFilters();

      expect(filters).toHaveLength(2);
      expect(filters[0]).toHaveProperty("id");
      expect(filters[0]).toHaveProperty("name");
      expect(filters[0]).toHaveProperty("description");
      expect(filters[0]).toHaveProperty("game");
      expect(filters[0]).toHaveProperty("conditions");
      expect(filters[0]).toHaveProperty("enabled");
    });
  });

  describe("Field Maps", () => {
    it("should have CS2 field mappings", () => {
      expect(CS2_FIELD_MAP).toHaveProperty("distance", "Distance");
      expect(CS2_FIELD_MAP).toHaveProperty("steamid64", "SteamID64");
      expect(CS2_FIELD_MAP).toHaveProperty("jump_type", "JumpType");
      expect(CS2_FIELD_MAP).toHaveProperty("strafes", "Strafes");
      expect(CS2_FIELD_MAP).toHaveProperty("sync", "Sync");
    });

    it("should have CSGO field mappings", () => {
      // CSGO uses PascalCase columns and SteamID32 instead of SteamID64
      expect(CSGO_FIELD_MAP).toHaveProperty("distance", "Distance");
      expect(CSGO_FIELD_MAP).toHaveProperty("steamid32", "SteamID32");
      expect(CSGO_FIELD_MAP).toHaveProperty("jump_type", "JumpType");
      expect(CSGO_FIELD_MAP).toHaveProperty("strafes", "Strafes");
    });
  });

  describe("Valid Operators", () => {
    it("should include all supported operators", () => {
      expect(VALID_OPERATORS).toContain(">");
      expect(VALID_OPERATORS).toContain("<");
      expect(VALID_OPERATORS).toContain(">=");
      expect(VALID_OPERATORS).toContain("<=");
      expect(VALID_OPERATORS).toContain("=");
      expect(VALID_OPERATORS).toContain("!=");
      expect(VALID_OPERATORS).toContain("LIKE");
      expect(VALID_OPERATORS).toContain("NOT LIKE");
      expect(VALID_OPERATORS).toContain("IN");
      expect(VALID_OPERATORS).toContain("NOT IN");
      expect(VALID_OPERATORS).toContain("IS NULL");
      expect(VALID_OPERATORS).toContain("IS NOT NULL");
    });
  });
});

describe("Jumpstat Cleanup Admin Endpoints", () => {
  describe("GET /admin/jumpstat-filters", () => {
    it("should return list of available filters", async () => {
      const response = await request(app)
        .get("/admin/jumpstat-filters")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body).toHaveProperty("filters");
      expect(Array.isArray(response.body.filters)).toBe(true);
      expect(response.body).toHaveProperty("total");
    });
  });

  describe("POST /admin/cleanup-jumpstats", () => {
    it("should run cleanup in dry run mode by default", async () => {
      const response = await request(app)
        .post("/admin/cleanup-jumpstats")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("dry_run", true);
      expect(response.body).toHaveProperty("summary");
      expect(response.body).toHaveProperty("results");
    });

    it("should accept game filter parameter", async () => {
      const response = await request(app)
        .post("/admin/cleanup-jumpstats")
        .query({ game: "cs2", dryRun: "true" })
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("dry_run", true);
    });

    it("should accept filterId parameter", async () => {
      const response = await request(app)
        .post("/admin/cleanup-jumpstats")
        .query({ filterId: "test_filter_1", dryRun: "true" })
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toBeDefined();
    });
  });

  describe("GET /admin/quarantined-jumpstats", () => {
    const { getKzLocalCS2Pool } = require("../src/db/kzLocal");

    beforeEach(() => {
      const mockPool = {
        query: jest.fn().mockResolvedValue([
          [
            {
              id: "test-id-1",
              steamid64: "76561198000000001",
              jump_type: 0,
              distance: 310.5,
              filter_id: "test_filter_1",
              filter_name: "Test Filter 1",
              quarantined_at: new Date(),
            },
          ],
          [],
        ]),
      };
      // Set up count query response
      mockPool.query
        .mockResolvedValueOnce([[{ total: 1 }], []])
        .mockResolvedValueOnce([
          [
            {
              id: "test-id-1",
              steamid64: "76561198000000001",
              jump_type: 0,
              distance: 310.5,
              filter_id: "test_filter_1",
              filter_name: "Test Filter 1",
              quarantined_at: new Date(),
            },
          ],
          [],
        ]);

      getKzLocalCS2Pool.mockReturnValue(mockPool);
    });

    it("should return quarantined jumpstats with pagination", async () => {
      const response = await request(app)
        .get("/admin/quarantined-jumpstats")
        .query({ game: "cs2", page: 1, limit: 50 })
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body).toHaveProperty("game", "cs2");
      expect(response.body).toHaveProperty("data");
      expect(response.body).toHaveProperty("pagination");
    });

    it("should accept filter parameters", async () => {
      const response = await request(app)
        .get("/admin/quarantined-jumpstats")
        .query({
          game: "cs2",
          filterId: "test_filter_1",
          steamid64: "76561198000000001",
        })
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
    });
  });

  describe("POST /admin/restore-jumpstat/:id", () => {
    const { getKzLocalCS2Pool } = require("../src/db/kzLocal");

    it("should return 400 if no id provided", async () => {
      // Note: Express will not match the route without an id parameter
      // This test verifies the route requires an id
      const response = await request(app)
        .post("/admin/restore-jumpstat/")
        .expect(404); // Will be 404 because route doesn't match

      expect(response.status).toBe(404);
    });

    it("should attempt to restore a quarantined jumpstat", async () => {
      const mockConnection = {
        beginTransaction: jest.fn().mockResolvedValue(),
        query: jest
          .fn()
          .mockResolvedValueOnce([{ affectedRows: 1 }, []])
          .mockResolvedValueOnce([{ affectedRows: 1 }, []]),
        commit: jest.fn().mockResolvedValue(),
        rollback: jest.fn().mockResolvedValue(),
        release: jest.fn(),
      };

      const mockPool = {
        getConnection: jest.fn().mockResolvedValue(mockConnection),
      };

      getKzLocalCS2Pool.mockReturnValue(mockPool);

      const response = await request(app)
        .post("/admin/restore-jumpstat/test-id-123")
        .query({ game: "cs2" })
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body).toHaveProperty("id", "test-id-123");
      expect(response.body).toHaveProperty("game", "cs2");
    });

    it("should return 404 if record not found", async () => {
      const mockConnection = {
        beginTransaction: jest.fn().mockResolvedValue(),
        query: jest.fn().mockResolvedValueOnce([{ affectedRows: 0 }, []]),
        commit: jest.fn().mockResolvedValue(),
        rollback: jest.fn().mockResolvedValue(),
        release: jest.fn(),
      };

      const mockPool = {
        getConnection: jest.fn().mockResolvedValue(mockConnection),
      };

      getKzLocalCS2Pool.mockReturnValue(mockPool);

      const response = await request(app)
        .post("/admin/restore-jumpstat/nonexistent-id")
        .query({ game: "cs2" })
        .expect("Content-Type", /json/)
        .expect(404);

      expect(response.body).toHaveProperty("success", false);
      expect(response.body).toHaveProperty("error");
    });
  });
});
