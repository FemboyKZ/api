const errorHandler = require("../src/utils/errorHandler");

// Mock logger
jest.mock("../src/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const logger = require("../src/utils/logger");

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

    it("should log error for different HTTP methods", () => {
      mockReq.method = "POST";
      mockReq.path = "/api/users";
      const error = new Error("Creation failed");

      errorHandler(error, mockReq, mockRes, mockNext);

      expect(logger.error).toHaveBeenCalledWith(
        "Error processing POST /api/users: Creation failed",
        expect.anything(),
      );
    });
  });

  describe("Response Status", () => {
    it("should use error status if provided", () => {
      const error = new Error("Not Found");
      error.status = 404;

      errorHandler(error, mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
    });

    it("should default to 500 if no status provided", () => {
      const error = new Error("Internal Error");

      errorHandler(error, mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(500);
    });

    it("should handle custom status codes", () => {
      const error = new Error("Bad Request");
      error.status = 400;

      errorHandler(error, mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });
  });

  describe("Development Mode", () => {
    const originalNodeEnv = process.env.NODE_ENV;

    afterEach(() => {
      process.env.NODE_ENV = originalNodeEnv;
    });

    it("should include error message and stack in development", () => {
      process.env.NODE_ENV = "development";
      const error = new Error("Debug error");
      error.stack = "Error: Debug error\n    at test.js:10:5";

      errorHandler(error, mockReq, mockRes, mockNext);

      expect(mockRes.json).toHaveBeenCalledWith({
        error: "Debug error",
        stack: error.stack,
      });
    });

    it("should include detailed error message in development", () => {
      process.env.NODE_ENV = "development";
      const error = new Error("Database connection failed: ECONNREFUSED");

      errorHandler(error, mockReq, mockRes, mockNext);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "Database connection failed: ECONNREFUSED",
        }),
      );
    });
  });

  describe("Production Mode", () => {
    const originalNodeEnv = process.env.NODE_ENV;

    afterEach(() => {
      process.env.NODE_ENV = originalNodeEnv;
    });

    it("should hide error details in production", () => {
      process.env.NODE_ENV = "production";
      const error = new Error("Sensitive database error");
      error.stack = "Error: Sensitive database error\n    at secret.js:1:1";

      errorHandler(error, mockReq, mockRes, mockNext);

      expect(mockRes.json).toHaveBeenCalledWith({
        error: "Internal Server Error",
      });
    });

    it("should not include stack trace in production", () => {
      process.env.NODE_ENV = "production";
      const error = new Error("Secret error");
      error.stack = "Stack trace with file paths";

      errorHandler(error, mockReq, mockRes, mockNext);

      const response = mockRes.json.mock.calls[0][0];
      expect(response.stack).toBeUndefined();
    });
  });

  describe("Edge Cases", () => {
    it("should handle error without message", () => {
      const error = new Error();

      errorHandler(error, mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalled();
    });

    it("should handle error with empty query object", () => {
      mockReq.query = {};
      const error = new Error("Test error");

      errorHandler(error, mockReq, mockRes, mockNext);

      expect(logger.error).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ query: {} }),
      );
    });

    it("should handle request without IP", () => {
      delete mockReq.ip;
      const error = new Error("Test error");

      errorHandler(error, mockReq, mockRes, mockNext);

      expect(logger.error).toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(500);
    });

    it("should not call next", () => {
      const error = new Error("Test error");

      errorHandler(error, mockReq, mockRes, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
    });
  });
});
