// Test environment setup
require("dotenv").config({ path: ".env.test" });

// Set test environment
process.env.NODE_ENV = "test";

// Mock database pool to prevent actual connection during tests
// This must be mocked early to prevent the pool from being created on module load
jest.mock("../src/db", () => ({
  query: jest.fn(),
  initDatabase: jest.fn().mockResolvedValue(true),
  closeDatabase: jest.fn().mockResolvedValue(true),
}));

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
