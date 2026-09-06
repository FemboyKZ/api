// Mock logger first (doesn't affect cacheMiddleware exports)
jest.mock("../../src/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

// Use jest.requireActual to get the real cacheMiddleware module
// while still mocking the redis dependency
const cacheMiddlewareModule = jest.requireActual(
  "../../src/utils/cacheMiddleware",
);
const {
  serversKeyGenerator,
  playersKeyGenerator,
  onlinePlayersKeyGenerator,
  mapsKeyGenerator,
  kzKeyGenerator,
  generateCacheKey,
} = cacheMiddlewareModule;

describe("Cache Middleware", () => {
  // Each generator owns a distinct key namespace: two routes sharing one would
  // serve each other's cached bodies.
  describe("route key generators", () => {
    it.each([
      [
        "servers, all parameters",
        serversKeyGenerator,
        { game: "csgo", status: "1", region: "EU" },
        "cache:servers:csgo:1:EU",
      ],
      [
        "servers, defaults",
        serversKeyGenerator,
        {},
        "cache:servers:all:online:all",
      ],
      [
        "servers, partial",
        serversKeyGenerator,
        { game: "counterstrike2" },
        "cache:servers:counterstrike2:online:all",
      ],
      // status=0 is falsy but meaningful, so it must not collapse to the "online" default.
      [
        "servers, status=0",
        serversKeyGenerator,
        { status: "0" },
        "cache:servers:all:0:all",
      ],
      [
        "players, all parameters",
        playersKeyGenerator,
        {
          page: "2",
          limit: "20",
          sort: "name",
          order: "asc",
          name: "test",
          game: "csgo",
          server: "192.168.1.1:27015",
        },
        "cache:players:2:20:name:asc:test:csgo:192.168.1.1:27015",
      ],
      [
        "players, defaults",
        playersKeyGenerator,
        {},
        "cache:players:1:10:total_playtime:desc:all:all:all",
      ],
      [
        "players, partial",
        playersKeyGenerator,
        { page: "3", game: "counterstrike2" },
        "cache:players:3:10:total_playtime:desc:all:counterstrike2:all",
      ],
      [
        "online players, all parameters",
        onlinePlayersKeyGenerator,
        { game: "csgo", server: "192.168.1.1:27015" },
        "cache:players:online:csgo:192.168.1.1:27015",
      ],
      [
        "online players, defaults",
        onlinePlayersKeyGenerator,
        {},
        "cache:players:online:all:all",
      ],
      [
        "maps, all parameters",
        mapsKeyGenerator,
        {
          page: "1",
          limit: "25",
          sort: "name",
          order: "asc",
          server: "192.168.1.1",
          name: "kz_",
          game: "csgo",
        },
        "cache:maps:1:25:name:asc:192.168.1.1:kz_:csgo",
      ],
      [
        "maps, defaults",
        mapsKeyGenerator,
        {},
        "cache:maps:1:10:total_playtime:desc:all:all:all",
      ],
    ])("%s", (_name, generator, query, expected) => {
      expect(generator({ query })).toBe(expected);
    });

    it("keeps /players and /players/online in separate namespaces", () => {
      const req = { query: { game: "csgo" } };
      expect(playersKeyGenerator(req)).not.toBe(onlinePlayersKeyGenerator(req));
    });
  });

  describe("kzKeyGenerator", () => {
    it.each([
      [
        "joins the path, param values and query pairs",
        {
          baseUrl: "/global",
          path: "/records",
          params: { mapname: "kz_grotto" },
          query: { mode: "1", stage: "0" },
        },
        "cache:kz:/global/records:kz_grotto:mode:1:stage:0",
      ],
      [
        "is just the path when there is nothing else",
        { baseUrl: "/global", path: "/players", params: {}, query: {} },
        "cache:kz:/global/players",
      ],
      [
        "sorts params and query by key so argument order cannot split the key",
        {
          baseUrl: "/kz",
          path: "/test",
          params: { z: "last", a: "first" },
          query: { zebra: "1", apple: "2" },
        },
        "cache:kz:/kz/test:first:last:apple:2:zebra:1",
      ],
    ])("%s", (_name, req, expected) => {
      expect(kzKeyGenerator(req)).toBe(expected);
    });
  });

  describe("generateCacheKey", () => {
    it.each([
      [
        "prefix, params and query",
        [
          "history:server",
          { ip: "192.168.1.1", port: "27015" },
          { from: "2024-01-01", to: "2024-12-31" },
        ],
        "cache:history:server:ip:192.168.1.1:port:27015:from:2024-01-01:to:2024-12-31",
      ],
      ["prefix alone", ["simple"], "cache:simple"],
      ["prefix and params", ["test", { id: "123" }], "cache:test:id:123"],
      [
        "prefix and query",
        ["test", {}, { limit: "10" }],
        "cache:test:limit:10",
      ],
      ["empty objects", ["test", {}, {}], "cache:test"],
      [
        "params sorted by key",
        ["test", { z: "1", a: "2", m: "3" }],
        "cache:test:a:2:m:3:z:1",
      ],
      [
        "query sorted by key",
        ["test", {}, { z: "1", a: "2" }],
        "cache:test:a:2:z:1",
      ],
    ])("%s", (_name, args, expected) => {
      expect(generateCacheKey(...args)).toBe(expected);
    });
  });
});
