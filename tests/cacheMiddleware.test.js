// Mock logger first (doesn't affect cacheMiddleware exports)
jest.mock("../src/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

// Use jest.requireActual to get the real cacheMiddleware module
// while still mocking the redis dependency
const cacheMiddlewareModule = jest.requireActual(
  "../src/utils/cacheMiddleware",
);
const {
  serversKeyGenerator,
  playersKeyGenerator,
  mapsKeyGenerator,
  kzKeyGenerator,
  generateCacheKey,
} = cacheMiddlewareModule;

describe("Cache Middleware", () => {
  describe("serversKeyGenerator", () => {
    it("should generate key with all parameters", () => {
      const req = {
        query: { game: "csgo", status: "1", region: "EU" },
      };
      const key = serversKeyGenerator(req);
      expect(key).toBe("cache:servers:csgo:1:EU");
    });

    it("should use defaults for missing parameters", () => {
      const req = { query: {} };
      const key = serversKeyGenerator(req);
      expect(key).toBe("cache:servers:all:online:all");
    });

    it("should handle partial parameters", () => {
      const req = { query: { game: "counterstrike2" } };
      const key = serversKeyGenerator(req);
      expect(key).toBe("cache:servers:counterstrike2:online:all");
    });

    it("should handle status=0 correctly", () => {
      const req = { query: { status: "0" } };
      const key = serversKeyGenerator(req);
      expect(key).toBe("cache:servers:all:0:all");
    });
  });

  describe("playersKeyGenerator", () => {
    it("should generate key with all parameters", () => {
      const req = {
        query: {
          page: "2",
          limit: "20",
          sort: "name",
          order: "asc",
          name: "test",
          game: "csgo",
          server: "192.168.1.1:27015",
        },
      };
      const key = playersKeyGenerator(req);
      expect(key).toBe(
        "cache:players:2:20:name:asc:test:csgo:192.168.1.1:27015",
      );
    });

    it("should use defaults for missing parameters", () => {
      const req = { query: {} };
      const key = playersKeyGenerator(req);
      expect(key).toBe("cache:players:1:10:total_playtime:desc:all:all:all");
    });

    it("should handle partial parameters", () => {
      const req = { query: { page: "3", game: "counterstrike2" } };
      const key = playersKeyGenerator(req);
      expect(key).toBe(
        "cache:players:3:10:total_playtime:desc:all:counterstrike2:all",
      );
    });
  });

  describe("mapsKeyGenerator", () => {
    it("should generate key with all parameters", () => {
      const req = {
        query: {
          page: "1",
          limit: "25",
          sort: "name",
          order: "asc",
          server: "192.168.1.1",
          name: "kz_",
          game: "csgo",
        },
      };
      const key = mapsKeyGenerator(req);
      expect(key).toBe("cache:maps:1:25:name:asc:192.168.1.1:kz_:csgo");
    });

    it("should use defaults for missing parameters", () => {
      const req = { query: {} };
      const key = mapsKeyGenerator(req);
      expect(key).toBe("cache:maps:1:10:total_playtime:desc:all:all:all");
    });
  });

  describe("kzKeyGenerator", () => {
    it("should generate key with params and query", () => {
      const req = {
        baseUrl: "/kzglobal",
        path: "/records",
        params: { mapname: "kz_grotto" },
        query: { mode: "1", stage: "0" },
      };
      const key = kzKeyGenerator(req);
      expect(key).toBe("cache:kz:/kzglobal/records:kz_grotto:mode:1:stage:0");
    });

    it("should generate key with only path", () => {
      const req = {
        baseUrl: "/kzglobal",
        path: "/players",
        params: {},
        query: {},
      };
      const key = kzKeyGenerator(req);
      expect(key).toBe("cache:kz:/kzglobal/players");
    });

    it("should sort params and query alphabetically", () => {
      const req = {
        baseUrl: "/kz",
        path: "/test",
        params: { z: "last", a: "first" },
        query: { zebra: "1", apple: "2" },
      };
      const key = kzKeyGenerator(req);
      // Params values should be sorted by key
      expect(key).toContain("first");
      expect(key).toContain("last");
      // Query should be sorted alphabetically
      expect(key).toContain("apple:2");
      expect(key).toContain("zebra:1");
    });
  });

  describe("generateCacheKey", () => {
    it("should generate key with prefix, params, and query", () => {
      const key = generateCacheKey(
        "history:server",
        { ip: "192.168.1.1", port: "27015" },
        { from: "2024-01-01", to: "2024-12-31" },
      );
      expect(key).toBe(
        "cache:history:server:ip:192.168.1.1:port:27015:from:2024-01-01:to:2024-12-31",
      );
    });

    it("should generate key with only prefix", () => {
      const key = generateCacheKey("simple");
      expect(key).toBe("cache:simple");
    });

    it("should generate key with prefix and params only", () => {
      const key = generateCacheKey("test", { id: "123" });
      expect(key).toBe("cache:test:id:123");
    });

    it("should generate key with prefix and query only", () => {
      const key = generateCacheKey("test", {}, { limit: "10" });
      expect(key).toBe("cache:test:limit:10");
    });

    it("should sort params alphabetically", () => {
      const key = generateCacheKey("test", { z: "1", a: "2", m: "3" });
      expect(key).toBe("cache:test:a:2:m:3:z:1");
    });

    it("should sort query alphabetically", () => {
      const key = generateCacheKey("test", {}, { z: "1", a: "2" });
      expect(key).toBe("cache:test:a:2:z:1");
    });

    it("should handle empty objects", () => {
      const key = generateCacheKey("test", {}, {});
      expect(key).toBe("cache:test");
    });
  });
});
