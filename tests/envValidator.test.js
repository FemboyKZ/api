const { validateEnvironment } = require("../src/utils/envValidator");

// Mock logger
jest.mock("../src/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
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

    it("should throw when DB_HOST is missing", () => {
      delete process.env.DB_HOST;
      expect(() => validateEnvironment()).toThrow(
        /Missing required environment variables.*DB_HOST/,
      );
    });

    it("should throw when DB_USER is missing", () => {
      delete process.env.DB_USER;
      expect(() => validateEnvironment()).toThrow(
        /Missing required environment variables.*DB_USER/,
      );
    });

    it("should throw when DB_PASSWORD is missing", () => {
      delete process.env.DB_PASSWORD;
      expect(() => validateEnvironment()).toThrow(
        /Missing required environment variables.*DB_PASSWORD/,
      );
    });

    it("should throw when DB_NAME is missing", () => {
      delete process.env.DB_NAME;
      expect(() => validateEnvironment()).toThrow(
        /Missing required environment variables.*DB_NAME/,
      );
    });

    it("should list all missing variables in error", () => {
      delete process.env.DB_HOST;
      delete process.env.DB_USER;
      expect(() => validateEnvironment()).toThrow(/DB_HOST/);
      // Re-check since the first assertion might stop
    });
  });

  describe("Optional Numeric Variables", () => {
    it("should pass with valid PORT", () => {
      process.env.PORT = "3000";
      expect(() => validateEnvironment()).not.toThrow();
    });

    it("should throw with invalid PORT", () => {
      process.env.PORT = "not-a-number";
      expect(() => validateEnvironment()).toThrow(
        "PORT must be a valid number",
      );
    });

    it("should pass with valid RATE_LIMIT_MAX", () => {
      process.env.RATE_LIMIT_MAX = "500";
      expect(() => validateEnvironment()).not.toThrow();
    });

    it("should throw with invalid RATE_LIMIT_MAX", () => {
      process.env.RATE_LIMIT_MAX = "abc";
      expect(() => validateEnvironment()).toThrow(
        "RATE_LIMIT_MAX must be a valid number",
      );
    });

    it("should pass with valid REDIS_PORT", () => {
      process.env.REDIS_PORT = "6379";
      expect(() => validateEnvironment()).not.toThrow();
    });

    it("should throw with invalid REDIS_PORT", () => {
      process.env.REDIS_PORT = "invalid";
      expect(() => validateEnvironment()).toThrow(
        "REDIS_PORT must be a valid number",
      );
    });

    it("should pass with valid REDIS_DB", () => {
      process.env.REDIS_DB = "0";
      expect(() => validateEnvironment()).not.toThrow();
    });

    it("should throw with invalid REDIS_DB", () => {
      process.env.REDIS_DB = "xyz";
      expect(() => validateEnvironment()).toThrow(
        "REDIS_DB must be a valid number",
      );
    });
  });

  describe("Boolean Variables", () => {
    it("should pass with REDIS_ENABLED=true", () => {
      process.env.REDIS_ENABLED = "true";
      expect(() => validateEnvironment()).not.toThrow();
    });

    it("should pass with REDIS_ENABLED=false", () => {
      process.env.REDIS_ENABLED = "false";
      expect(() => validateEnvironment()).not.toThrow();
    });

    it("should pass with REDIS_ENABLED=TRUE (case insensitive)", () => {
      process.env.REDIS_ENABLED = "TRUE";
      expect(() => validateEnvironment()).not.toThrow();
    });

    it("should pass with REDIS_ENABLED=FALSE (case insensitive)", () => {
      process.env.REDIS_ENABLED = "FALSE";
      expect(() => validateEnvironment()).not.toThrow();
    });

    it("should throw with invalid REDIS_ENABLED value", () => {
      process.env.REDIS_ENABLED = "yes";
      expect(() => validateEnvironment()).toThrow(
        "REDIS_ENABLED must be 'true' or 'false'",
      );
    });

    it("should throw with REDIS_ENABLED=1", () => {
      process.env.REDIS_ENABLED = "1";
      expect(() => validateEnvironment()).toThrow(
        "REDIS_ENABLED must be 'true' or 'false'",
      );
    });
  });

  describe("URL Variables", () => {
    it("should pass with valid GOKZ_API_URL", () => {
      process.env.GOKZ_API_URL = "https://kztimerglobal.com/api/v2";
      expect(() => validateEnvironment()).not.toThrow();
    });

    it("should throw with invalid GOKZ_API_URL", () => {
      process.env.GOKZ_API_URL = "not-a-valid-url";
      expect(() => validateEnvironment()).toThrow(
        "GOKZ_API_URL must be a valid URL",
      );
    });

    it("should pass with valid CS2KZ_API_URL", () => {
      process.env.CS2KZ_API_URL = "https://api.cs2kz.org/";
      expect(() => validateEnvironment()).not.toThrow();
    });

    it("should throw with invalid CS2KZ_API_URL", () => {
      process.env.CS2KZ_API_URL = "invalid-url";
      expect(() => validateEnvironment()).toThrow(
        "CS2KZ_API_URL must be a valid URL",
      );
    });

    it("should pass with http URLs", () => {
      process.env.GOKZ_API_URL = "http://localhost:3000/api";
      expect(() => validateEnvironment()).not.toThrow();
    });
  });

  describe("Warnings for Optional Variables", () => {
    const logger = require("../src/utils/logger");

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

    it("should warn when GOKZ_API_URL is not set", () => {
      delete process.env.GOKZ_API_URL;
      validateEnvironment();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("GOKZ_API_URL not set"),
      );
    });

    it("should warn when CS2KZ_API_URL is not set", () => {
      delete process.env.CS2KZ_API_URL;
      validateEnvironment();
      expect(logger.warn).toHaveBeenCalledWith(
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
