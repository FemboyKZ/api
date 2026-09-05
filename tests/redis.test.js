// Cache invalidation runs on every updater cycle,
// so the pattern sweep needs to page through SCAN rather than issuing a single blocking KEYS.

const handlers = {};
const mockScan = jest.fn();
const mockDel = jest.fn().mockResolvedValue(1);
const mockGet = jest.fn();
const mockSetEx = jest.fn().mockResolvedValue("OK");

const mockClient = {
  on: (event, fn) => {
    handlers[event] = fn;
  },
  connect: jest.fn().mockResolvedValue(undefined),
  quit: jest.fn().mockResolvedValue(undefined),
  scan: mockScan,
  del: mockDel,
  get: mockGet,
  setEx: mockSetEx,
};

jest.mock("redis", () => ({ createClient: () => mockClient }));

let redisModule;

beforeAll(async () => {
  process.env.REDIS_ENABLED = "true";
  jest.isolateModules(() => {
    redisModule = require("../src/db/redis");
  });
  await redisModule.initRedis();
  // initRedis only marks the client usable once the connect event fires.
  handlers.connect();
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe("deleteCache", () => {
  it("deletes a literal key directly, without scanning", async () => {
    await expect(redisModule.deleteCache("cache:servers:all")).resolves.toBe(
      true,
    );
    expect(mockDel).toHaveBeenCalledWith("cache:servers:all");
    expect(mockScan).not.toHaveBeenCalled();
  });

  it("pages through SCAN until the cursor returns to 0", async () => {
    mockScan
      .mockResolvedValueOnce({ cursor: "17", keys: ["a", "b"] })
      .mockResolvedValueOnce({ cursor: "42", keys: [] })
      .mockResolvedValueOnce({ cursor: "0", keys: ["c"] });

    await expect(redisModule.deleteCache("cache:players:*")).resolves.toBe(
      true,
    );

    expect(mockScan).toHaveBeenCalledTimes(3);
    expect(mockScan.mock.calls.map(([cursor]) => cursor)).toEqual([
      "0",
      "17",
      "42",
    ]);
    for (const [, options] of mockScan.mock.calls) {
      expect(options.MATCH).toBe("cache:players:*");
    }
    // The empty page must not trigger a DEL with no keys.
    expect(mockDel.mock.calls).toEqual([[["a", "b"]], [["c"]]]);
  });

  it("tolerates a numeric cursor from the client", async () => {
    mockScan
      .mockResolvedValueOnce({ cursor: 9, keys: ["a"] })
      .mockResolvedValueOnce({ cursor: 0, keys: [] });

    await expect(redisModule.deleteCache("cache:maps:*")).resolves.toBe(true);
    expect(mockScan).toHaveBeenCalledTimes(2);
  });

  it("returns false when the sweep fails instead of throwing", async () => {
    mockScan.mockRejectedValueOnce(new Error("connection lost"));
    await expect(redisModule.deleteCache("cache:maps:*")).resolves.toBe(false);
  });
});
