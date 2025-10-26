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

// Global test timeout
jest.setTimeout(10000);
