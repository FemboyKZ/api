const errorHandler = require("../../src/utils/errorHandler");

// Mock logger
jest.mock("../../src/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const logger = require("../../src/utils/logger");

describe("Error Handler", () => {
  let mockReq;
  let mockRes;
  let mockNext;

  beforeEach(() => {
    jest.clearAllMocks();

    mockReq = {
      method: "GET",
      path: "/test",
      query: { page: "1" },
      ip: "127.0.0.1",
    };

    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    mockNext = jest.fn();
  });

  describe("Error Logging", () => {
    it("should log error with details", () => {
      const error = new Error("Test error");
      error.stack = "Error: Test error\n    at test.js:1:1";

      errorHandler(error, mockReq, mockRes, mockNext);

      expect(logger.error).toHaveBeenCalledWith(
        "Error processing GET /test: Test error",
        expect.objectContaining({
          error: error.stack,
          method: "GET",
          path: "/test",
          query: { page: "1" },
          ip: "127.0.0.1",
        }),
      );
    });
  });

  describe("Response Status", () => {
    it.each([
      ["an error carrying a status", 404, 404],
      ["a client error status", 400, 400],
      ["an error with no status", undefined, 500],
    ])("responds %s with %p", (_name, status, expected) => {
      const error = new Error("boom");
      if (status !== undefined) error.status = status;

      errorHandler(error, mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(expected);
    });
  });

  describe("Body by environment", () => {
    const originalNodeEnv = process.env.NODE_ENV;

    afterEach(() => {
      process.env.NODE_ENV = originalNodeEnv;
    });

    it("includes the message and stack in development", () => {
      process.env.NODE_ENV = "development";
      const error = new Error("Debug error");
      error.stack = "Error: Debug error\n    at test.js:10:5";

      errorHandler(error, mockReq, mockRes, mockNext);

      expect(mockRes.json).toHaveBeenCalledWith({
        error: "Debug error",
        stack: error.stack,
      });
    });

    // The exact body matters here: a leaked message or stack exposes file paths and query internals.
    it("hides both in production", () => {
      process.env.NODE_ENV = "production";
      const error = new Error("Sensitive database error");
      error.stack = "Error: Sensitive database error\n    at secret.js:1:1";

      errorHandler(error, mockReq, mockRes, mockNext);

      expect(mockRes.json).toHaveBeenCalledWith({
        error: "Internal Server Error",
      });
    });
  });

  describe("Edge Cases", () => {
    it("should handle error without message", () => {
      const error = new Error();

      errorHandler(error, mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalled();
    });

    // Terminal middleware: passing the error on would hand it to Express's default handler too.
    it("should not call next", () => {
      const error = new Error("Test error");

      errorHandler(error, mockReq, mockRes, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
    });
  });
});
