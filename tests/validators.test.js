const {
  isValidIP,
  isValidPort,
  isValidSteamID,
  sanitizeString,
  validatePagination,
  sanitizeMapName,
} = require("../src/utils/validators");

describe("Validators", () => {
  describe("isValidIP", () => {
    it("should validate IPv4 addresses", () => {
      expect(isValidIP("192.168.1.1")).toBe(true);
      expect(isValidIP("10.0.0.1")).toBe(true);
      expect(isValidIP("255.255.255.255")).toBe(true);
    });

    it("should validate IPv6 addresses", () => {
      expect(isValidIP("2001:0db8:85a3:0000:0000:8a2e:0370:7334")).toBe(true);
      expect(isValidIP("::1")).toBe(true);
      expect(isValidIP("fe80::1")).toBe(true);
    });

    it("should reject invalid IPs", () => {
      expect(isValidIP("256.1.1.1")).toBe(false);
      expect(isValidIP("not-an-ip")).toBe(false);
      expect(isValidIP("")).toBe(false);
    });
  });

  describe("isValidPort", () => {
    it("should validate port numbers", () => {
      expect(isValidPort(80)).toBe(true);
      expect(isValidPort(443)).toBe(true);
      expect(isValidPort(27015)).toBe(true);
      expect(isValidPort(65535)).toBe(true);
    });

    it("should reject invalid ports", () => {
      expect(isValidPort(0)).toBe(false);
      expect(isValidPort(65536)).toBe(false);
      expect(isValidPort(-1)).toBe(false);
      expect(isValidPort("not-a-number")).toBe(false);
    });
  });

  describe("isValidSteamID", () => {
    it("should validate SteamID64", () => {
      expect(isValidSteamID("76561198000000000")).toBe(true);
    });

    it("should validate SteamID3", () => {
      expect(isValidSteamID("[U:1:12345]")).toBe(true);
    });

    it("should validate SteamID2", () => {
      expect(isValidSteamID("STEAM_0:1:12345")).toBe(true);
      expect(isValidSteamID("STEAM_1:0:67890")).toBe(true);
    });

    it("should reject invalid SteamIDs", () => {
      expect(isValidSteamID("invalid")).toBe(false);
      expect(isValidSteamID("")).toBe(false);
    });
  });

  describe("sanitizeString", () => {
    it("should trim whitespace", () => {
      expect(sanitizeString("  test  ")).toBe("test");
    });

    it("should enforce max length", () => {
      expect(sanitizeString("12345678", 5)).toBe("12345");
    });

    it("should handle empty strings", () => {
      expect(sanitizeString("")).toBe("");
    });
  });

  describe("validatePagination", () => {
    it("should return default values for missing params", () => {
      const result = validatePagination();
      expect(result.page).toBe(1);
      expect(result.limit).toBe(10);
    });

    it("should parse valid pagination params", () => {
      const result = validatePagination("2", "20");
      expect(result.page).toBe(2);
      expect(result.limit).toBe(20);
    });

    it("should enforce maximum limit", () => {
      const result = validatePagination(undefined, "1000");
      expect(result.limit).toBe(100);
    });

    it("should default to 1 for invalid page", () => {
      const result = validatePagination("0");
      expect(result.page).toBe(1);
    });
  });

  describe("sanitizeMapName", () => {
    it("should handle URL-encoded workshop paths", () => {
      expect(sanitizeMapName("workshop%2F793414645%2Fkz_2seasons_winter_final"))
        .toBe("kz_2seasons_winter_final");
    });

    it("should handle regular workshop paths", () => {
      expect(sanitizeMapName("workshop/793414645/kz_synergy_x"))
        .toBe("kz_synergy_x");
      expect(sanitizeMapName("workshop\\793414645\\de_dust2"))
        .toBe("de_dust2");
    });

    it("should handle maps folder paths", () => {
      expect(sanitizeMapName("maps/kz_grotto")).toBe("kz_grotto");
    });

    it("should preserve plain map names", () => {
      expect(sanitizeMapName("kz_grotto")).toBe("kz_grotto");
      expect(sanitizeMapName("de_dust2")).toBe("de_dust2");
      expect(sanitizeMapName("cs_office")).toBe("cs_office");
    });

    it("should handle various map prefixes", () => {
      expect(sanitizeMapName("workshop/123/kzpro_aircontrol")).toBe("kzpro_aircontrol");
      expect(sanitizeMapName("workshop/123/surf_mesa")).toBe("surf_mesa");
      expect(sanitizeMapName("workshop/123/bhop_arcane")).toBe("bhop_arcane");
      expect(sanitizeMapName("workshop/123/aim_redline")).toBe("aim_redline");
    });

    it("should handle empty or invalid input", () => {
      expect(sanitizeMapName("")).toBe("");
      expect(sanitizeMapName(null)).toBe("");
      expect(sanitizeMapName(undefined)).toBe("");
    });

    it("should handle maps without standard prefixes by returning last part", () => {
      expect(sanitizeMapName("workshop/123/custom_map")).toBe("custom_map");
      expect(sanitizeMapName("maps/my_cool_map")).toBe("my_cool_map");
    });

    it("should trim whitespace", () => {
      expect(sanitizeMapName("  kz_grotto  ")).toBe("kz_grotto");
    });
  });
});
