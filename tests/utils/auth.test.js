const {
  adminAuth,
  optionalAdminAuth,
  generateAPIKey,
  getClientIP,
  isLocalhost,
  isWhitelisted,
} = require("../../src/utils/auth");

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
    // Both are read at module load, so each config needs a fresh module.
    const loadAuth = (env = {}) => {
      let mod;
      jest.isolateModules(() => {
        const saved = { ...process.env };
        Object.assign(process.env, env);
        mod = require("../../src/utils/auth");
        process.env = saved;
      });
      return mod;
    };

    describe("with no proxy in front (direct connections)", () => {
      it("ignores X-Forwarded-For and uses the socket address", () => {
        const { getClientIP: get } = loadAuth();
        const req = {
          headers: { "x-forwarded-for": "203.0.113.195" },
          socket: { remoteAddress: "192.168.1.100" },
        };
        // Believing the header here would let any caller claim a whitelisted IP.
        expect(get(req)).toBe("192.168.1.100");
      });

      it("ignores X-Real-IP and uses the socket address", () => {
        const { getClientIP: get } = loadAuth();
        const req = {
          headers: { "x-real-ip": "203.0.113.195" },
          socket: { remoteAddress: "192.168.1.100" },
        };
        expect(get(req)).toBe("192.168.1.100");
      });
    });

    describe("behind one reverse proxy", () => {
      const oneHop = () => loadAuth({ HOST: "127.0.0.1" });

      it("uses the only X-Forwarded-For entry when the client sent none", () => {
        const { getClientIP: get } = oneHop();
        const req = {
          headers: { "x-forwarded-for": "203.0.113.195" },
          socket: { remoteAddress: "127.0.0.1" },
        };
        expect(get(req)).toBe("203.0.113.195");
      });

      it("ignores entries the client prepended to X-Forwarded-For", () => {
        const { getClientIP: get } = oneHop();
        const req = {
          // The proxy appends what it saw, so the real client is last.
          headers: { "x-forwarded-for": "1.2.3.4, 203.0.113.195" },
          socket: { remoteAddress: "127.0.0.1" },
        };
        expect(get(req)).toBe("203.0.113.195");
      });

      it("falls back to X-Real-IP when there is no forwarded chain", () => {
        const { getClientIP: get } = oneHop();
        const req = {
          headers: { "x-real-ip": "203.0.113.195" },
          socket: { remoteAddress: "127.0.0.1" },
        };
        expect(get(req)).toBe("203.0.113.195");
      });
    });

    describe("behind two reverse proxies", () => {
      const twoHops = () =>
        loadAuth({ TRUST_PROXY: "true", TRUST_PROXY_HOPS: "2" });

      it("counts back two entries to find the client", () => {
        const { getClientIP: get } = twoHops();
        const req = {
          headers: { "x-forwarded-for": "203.0.113.195, 70.41.3.18" },
          socket: { remoteAddress: "127.0.0.1" },
        };
        expect(get(req)).toBe("203.0.113.195");
      });

      it("still ignores a client-prepended entry", () => {
        const { getClientIP: get } = twoHops();
        const req = {
          headers: {
            "x-forwarded-for": "1.2.3.4, 203.0.113.195, 70.41.3.18",
          },
          socket: { remoteAddress: "127.0.0.1" },
        };
        expect(get(req)).toBe("203.0.113.195");
      });

      it("uses the left-most entry when the chain is shorter than expected", () => {
        const { getClientIP: get } = twoHops();
        const req = {
          headers: { "x-forwarded-for": "203.0.113.195" },
          socket: { remoteAddress: "127.0.0.1" },
        };
        expect(get(req)).toBe("203.0.113.195");
      });
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
    it.each([
      ["127.0.0.1", true],
      ["::1", true],
      // Node reports a v4 loopback over a dual-stack socket in this form.
      ["::ffff:127.0.0.1", true],
      ["192.168.1.100", false],
    ])("%s is localhost: %p", (ip, expected) => {
      expect(isLocalhost(ip)).toBe(expected);
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
      const { adminAuth: freshAdminAuth } = require("../../src/utils/auth");

      freshAdminAuth(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: "ADMIN_NOT_CONFIGURED" }),
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    // The key is accepted from three places; anything else about the request is the same.
    it.each([
      [
        "the Authorization header",
        (req, key) => (req.headers.authorization = `Bearer ${key}`),
      ],
      ["the X-API-Key header", (req, key) => (req.headers["x-api-key"] = key)],
      ["a query parameter", (req, key) => (req.query.api_key = key)],
    ])("should accept a valid API key in %s", (_name, place) => {
      process.env.ADMIN_API_KEY = "test-secret-key-12345";
      jest.resetModules();
      const { adminAuth: freshAdminAuth } = require("../../src/utils/auth");

      place(mockReq, "test-secret-key-12345");

      freshAdminAuth(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.adminAuth).toEqual(
        expect.objectContaining({ method: "api_key" }),
      );
    });

    it("should reject invalid API key", () => {
      process.env.ADMIN_API_KEY = "test-secret-key-12345";
      process.env.NODE_ENV = "production";
      jest.resetModules();
      const { adminAuth: freshAdminAuth } = require("../../src/utils/auth");

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
      const { adminAuth: freshAdminAuth } = require("../../src/utils/auth");

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
      } = require("../../src/utils/auth");

      freshOptionalAdminAuth(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.isAdmin).toBe(false);
    });

    it("should set isAdmin to true when API key is valid", () => {
      process.env.ADMIN_API_KEY = "test-secret-key-12345";
      jest.resetModules();
      const {
        optionalAdminAuth: freshOptionalAdminAuth,
      } = require("../../src/utils/auth");

      mockReq.headers.authorization = "Bearer test-secret-key-12345";

      freshOptionalAdminAuth(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.isAdmin).toBe(true);
    });
  });
});
