const { validateEnvironment } = require("../../src/utils/envValidator");

// Mock logger
jest.mock("../../src/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

describe("Environment Validator", () => {
  // Store original env
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment to minimal valid state
    process.env = {
      ...originalEnv,
      DB_HOST: "localhost",
      DB_USER: "root",
      DB_PASSWORD: "password",
      DB_NAME: "testdb",
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe("Required Variables", () => {
    it("should pass with all required variables", () => {
      expect(() => validateEnvironment()).not.toThrow();
    });

    it.each(["DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME"])(
      "should throw when %s is missing",
      (name) => {
        delete process.env[name];
        expect(() => validateEnvironment()).toThrow(
          new RegExp(`Missing required environment variables.*${name}`),
        );
      },
    );

    it("should list every missing variable in one error", () => {
      delete process.env.DB_HOST;
      delete process.env.DB_USER;
      expect(() => validateEnvironment()).toThrow(/DB_HOST.*DB_USER/);
    });
  });

  describe("Optional Numeric Variables", () => {
    it.each([
      ["PORT", "3000", "not-a-number"],
      ["RATE_LIMIT_MAX", "500", "abc"],
      ["REDIS_PORT", "6379", "invalid"],
      ["REDIS_DB", "0", "xyz"],
    ])("%s accepts a number and rejects anything else", (name, ok, bad) => {
      process.env[name] = ok;
      expect(() => validateEnvironment()).not.toThrow();

      process.env[name] = bad;
      expect(() => validateEnvironment()).toThrow(
        `${name} must be a valid number`,
      );
    });
  });

  describe("Boolean Variables", () => {
    it.each(["true", "false"])("should pass with REDIS_ENABLED=%s", (value) => {
      process.env.REDIS_ENABLED = value;
      expect(() => validateEnvironment()).not.toThrow();
    });

    // db/redis.js tests `=== "true"` exactly, so other casings would look enabled but run with caching off.
    it.each(["TRUE", "FALSE", "yes", "1"])(
      "should throw with REDIS_ENABLED=%s",
      (value) => {
        process.env.REDIS_ENABLED = value;
        expect(() => validateEnvironment()).toThrow(
          "REDIS_ENABLED must be exactly 'true' or 'false'",
        );
      },
    );
  });

  describe("URL Variables", () => {
    it.each([
      ["GOKZ_API_URL", "https://kztimerglobal.com/api/v2", "not-a-valid-url"],
      ["CS2KZ_API_URL", "https://api.cs2kz.org/", "invalid-url"],
    ])("%s accepts a URL and rejects anything else", (name, ok, bad) => {
      process.env[name] = ok;
      expect(() => validateEnvironment()).not.toThrow();

      process.env[name] = bad;
      expect(() => validateEnvironment()).toThrow(
        `${name} must be a valid URL`,
      );
    });

    it("should pass with http URLs", () => {
      process.env.GOKZ_API_URL = "http://localhost:3000/api";
      expect(() => validateEnvironment()).not.toThrow();
    });
  });

  describe("Warnings for Optional Variables", () => {
    const logger = require("../../src/utils/logger");

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("should warn when STEAM_API_KEY is not set", () => {
      delete process.env.STEAM_API_KEY;
      validateEnvironment();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("STEAM_API_KEY not set"),
      );
    });

    it("should not warn when STEAM_API_KEY is set", () => {
      process.env.STEAM_API_KEY = "my-api-key";
      validateEnvironment();
      expect(logger.warn).not.toHaveBeenCalledWith(
        expect.stringContaining("STEAM_API_KEY"),
      );
    });

    // Both fall back to the public endpoints, so unset is normal config.
    it("should not warn when GOKZ_API_URL is not set", () => {
      delete process.env.GOKZ_API_URL;
      validateEnvironment();
      expect(logger.warn).not.toHaveBeenCalledWith(
        expect.stringContaining("GOKZ_API_URL"),
      );
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining("GOKZ_API_URL not set"),
      );
    });

    it("should not warn when CS2KZ_API_URL is not set", () => {
      delete process.env.CS2KZ_API_URL;
      validateEnvironment();
      expect(logger.warn).not.toHaveBeenCalledWith(
        expect.stringContaining("CS2KZ_API_URL"),
      );
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining("CS2KZ_API_URL not set"),
      );
    });

    it("should log info on successful validation", () => {
      validateEnvironment();
      expect(logger.info).toHaveBeenCalledWith("Environment validation passed");
    });

    it("should log configuration info", () => {
      process.env.PORT = "4000";
      process.env.REDIS_ENABLED = "true";
      validateEnvironment();
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("Configuration:"),
      );
    });
  });
});
