const {
  DEFAULT_POOL_CONFIG,
  createPool,
  createLazyPool,
} = require("../../src/db/poolFactory");

// Mock mysql2/promise
jest.mock("mysql2/promise", () => ({
  createPool: jest.fn(() => ({
    getConnection: jest.fn(),
    end: jest.fn(),
    on: jest.fn(),
  })),
}));

// Mock logger
jest.mock("../../src/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const mysql = require("mysql2/promise");

describe("Pool Factory", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("createPool", () => {
    const baseConfig = {
      host: "localhost",
      user: "root",
      password: "password",
      database: "testdb",
    };

    it("passes the connection details through and fills in the defaults", () => {
      createPool(baseConfig);

      expect(mysql.createPool).toHaveBeenCalledWith(
        expect.objectContaining({
          ...baseConfig,
          port: 3306,
          ...DEFAULT_POOL_CONFIG,
        }),
      );
    });

    // queueLimit uses ?? rather than ||, so an explicit 0 has to survive.
    it.each([
      ["port", 3307],
      ["connectionLimit", 20],
      ["queueLimit", 100],
      ["queueLimit", 0],
    ])("lets config override %s", (key, value) => {
      createPool({ ...baseConfig, [key]: value });

      expect(mysql.createPool).toHaveBeenCalledWith(
        expect.objectContaining({ [key]: value }),
      );
    });
  });

  describe("createLazyPool", () => {
    it("should create a lazy pool object", () => {
      const mockPool = { query: jest.fn() };
      const createFn = jest.fn(() => mockPool);

      const lazyPool = createLazyPool(createFn);

      expect(lazyPool).toHaveProperty("get");
      expect(lazyPool).toHaveProperty("set");
      expect(lazyPool).toHaveProperty("close");
      expect(createFn).not.toHaveBeenCalled(); // Not called until get()
    });

    it("should initialize pool on first get()", () => {
      const mockPool = { query: jest.fn() };
      const createFn = jest.fn(() => mockPool);

      const lazyPool = createLazyPool(createFn);

      expect(createFn).not.toHaveBeenCalled();

      const pool = lazyPool.get();

      expect(createFn).toHaveBeenCalledTimes(1);
      expect(pool).toBe(mockPool);
    });

    it("should return same pool on subsequent get() calls", () => {
      const mockPool = { query: jest.fn() };
      const createFn = jest.fn(() => mockPool);

      const lazyPool = createLazyPool(createFn);

      const pool1 = lazyPool.get();
      const pool2 = lazyPool.get();
      const pool3 = lazyPool.get();

      expect(createFn).toHaveBeenCalledTimes(1);
      expect(pool1).toBe(pool2);
      expect(pool2).toBe(pool3);
    });

    it("should allow setting a new pool", () => {
      const mockPool1 = { id: 1, query: jest.fn() };
      const mockPool2 = { id: 2, query: jest.fn() };
      const createFn = jest.fn(() => mockPool1);

      const lazyPool = createLazyPool(createFn);

      // Initialize with first pool
      const pool1 = lazyPool.get();
      expect(pool1.id).toBe(1);

      // Set new pool
      lazyPool.set(mockPool2);

      const pool2 = lazyPool.get();
      expect(pool2.id).toBe(2);
      expect(createFn).toHaveBeenCalledTimes(1); // Still only 1 call since we set manually
    });

    it("should close pool and reset to null", async () => {
      const mockPool = {
        query: jest.fn(),
        end: jest.fn().mockResolvedValue(undefined),
      };
      const createFn = jest.fn(() => mockPool);

      const lazyPool = createLazyPool(createFn);

      // Initialize pool
      lazyPool.get();
      expect(createFn).toHaveBeenCalledTimes(1);

      // Close pool
      await lazyPool.close("Test");

      expect(mockPool.end).toHaveBeenCalled();

      // Next get() should create new pool
      lazyPool.get();
      expect(createFn).toHaveBeenCalledTimes(2);
    });

    it("should not error when closing uninitialized pool", async () => {
      const createFn = jest.fn();
      const lazyPool = createLazyPool(createFn);

      // Should not throw
      await expect(lazyPool.close("Test")).resolves.toBeUndefined();
      expect(createFn).not.toHaveBeenCalled();
    });
  });
});
