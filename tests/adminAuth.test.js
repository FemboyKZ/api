const {
  adminAuth,
  optionalAdminAuth,
  generateAPIKey,
  getClientIP,
  isLocalhost,
  isWhitelisted,
} = require("../src/utils/adminAuth");

// Store original env vars
const originalEnv = process.env;

describe("Admin Auth Utilities", () => {
  beforeEach(() => {
    // Reset environment variables for each test
    process.env = { ...originalEnv };
    delete process.env.ADMIN_API_KEY;
    delete process.env.ADMIN_IP_WHITELIST;
    delete process.env.ADMIN_LOCALHOST_ALLOWED;
    delete process.env.NODE_ENV;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe("getClientIP", () => {
    it("should extract IP from X-Forwarded-For header", () => {
      const req = {
        headers: {
          "x-forwarded-for": "203.0.113.195, 70.41.3.18, 150.172.238.178",
        },
        socket: { remoteAddress: "127.0.0.1" },
      };
      expect(getClientIP(req)).toBe("203.0.113.195");
    });

    it("should extract IP from X-Real-IP header", () => {
      const req = {
        headers: { "x-real-ip": "203.0.113.195" },
        socket: { remoteAddress: "127.0.0.1" },
      };
      expect(getClientIP(req)).toBe("203.0.113.195");
    });

    it("should fall back to socket remoteAddress", () => {
      const req = {
        headers: {},
        socket: { remoteAddress: "192.168.1.100" },
      };
      expect(getClientIP(req)).toBe("192.168.1.100");
    });
  });

  describe("isLocalhost", () => {
    it("should return true for 127.0.0.1", () => {
      expect(isLocalhost("127.0.0.1")).toBe(true);
    });

    it("should return true for ::1", () => {
      expect(isLocalhost("::1")).toBe(true);
    });

    it("should return true for ::ffff:127.0.0.1", () => {
      expect(isLocalhost("::ffff:127.0.0.1")).toBe(true);
    });

    it("should return false for external IP", () => {
      expect(isLocalhost("192.168.1.100")).toBe(false);
    });
  });

  describe("isWhitelisted", () => {
    it("should return false when no whitelist is configured", () => {
      expect(isWhitelisted("192.168.1.100")).toBe(false);
    });
  });

  describe("generateAPIKey", () => {
    it("should generate a 64-character hex string by default", () => {
      const key = generateAPIKey();
      expect(key).toHaveLength(64);
      expect(/^[a-f0-9]+$/.test(key)).toBe(true);
    });

    it("should generate keys of specified length", () => {
      const key = generateAPIKey(16);
      expect(key).toHaveLength(32); // 16 bytes = 32 hex chars
    });
  });
});

describe("Admin Auth Middleware", () => {
  let mockReq;
  let mockRes;
  let mockNext;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.ADMIN_API_KEY;
    delete process.env.ADMIN_IP_WHITELIST;
    delete process.env.ADMIN_LOCALHOST_ALLOWED;
    delete process.env.NODE_ENV;

    mockReq = {
      headers: {},
      query: {},
      path: "/admin/test",
      method: "POST",
      socket: { remoteAddress: "192.168.1.100" },
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    mockNext = jest.fn();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe("adminAuth", () => {
    it("should reject requests when no API key is configured and not localhost", () => {
      // Force production mode to disable localhost access
      process.env.NODE_ENV = "production";

      // Re-require the module to pick up new env vars
      jest.resetModules();
      const { adminAuth: freshAdminAuth } = require("../src/utils/adminAuth");

      freshAdminAuth(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: "ADMIN_NOT_CONFIGURED" }),
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it("should accept valid API key in Authorization header", () => {
      process.env.ADMIN_API_KEY = "test-secret-key-12345";
      jest.resetModules();
      const { adminAuth: freshAdminAuth } = require("../src/utils/adminAuth");

      mockReq.headers.authorization = "Bearer test-secret-key-12345";

      freshAdminAuth(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.adminAuth).toEqual(
        expect.objectContaining({ method: "api_key" }),
      );
    });

    it("should accept valid API key in X-API-Key header", () => {
      process.env.ADMIN_API_KEY = "test-secret-key-12345";
      jest.resetModules();
      const { adminAuth: freshAdminAuth } = require("../src/utils/adminAuth");

      mockReq.headers["x-api-key"] = "test-secret-key-12345";

      freshAdminAuth(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it("should accept valid API key in query parameter", () => {
      process.env.ADMIN_API_KEY = "test-secret-key-12345";
      jest.resetModules();
      const { adminAuth: freshAdminAuth } = require("../src/utils/adminAuth");

      mockReq.query.api_key = "test-secret-key-12345";

      freshAdminAuth(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it("should reject invalid API key", () => {
      process.env.ADMIN_API_KEY = "test-secret-key-12345";
      process.env.NODE_ENV = "production";
      jest.resetModules();
      const { adminAuth: freshAdminAuth } = require("../src/utils/adminAuth");

      mockReq.headers.authorization = "Bearer wrong-key";

      freshAdminAuth(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: "INVALID_API_KEY" }),
      );
    });

    it("should allow localhost access in development mode", () => {
      process.env.NODE_ENV = "development";
      jest.resetModules();
      const { adminAuth: freshAdminAuth } = require("../src/utils/adminAuth");

      mockReq.socket.remoteAddress = "127.0.0.1";

      freshAdminAuth(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.adminAuth).toEqual(
        expect.objectContaining({ method: "localhost" }),
      );
    });
  });

  describe("optionalAdminAuth", () => {
    it("should set isAdmin to false when not authenticated", () => {
      process.env.NODE_ENV = "production";
      jest.resetModules();
      const {
        optionalAdminAuth: freshOptionalAdminAuth,
      } = require("../src/utils/adminAuth");

      freshOptionalAdminAuth(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.isAdmin).toBe(false);
    });

    it("should set isAdmin to true when API key is valid", () => {
      process.env.ADMIN_API_KEY = "test-secret-key-12345";
      jest.resetModules();
      const {
        optionalAdminAuth: freshOptionalAdminAuth,
      } = require("../src/utils/adminAuth");

      mockReq.headers.authorization = "Bearer test-secret-key-12345";

      freshOptionalAdminAuth(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.isAdmin).toBe(true);
    });
  });
});
