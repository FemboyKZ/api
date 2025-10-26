// Test environment setup
require("dotenv").config({ path: ".env.test" });

// Set test environment
process.env.NODE_ENV = "test";

// Mock logger to reduce noise in tests
jest.mock("../src/utils/logger", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  logRequest: jest.fn(),
  logQuery: jest.fn(),
}));

// Mock cache middleware
jest.mock("../src/utils/cacheMiddleware", () => ({
  cacheMiddleware: () => (req, res, next) => next(),
  serversKeyGenerator: jest.fn(),
  playersKeyGenerator: jest.fn(),
  mapsKeyGenerator: jest.fn(),
  generateCacheKey: jest.fn(),
}));

// Global test timeout
jest.setTimeout(10000);
