const {
  // Constants
  KZ_MODES,
  CS2_MODES,
  JUMP_TYPES,
  AIR_TYPES,
  BHOP_STAT_TYPES,
  SCROLL_EFF_TYPES,
  STEAM_BASE_ID,
  // SteamID conversion
  steamid32To64,
  steamid64To32,
  // Formatting
  formatRuntimeMs,
  formatRuntimeSeconds,
  formatDistance,
  formatStat,
  formatAirtime,
  // Query helpers
  validateSortField,
  validateSortOrder,
  getYearlyPartitionHint,
  getPlayerPartitionHint,
} = require("../src/utils/kzHelpers");

describe("KZ Helpers", () => {
  describe("Constants", () => {
    it("should have KZ_MODES with correct values", () => {
      expect(KZ_MODES[0]).toBe("vanilla");
      expect(KZ_MODES[1]).toBe("simplekz");
      expect(KZ_MODES[2]).toBe("kztimer");
      expect(Object.keys(KZ_MODES).length).toBe(3);
    });

    it("should have CS2_MODES with correct values", () => {
      expect(CS2_MODES[1]).toBe("classic");
      expect(CS2_MODES[2]).toBe("vanilla");
      expect(Object.keys(CS2_MODES).length).toBe(2);
    });

    it("should have JUMP_TYPES with correct values", () => {
      expect(JUMP_TYPES[0]).toBe("longjump");
      expect(JUMP_TYPES[1]).toBe("bhop");
      expect(JUMP_TYPES[2]).toBe("multibhop");
      expect(JUMP_TYPES[3]).toBe("weirdjump");
      expect(JUMP_TYPES[4]).toBe("ladderjump");
      expect(JUMP_TYPES[5]).toBe("ladderhop");
      expect(JUMP_TYPES[6]).toBe("jumpbug");
      expect(JUMP_TYPES[7]).toBe("lowprebhop");
      expect(JUMP_TYPES[8]).toBe("lowpreweirdjump");
      expect(Object.keys(JUMP_TYPES).length).toBe(9);
    });

    it("should have AIR_TYPES with correct values", () => {
      expect(AIR_TYPES[0]).toBe("air_time");
      expect(AIR_TYPES[1]).toBe("strafes");
      expect(AIR_TYPES[2]).toBe("overlap");
      expect(AIR_TYPES[3]).toBe("dead_air");
      expect(AIR_TYPES[4]).toBe("bad_angles");
      expect(AIR_TYPES[5]).toBe("air_accel_time");
      expect(AIR_TYPES[6]).toBe("air_vel_change_time");
    });

    it("should have BHOP_STAT_TYPES with correct values", () => {
      expect(BHOP_STAT_TYPES[0]).toBe("bhop_ticks");
      expect(BHOP_STAT_TYPES[1]).toBe("perf_streaks");
      expect(BHOP_STAT_TYPES[2]).toBe("scroll_efficiency");
      expect(BHOP_STAT_TYPES[3]).toBe("strafe_count");
      expect(BHOP_STAT_TYPES[4]).toBe("gokz_perf_count");
    });

    it("should have SCROLL_EFF_TYPES with correct values", () => {
      expect(SCROLL_EFF_TYPES[0]).toBe("registered_scrolls");
      expect(SCROLL_EFF_TYPES[1]).toBe("fast_scrolls");
      expect(SCROLL_EFF_TYPES[2]).toBe("slow_scrolls");
      expect(SCROLL_EFF_TYPES[3]).toBe("timing_total");
      expect(SCROLL_EFF_TYPES[4]).toBe("timing_samples");
    });

    it("should have correct STEAM_BASE_ID", () => {
      expect(STEAM_BASE_ID).toBe(BigInt("76561197960265728"));
    });
  });

  describe("SteamID Conversion", () => {
    describe("steamid32To64", () => {
      it("should convert SteamID32 to SteamID64", () => {
        // Account ID 1 = 76561197960265729
        expect(steamid32To64(1)).toBe("76561197960265729");

        // Account ID 24691 = 76561197960290419
        expect(steamid32To64(24691)).toBe("76561197960290419");

        // Account ID 484982302 = 76561198445248030
        expect(steamid32To64(484982302)).toBe("76561198445248030");
      });

      it("should handle string input", () => {
        expect(steamid32To64("1")).toBe("76561197960265729");
        expect(steamid32To64("484982302")).toBe("76561198445248030");
      });

      it("should handle zero", () => {
        expect(steamid32To64(0)).toBe("76561197960265728");
      });
    });

    describe("steamid64To32", () => {
      it("should convert SteamID64 to SteamID32", () => {
        expect(steamid64To32("76561197960265729")).toBe(1);
        expect(steamid64To32("76561197960290419")).toBe(24691);
        expect(steamid64To32("76561198445248030")).toBe(484982302);
      });

      it("should handle base SteamID64", () => {
        expect(steamid64To32("76561197960265728")).toBe(0);
      });
    });

    it("should be reversible conversions", () => {
      const testIds = [1, 12345, 24691, 484982302, 1000000000];

      testIds.forEach((steamid32) => {
        const steamid64 = steamid32To64(steamid32);
        const backToSteamid32 = steamid64To32(steamid64);
        expect(backToSteamid32).toBe(steamid32);
      });
    });
  });

  describe("Format Functions", () => {
    describe("formatRuntimeMs", () => {
      it("should convert milliseconds to seconds", () => {
        expect(formatRuntimeMs(1000)).toBe(1);
        expect(formatRuntimeMs(1500)).toBe(1.5);
        expect(formatRuntimeMs(60000)).toBe(60);
        expect(formatRuntimeMs(0)).toBe(0);
      });

      it("should handle decimal values", () => {
        expect(formatRuntimeMs(1234)).toBe(1.234);
      });
    });

    describe("formatRuntimeSeconds", () => {
      it("should pass through values unchanged", () => {
        expect(formatRuntimeSeconds(1)).toBe(1);
        expect(formatRuntimeSeconds(1.5)).toBe(1.5);
        expect(formatRuntimeSeconds(60)).toBe(60);
        expect(formatRuntimeSeconds(0)).toBe(0);
      });
    });

    describe("formatDistance", () => {
      it("should convert distance units", () => {
        expect(formatDistance(10000)).toBe(1);
        expect(formatDistance(25000)).toBe(2.5);
        expect(formatDistance(2885000)).toBe(288.5);
        expect(formatDistance(0)).toBe(0);
      });
    });

    describe("formatStat", () => {
      it("should convert stat values", () => {
        expect(formatStat(100)).toBe(1);
        expect(formatStat(250)).toBe(2.5);
        expect(formatStat(9999)).toBe(99.99);
        expect(formatStat(0)).toBe(0);
      });
    });

    describe("formatAirtime", () => {
      it("should convert ticks to seconds with default tickrate", () => {
        // Default tickrate is 64
        expect(formatAirtime(64)).toBe(1);
        expect(formatAirtime(128)).toBe(2);
        expect(formatAirtime(32)).toBe(0.5);
      });

      it("should use custom tickrate", () => {
        // CS:GO 128 tick
        expect(formatAirtime(128, 128)).toBe(1);
        expect(formatAirtime(64, 128)).toBe(0.5);
      });

      it("should handle zero", () => {
        expect(formatAirtime(0)).toBe(0);
        expect(formatAirtime(0, 128)).toBe(0);
      });
    });
  });

  describe("Query Helpers", () => {
    describe("validateSortField", () => {
      const validFields = ["name", "date", "score", "time"];

      it("should return valid sort field", () => {
        expect(validateSortField("name", validFields, "date")).toBe("name");
        expect(validateSortField("score", validFields, "date")).toBe("score");
      });

      it("should return default for invalid sort field", () => {
        expect(validateSortField("invalid", validFields, "date")).toBe("date");
        expect(validateSortField("", validFields, "date")).toBe("date");
        expect(validateSortField(null, validFields, "date")).toBe("date");
        expect(validateSortField(undefined, validFields, "date")).toBe("date");
      });
    });

    describe("validateSortOrder", () => {
      it("should return ASC for asc input", () => {
        expect(validateSortOrder("asc")).toBe("ASC");
      });

      it("should return DESC for desc input", () => {
        expect(validateSortOrder("desc")).toBe("DESC");
      });

      it("should return default for invalid input", () => {
        expect(validateSortOrder("invalid")).toBe("DESC");
        expect(validateSortOrder("")).toBe("DESC");
        expect(validateSortOrder(null)).toBe("DESC");
        expect(validateSortOrder(undefined)).toBe("DESC");
      });

      it("should use custom default order", () => {
        expect(validateSortOrder("invalid", "ASC")).toBe("ASC");
        expect(validateSortOrder(null, "ASC")).toBe("ASC");
      });
    });

    describe("getYearlyPartitionHint", () => {
      it("should return empty string without options and not optimizable", () => {
        expect(getYearlyPartitionHint()).toBe("");
        expect(getYearlyPartitionHint({})).toBe("");
      });

      it("should return recent partitions for recentOnly option", () => {
        const result = getYearlyPartitionHint({ recentOnly: true });
        const currentYear = new Date().getFullYear();
        expect(result).toContain(`p${currentYear}`);
        expect(result).toContain(`p${currentYear - 1}`);
        expect(result).toContain("pfuture");
        expect(result).toMatch(/^PARTITION \(/);
      });

      it("should optimize for DESC created_on sort", () => {
        const result = getYearlyPartitionHint({
          sortField: "created_on",
          sortOrder: "DESC",
        });
        const currentYear = new Date().getFullYear();
        expect(result).toContain(`p${currentYear}`);
        expect(result).toContain("pfuture");
      });

      it("should include p_old for dates before 2018", () => {
        const result = getYearlyPartitionHint({
          dateFrom: "2015-01-01",
          dateTo: "2017-12-31",
        });
        expect(result).toContain("p_old");
        expect(result).not.toContain("p2018");
      });

      it("should include specific year partitions for date range", () => {
        const result = getYearlyPartitionHint({
          dateFrom: "2020-01-01",
          dateTo: "2022-12-31",
        });
        expect(result).toContain("p2020");
        expect(result).toContain("p2021");
        expect(result).toContain("p2022");
        expect(result).not.toContain("p2019");
        expect(result).not.toContain("p2023");
      });

      it("should include pfuture for current/future dates", () => {
        const currentYear = new Date().getFullYear();
        const result = getYearlyPartitionHint({
          dateFrom: `${currentYear}-01-01`,
        });
        expect(result).toContain("pfuture");
      });

      it("should handle date range spanning old and new partitions", () => {
        const result = getYearlyPartitionHint({
          dateFrom: "2016-01-01",
          dateTo: "2020-12-31",
        });
        expect(result).toContain("p_old");
        expect(result).toContain("p2018");
        expect(result).toContain("p2019");
        expect(result).toContain("p2020");
      });
    });

    describe("getPlayerPartitionHint", () => {
      it("should return empty string without year filter", () => {
        expect(getPlayerPartitionHint()).toBe("");
        expect(getPlayerPartitionHint(null)).toBe("");
        expect(getPlayerPartitionHint(undefined)).toBe("");
      });

      it("should return p_old for years before 2018", () => {
        const result = getPlayerPartitionHint(2015);
        expect(result).toContain("p_old");
      });

      it("should return specific partition for valid year", () => {
        const result = getPlayerPartitionHint(2020);
        expect(result).toBe("PARTITION (p2020)");
      });

      it("should include pfuture for current year", () => {
        const currentYear = new Date().getFullYear();
        const result = getPlayerPartitionHint(currentYear);
        expect(result).toContain(`p${currentYear}`);
        expect(result).toContain("pfuture");
      });

      it("should handle string year input", () => {
        const result = getPlayerPartitionHint("2020");
        expect(result).toBe("PARTITION (p2020)");
      });
    });
  });
});
