const request = require("supertest");
const app = require("../../../src/app");

// Mock the KZ Local database pools
jest.mock("../../../src/db/kzLocal", () => ({
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
jest.mock("../../../src/db", () => ({
  query: jest.fn(),
}));

// Mock redis
jest.mock("../../../src/db/redis", () => ({
  isRedisConnected: jest.fn(() => false),
  getCachedData: jest.fn(() => null),
  setCachedData: jest.fn(),
}));

// Mock adminAuth to allow all requests in tests
jest.mock("../../../src/utils/auth", () => ({
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
} = require("../../../src/services/kz/jumpstatCleanup");

describe("Jumpstat Cleanup Service", () => {
  describe("loadFilters", () => {
    it("loads only the enabled filters from the config file", () => {
      const filters = loadFilters();

      expect(filters).toHaveLength(2);
      expect(filters.map((f) => f.id)).toEqual([
        "test_filter_1",
        "test_filter_2",
      ]);
    });
  });

  describe("buildWhereClause", () => {
    // distance is scaled by 10000 and sync by 100 on the way into the query.
    it.each([
      [
        "a simple condition",
        { conditions: [{ field: "distance", operator: ">", value: 300 }] },
        CS2_FIELD_MAP,
        "Distance > ?",
        [3000000],
      ],
      [
        "jump_type ahead of the conditions",
        {
          jump_type: 1,
          conditions: [{ field: "distance", operator: ">", value: 350 }],
        },
        CS2_FIELD_MAP,
        "JumpType = ? AND Distance > ?",
        [1, 3500000],
      ],
      [
        "several conditions ANDed in order",
        {
          conditions: [
            { field: "distance", operator: ">", value: 250 },
            { field: "strafes", operator: "<", value: 10 },
            { field: "sync", operator: "=", value: 100 },
          ],
        },
        CS2_FIELD_MAP,
        "Distance > ? AND Strafes < ? AND Sync = ?",
        [2500000, 10, 10000],
      ],
      [
        "IS NULL, which takes no parameter",
        { conditions: [{ field: "steamid64", operator: "IS NULL" }] },
        CSGO_FIELD_MAP,
        "steamid64 IS NULL",
        [],
      ],
      [
        "IS NOT NULL, which takes no parameter",
        { conditions: [{ field: "steamid64", operator: "IS NOT NULL" }] },
        CSGO_FIELD_MAP,
        "steamid64 IS NOT NULL",
        [],
      ],
      [
        "IN, one placeholder per value",
        {
          conditions: [
            { field: "jump_type", operator: "IN", value: [0, 1, 2] },
          ],
        },
        CSGO_FIELD_MAP,
        "JumpType IN (?, ?, ?)",
        [0, 1, 2],
      ],
      [
        "NOT IN, one placeholder per value",
        {
          conditions: [
            { field: "jump_type", operator: "NOT IN", value: [4, 5, 6] },
          ],
        },
        CS2_FIELD_MAP,
        "JumpType NOT IN (?, ?, ?)",
        [4, 5, 6],
      ],
      [
        "LIKE",
        {
          conditions: [
            { field: "player_name", operator: "LIKE", value: "%cheater%" },
          ],
        },
        CSGO_FIELD_MAP,
        "player_name LIKE ?",
        ["%cheater%"],
      ],
      [
        ">= and <=",
        {
          conditions: [
            { field: "distance", operator: ">=", value: 100 },
            { field: "distance", operator: "<=", value: 200 },
          ],
        },
        CS2_FIELD_MAP,
        "Distance >= ? AND Distance <= ?",
        [1000000, 2000000],
      ],
      [
        "!=",
        { conditions: [{ field: "jump_type", operator: "!=", value: 0 }] },
        CS2_FIELD_MAP,
        "JumpType != ?",
        [0],
      ],
      ["no conditions at all", { conditions: [] }, CS2_FIELD_MAP, "1=1", []],
      [
        "a field that is not in the map, passed through as written",
        { conditions: [{ field: "custom_field", operator: ">", value: 50 }] },
        CS2_FIELD_MAP,
        "custom_field > ?",
        [50],
      ],
      [
        "mode, which only CSGO carries",
        {
          jump_type: 0,
          mode: 1,
          conditions: [{ field: "distance", operator: ">", value: 302 }],
        },
        CSGO_FIELD_MAP,
        "JumpType = ? AND Mode = ? AND Distance > ?",
        [0, 1, 3020000],
      ],
    ])("builds a clause for %s", (_name, filter, fieldMap, clause, params) => {
      const result = buildWhereClause(filter, fieldMap);

      expect(result.whereClause).toBe(clause);
      expect(result.params).toEqual(params);
    });

    // Neither table has a tickrate column: CSGO picks it by pool (csgo128 vs csgo64), CS2 has no such thing.
    it.each([
      ["CSGO", CSGO_FIELD_MAP, 128],
      ["CS2", CS2_FIELD_MAP, 64],
    ])("drops the tickrate filter for %s", (_game, fieldMap, tickrate) => {
      const result = buildWhereClause(
        {
          jump_type: 1,
          tickrate,
          conditions: [{ field: "distance", operator: ">", value: 290 }],
        },
        fieldMap,
      );

      expect(result.whereClause).toBe("JumpType = ? AND Distance > ?");
      expect(result.params).toEqual([1, 2900000]);
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
    // Dry run is the default, and stays the default whichever way the run is narrowed.
    it.each([
      ["no parameters", {}],
      ["a game", { game: "cs2", dryRun: "true" }],
      ["a single filter", { filterId: "test_filter_1", dryRun: "true" }],
    ])("runs in dry run mode given %s", async (_name, query) => {
      const response = await request(app)
        .post("/admin/cleanup-jumpstats")
        .query(query)
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("dry_run", true);
      expect(response.body).toHaveProperty("summary");
      expect(response.body).toHaveProperty("results");
    });
  });

  describe("GET /admin/quarantined-jumpstats", () => {
    const { getKzLocalCS2Pool } = require("../../../src/db/kzLocal");

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

    it.each([
      ["pagination", { game: "cs2", page: 1, limit: 50 }],
      [
        "a filter and a steamid",
        {
          game: "cs2",
          filterId: "test_filter_1",
          steamid64: "76561198000000001",
        },
      ],
    ])("lists quarantined jumpstats given %s", async (_name, query) => {
      const response = await request(app)
        .get("/admin/quarantined-jumpstats")
        .query(query)
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("success", true);
      expect(response.body).toHaveProperty("game", "cs2");
      expect(response.body).toHaveProperty("data");
      expect(response.body).toHaveProperty("pagination");
    });
  });

  describe("POST /admin/restore-jumpstat/:id", () => {
    const { getKzLocalCS2Pool } = require("../../../src/db/kzLocal");

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

      expect(response.body).toEqual({
        error: "Record not found in quarantine",
      });
    });
  });
});
