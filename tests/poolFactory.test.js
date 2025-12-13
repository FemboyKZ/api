const {
  DEFAULT_POOL_CONFIG,
  MAX_RETRIES,
  RETRY_DELAY,
  createPool,
  createLazyPool,
} = require("../src/db/poolFactory");

// Mock mysql2/promise
jest.mock("mysql2/promise", () => ({
  createPool: jest.fn(() => ({
    getConnection: jest.fn(),
    end: jest.fn(),
    on: jest.fn(),
  })),
}));

// Mock logger
jest.mock("../src/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const mysql = require("mysql2/promise");

describe("Pool Factory", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Constants", () => {
    it("should have correct DEFAULT_POOL_CONFIG values", () => {
      expect(DEFAULT_POOL_CONFIG.waitForConnections).toBe(true);
      expect(DEFAULT_POOL_CONFIG.connectionLimit).toBe(10);
      expect(DEFAULT_POOL_CONFIG.queueLimit).toBe(0);
      expect(DEFAULT_POOL_CONFIG.connectTimeout).toBe(60000);
      expect(DEFAULT_POOL_CONFIG.enableKeepAlive).toBe(true);
      expect(DEFAULT_POOL_CONFIG.keepAliveInitialDelay).toBe(0);
      expect(DEFAULT_POOL_CONFIG.jsonStrings).toBe(false);
    });

    it("should have correct MAX_RETRIES", () => {
      expect(MAX_RETRIES).toBe(5);
    });

    it("should have correct RETRY_DELAY", () => {
      expect(RETRY_DELAY).toBe(5000);
    });
  });

  describe("createPool", () => {
    it("should create a pool with required config", () => {
      const config = {
        host: "localhost",
        user: "root",
        password: "password",
        database: "testdb",
      };

      createPool(config);

      expect(mysql.createPool).toHaveBeenCalledWith(
        expect.objectContaining({
          host: "localhost",
          user: "root",
          password: "password",
          database: "testdb",
          port: 3306, // default port
          connectionLimit: 10, // default from DEFAULT_POOL_CONFIG
          queueLimit: 0,
        }),
      );
    });

    it("should use custom port when provided", () => {
      const config = {
        host: "localhost",
        port: 3307,
        user: "root",
        password: "password",
        database: "testdb",
      };

      createPool(config);

      expect(mysql.createPool).toHaveBeenCalledWith(
        expect.objectContaining({
          port: 3307,
        }),
      );
    });

    it("should use custom connectionLimit when provided", () => {
      const config = {
        host: "localhost",
        user: "root",
        password: "password",
        database: "testdb",
        connectionLimit: 20,
      };

      createPool(config);

      expect(mysql.createPool).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionLimit: 20,
        }),
      );
    });

    it("should use custom queueLimit when provided", () => {
      const config = {
        host: "localhost",
        user: "root",
        password: "password",
        database: "testdb",
        queueLimit: 100,
      };

      createPool(config);

      expect(mysql.createPool).toHaveBeenCalledWith(
        expect.objectContaining({
          queueLimit: 100,
        }),
      );
    });

    it("should include all DEFAULT_POOL_CONFIG values", () => {
      const config = {
        host: "localhost",
        user: "root",
        password: "password",
        database: "testdb",
      };

      createPool(config);

      expect(mysql.createPool).toHaveBeenCalledWith(
        expect.objectContaining({
          waitForConnections: true,
          connectTimeout: 60000,
          enableKeepAlive: true,
          keepAliveInitialDelay: 0,
          jsonStrings: false,
        }),
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
