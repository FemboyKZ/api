const {
  STEAM_BASE_ID,
  isValidIP,
  isValidPort,
  isValidSteamID,
  convertToSteamID64,
  sanitizeString,
  validatePagination,
  sanitizePlayerName,
  sanitizeMapName,
  isValidDiscordId,
  isValidHexColor,
} = require("../src/utils/validators");

describe("Validators", () => {
  describe("isValidDiscordId", () => {
    it("accepts 17 to 20 digit snowflakes", () => {
      expect(isValidDiscordId("12345678901234567")).toBe(true); // 17
      expect(isValidDiscordId("123456789012345678")).toBe(true); // 18
      expect(isValidDiscordId("1234567890123456789")).toBe(true); // 19
      expect(isValidDiscordId("12345678901234567890")).toBe(true); // 20
    });

    it("rejects lengths no real snowflake has", () => {
      expect(isValidDiscordId("1234567890123456")).toBe(false); // 16
      expect(isValidDiscordId("123456789012345678901")).toBe(false); // 21
    });

    it("rejects non-digits and empty input", () => {
      expect(isValidDiscordId("12345678901234567a")).toBe(false);
      expect(isValidDiscordId("")).toBe(false);
      expect(isValidDiscordId(null)).toBe(false);
      expect(isValidDiscordId(undefined)).toBe(false);
    });
  });

  describe("isValidHexColor", () => {
    it("accepts six hex digits with or without a leading hash", () => {
      expect(isValidHexColor("#ff0000")).toBe(true);
      expect(isValidHexColor("FF00AA")).toBe(true);
    });

    it("rejects wrong lengths, bad characters and empty input", () => {
      expect(isValidHexColor("#fff")).toBe(false);
      expect(isValidHexColor("#gg0000")).toBe(false);
      expect(isValidHexColor("")).toBe(false);
      expect(isValidHexColor(null)).toBe(false);
    });
  });

  describe("STEAM_BASE_ID", () => {
    it("is the SteamID64 offset", () => {
      expect(STEAM_BASE_ID).toBe(BigInt("76561197960265728"));
    });
  });

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
      // Test with 18-digit SteamID64 (large account ID)
      expect(isValidSteamID("76561198445248030")).toBe(true);
    });

    it("should validate SteamID3", () => {
      expect(isValidSteamID("[U:1:12345]")).toBe(true);
      // Test with large account ID
      expect(isValidSteamID("[U:1:484982302]")).toBe(true);
    });

    it("should validate SteamID2", () => {
      expect(isValidSteamID("STEAM_0:1:12345")).toBe(true);
      expect(isValidSteamID("STEAM_1:0:67890")).toBe(true);
      // Test with large account ID
      expect(isValidSteamID("STEAM_1:0:242491151")).toBe(true);
    });

    it("should reject invalid SteamIDs", () => {
      expect(isValidSteamID("invalid")).toBe(false);
      expect(isValidSteamID("")).toBe(false);
    });
  });

  describe("convertToSteamID64", () => {
    it("should return SteamID64 as-is", () => {
      expect(convertToSteamID64("76561197960265729")).toBe("76561197960265729");
      expect(convertToSteamID64("76561198000000000")).toBe("76561198000000000");
      // Test with 18-digit SteamID64
      expect(convertToSteamID64("76561198445248030")).toBe("76561198445248030");
    });

    it("should convert SteamID2 to SteamID64", () => {
      // STEAM_0:1:0 -> AccountID = (0 * 2) + 1 = 1 -> 76561197960265729
      expect(convertToSteamID64("STEAM_0:1:0")).toBe("76561197960265729");
      expect(convertToSteamID64("STEAM_1:1:0")).toBe("76561197960265729");

      // STEAM_0:0:1 -> AccountID = (1 * 2) + 0 = 2 -> 76561197960265730
      expect(convertToSteamID64("STEAM_0:0:1")).toBe("76561197960265730");

      // STEAM_0:1:12345 -> AccountID = (12345 * 2) + 1 = 24691 -> 76561197960290419
      expect(convertToSteamID64("STEAM_0:1:12345")).toBe("76561197960290419");

      // STEAM_0:0:12345 -> AccountID = (12345 * 2) + 0 = 24690 -> 76561197960290418
      expect(convertToSteamID64("STEAM_0:0:12345")).toBe("76561197960290418");

      // Large account ID: STEAM_1:0:242491151 -> AccountID = (242491151 * 2) + 0 = 484982302
      expect(convertToSteamID64("STEAM_1:0:242491151")).toBe(
        "76561198445248030",
      );
    });

    it("should convert SteamID3 to SteamID64", () => {
      // [U:1:1] -> 76561197960265729
      expect(convertToSteamID64("[U:1:1]")).toBe("76561197960265729");

      // [U:1:24691] -> 76561197960265728 + 24691 = 76561197960290419
      expect(convertToSteamID64("[U:1:24691]")).toBe("76561197960290419");

      // [U:1:12345] -> 76561197960265728 + 12345 = 76561197960278073
      expect(convertToSteamID64("[U:1:12345]")).toBe("76561197960278073");
    });

    it("should return null for invalid input", () => {
      expect(convertToSteamID64("invalid")).toBe(null);
      expect(convertToSteamID64("")).toBe(null);
      expect(convertToSteamID64(null)).toBe(null);
      expect(convertToSteamID64(undefined)).toBe(null);
    });

    it("should handle real-world SteamID conversions correctly", () => {
      // Real example: STEAM_0:1:12345 should equal [U:1:24691]
      const steamid2 = convertToSteamID64("STEAM_0:1:12345");
      const steamid3 = convertToSteamID64("[U:1:24691]");
      expect(steamid2).toBe(steamid3);
      expect(steamid2).toBe("76561197960290419");
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

  describe("sanitizePlayerName", () => {
    it("should remove ASCII control characters (color codes)", () => {
      // Test ASCII control characters
      expect(sanitizePlayerName("Player\x07Name")).toBe("PlayerName");
      expect(sanitizePlayerName("\x01Test\x02Name\x03")).toBe("TestName");
    });

    it("should remove invisible Unicode formatting characters", () => {
      // U+2067 - RIGHT-TO-LEFT ISOLATE (the actual issue from user's report)
      expect(sanitizePlayerName("ily\u2067\u2067♥")).toBe("ily♥");

      // Zero-width spaces and joiners
      expect(sanitizePlayerName("Player\u200BName")).toBe("PlayerName");
      expect(sanitizePlayerName("Test\uFEFFName")).toBe("TestName");
      expect(sanitizePlayerName("Name\u200C\u200DTest")).toBe("NameTest");

      // Directional formatting marks
      expect(sanitizePlayerName("Test\u202AName\u202C")).toBe("TestName");
    });

    it("should KEEP visible Unicode symbols", () => {
      // Hearts, stars, and other visible symbols should be preserved
      expect(sanitizePlayerName("ily♥")).toBe("ily♥");
      expect(sanitizePlayerName("Player★Name")).toBe("Player★Name");
      expect(sanitizePlayerName("Test⚡Name")).toBe("Test⚡Name");
      expect(sanitizePlayerName("Cool😎Player")).toBe("Cool😎Player");

      // Non-ASCII alphabets should be preserved
      expect(sanitizePlayerName("Игрок")).toBe("Игрок"); // Cyrillic
      expect(sanitizePlayerName("玩家")).toBe("玩家"); // Chinese
      expect(sanitizePlayerName("プレイヤー")).toBe("プレイヤー"); // Japanese
    });

    it("should normalize whitespace", () => {
      expect(sanitizePlayerName("Player   Name")).toBe("Player Name");
      expect(sanitizePlayerName("Test\nName")).toBe("TestName");
      expect(sanitizePlayerName("My\t\tName")).toBe("MyName");
    });

    it("should trim leading and trailing whitespace", () => {
      expect(sanitizePlayerName("  PlayerName  ")).toBe("PlayerName");
      expect(sanitizePlayerName("\n\tTest\n\t")).toBe("Test");
    });

    it("should preserve valid ASCII characters", () => {
      expect(sanitizePlayerName("PlayerName123")).toBe("PlayerName123");
      expect(sanitizePlayerName("Test-Name_2024")).toBe("Test-Name_2024");
      expect(sanitizePlayerName("Player[TAG]Name")).toBe("Player[TAG]Name");
    });

    it("should return null for empty or invalid input", () => {
      expect(sanitizePlayerName("")).toBe(null);
      expect(sanitizePlayerName("   ")).toBe(null);
      expect(sanitizePlayerName("\u0001\u0002\u0003")).toBe(null);
      expect(sanitizePlayerName("\u2067\u2067\u2067")).toBe(null);
      expect(sanitizePlayerName(null)).toBe(null);
      expect(sanitizePlayerName(undefined)).toBe(null);
    });

    it("should handle complex real-world CS:GO/CS2 names", () => {
      // Name with color codes (\x07) - control chars removed but color values remain as text
      expect(sanitizePlayerName("\x07FF0000Red\x07FFFFFF Name")).toBe(
        "FF0000RedFFFFFF Name",
      );

      // Name with various control characters mixed in
      expect(sanitizePlayerName("\x01\x02\x03Player\x04\x05")).toBe("Player");

      // The actual user's case: invisible U+2067 removed, heart kept
      expect(sanitizePlayerName("ily\u2067\u2067♥")).toBe("ily♥");

      // Name that becomes empty after sanitization
      expect(sanitizePlayerName("\x01\x02\x03\x04\x05")).toBe(null);
    });
  });

  describe("sanitizeMapName", () => {
    it("should handle URL-encoded workshop paths", () => {
      expect(
        sanitizeMapName("workshop%2F793414645%2Fkz_2seasons_winter_final"),
      ).toBe("kz_2seasons_winter_final");
    });

    it("should handle regular workshop paths", () => {
      expect(sanitizeMapName("workshop/793414645/kz_synergy_x")).toBe(
        "kz_synergy_x",
      );
      expect(sanitizeMapName("workshop\\793414645\\de_dust2")).toBe("de_dust2");
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
      expect(sanitizeMapName("workshop/123/kzpro_aircontrol")).toBe(
        "kzpro_aircontrol",
      );
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

  describe("validateSortField", () => {
    const { validateSortField } = require("../src/utils/validators");
    const validFields = ["name", "created", "updated", "records"];

    it("should return the sort field if it is valid", () => {
      expect(validateSortField("name", validFields, "created")).toBe("name");
      expect(validateSortField("updated", validFields, "created")).toBe(
        "updated",
      );
      expect(validateSortField("records", validFields, "created")).toBe(
        "records",
      );
    });

    it("should return the default field if sort is invalid", () => {
      expect(validateSortField("invalid", validFields, "created")).toBe(
        "created",
      );
      expect(validateSortField("", validFields, "name")).toBe("name");
      expect(validateSortField(undefined, validFields, "records")).toBe(
        "records",
      );
    });

    it("should return the default field if sort is null", () => {
      expect(validateSortField(null, validFields, "created")).toBe("created");
    });
  });

  describe("validateSortOrder", () => {
    const { validateSortOrder } = require("../src/utils/validators");

    it("should return ASC for 'asc' input", () => {
      expect(validateSortOrder("asc")).toBe("ASC");
      expect(validateSortOrder("asc", "ASC")).toBe("ASC");
      expect(validateSortOrder("asc", "DESC")).toBe("ASC");
    });

    it("should return DESC for 'desc' input", () => {
      expect(validateSortOrder("desc")).toBe("DESC");
      expect(validateSortOrder("desc", "ASC")).toBe("DESC");
      expect(validateSortOrder("desc", "DESC")).toBe("DESC");
    });

    it("should return default order for invalid input", () => {
      expect(validateSortOrder("invalid")).toBe("DESC");
      expect(validateSortOrder("")).toBe("DESC");
      expect(validateSortOrder(undefined)).toBe("DESC");
      expect(validateSortOrder(null)).toBe("DESC");
    });

    it("should use custom default order when provided", () => {
      expect(validateSortOrder("invalid", "ASC")).toBe("ASC");
      expect(validateSortOrder(undefined, "ASC")).toBe("ASC");
      expect(validateSortOrder("", "ASC")).toBe("ASC");
    });
  });

  describe("paginationMeta", () => {
    const {
      paginationMeta,
      validatePagination,
    } = require("../src/utils/validators");

    it("reports the page and limit it was given", () => {
      expect(paginationMeta(3, 20, 95)).toEqual({
        page: 3,
        limit: 20,
        total: 95,
        totalPages: 5,
      });
    });

    it("rounds partial pages up", () => {
      expect(paginationMeta(1, 10, 1).totalPages).toBe(1);
      expect(paginationMeta(1, 10, 10).totalPages).toBe(1);
      expect(paginationMeta(1, 10, 11).totalPages).toBe(2);
    });

    it("reports zero pages for an empty result", () => {
      expect(paginationMeta(1, 10, 0).totalPages).toBe(0);
    });

    it("stays consistent with validatePagination's clamping", () => {
      // A negative page must not be echoed back; the offset came from page 1.
      const { page, limit } = validatePagination(-5, 20);
      expect(paginationMeta(page, limit, 100).page).toBe(1);
    });
  });

  describe("defaultSortOrder", () => {
    const {
      defaultSortOrder,
      validateSortOrder,
    } = require("../src/utils/validators");

    it("sorts name-like fields A->Z", () => {
      for (const field of [
        "name",
        "map_name",
        "player_name",
        "server_name",
        "alias",
        "steamid",
        "steamid64",
      ]) {
        expect(defaultSortOrder(field)).toBe("ASC");
      }
    });

    it("sorts counts, points, times and dates highest/newest first", () => {
      for (const field of [
        "records",
        "points",
        "time",
        "created_on",
        "created",
        "last_played",
        "last_seen",
        "total_playtime",
        "distance",
        "difficulty",
        "jumpstats",
        "expires_on",
      ]) {
        expect(defaultSortOrder(field)).toBe("DESC");
      }
    });

    it("lets one route serve both directions depending on the field", () => {
      // The default follows the sort field, not the endpoint.
      expect(validateSortOrder(undefined, defaultSortOrder("name"))).toBe(
        "ASC",
      );
      expect(validateSortOrder(undefined, defaultSortOrder("records"))).toBe(
        "DESC",
      );
    });

    it("always honours an explicit order over the default", () => {
      expect(validateSortOrder("desc", defaultSortOrder("name"))).toBe("DESC");
      expect(validateSortOrder("asc", defaultSortOrder("records"))).toBe("ASC");
    });
  });

  describe("steamid32To64", () => {
    const { steamid32To64 } = require("../src/utils/validators");

    it("should convert steamid32 to steamid64", () => {
      // Account ID 1 -> 76561197960265729
      expect(steamid32To64(1)).toBe("76561197960265729");
      // Account ID 24691 -> 76561197960290419
      expect(steamid32To64(24691)).toBe("76561197960290419");
      // Large account ID: 484982302 -> 76561198445248030
      expect(steamid32To64(484982302)).toBe("76561198445248030");
    });

    it("should handle string input", () => {
      expect(steamid32To64("1")).toBe("76561197960265729");
      expect(steamid32To64("24691")).toBe("76561197960290419");
    });
  });

  describe("steamid64To32", () => {
    const { steamid64To32 } = require("../src/utils/validators");

    it("should convert steamid64 to steamid32", () => {
      expect(steamid64To32("76561197960265729")).toBe(1);
      expect(steamid64To32("76561197960290419")).toBe(24691);
      expect(steamid64To32("76561198445248030")).toBe(484982302);
    });

    it("should return account ID as number", () => {
      const result = steamid64To32("76561197960265729");
      expect(typeof result).toBe("number");
    });
  });
});
