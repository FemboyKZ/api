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

  describe("computeCompletionStats", () => {
    const { computeCompletionStats } = require("../src/utils/kzHelpers");

    const map = (pro, tp, difficulty = 1) => ({
      pro_time: pro,
      tp_time: tp,
      difficulty,
    });

    it("classifies each map as pro, tp-only or not completed", () => {
      const stats = computeCompletionStats([
        map(12.5, null),
        map(12.5, 30.0), // a pro time wins even when a TP time also exists
        map(null, 30.0),
        map(null, null),
      ]);

      expect(stats).toMatchObject({
        total_maps: 4,
        completed_pro: 2,
        completed_tp_only: 1,
        not_completed: 1,
      });
    });

    it("breaks the same totals down by difficulty tier", () => {
      const stats = computeCompletionStats([
        map(12.5, null, 3),
        map(null, 30.0, 3),
        map(null, null, 3),
        map(12.5, null, 7),
      ]);

      expect(stats.by_difficulty[3]).toEqual({
        total: 3,
        completed_pro: 1,
        completed_tp: 1,
        completed_any: 2,
      });
      expect(stats.by_difficulty[7]).toEqual({
        total: 1,
        completed_pro: 1,
        completed_tp: 0,
        completed_any: 1,
      });
    });

    it("counts a map with both times under pro, tp and any", () => {
      const stats = computeCompletionStats([map(12.5, 30.0, 2)]);
      expect(stats.by_difficulty[2]).toEqual({
        total: 1,
        completed_pro: 1,
        completed_tp: 1,
        completed_any: 1,
      });
    });

    it("files maps with no tier under 0", () => {
      const stats = computeCompletionStats([map(12.5, null, null)]);
      expect(stats.by_difficulty[0].completed_pro).toBe(1);
    });

    it("returns zeroed totals for no maps", () => {
      expect(computeCompletionStats([])).toEqual({
        total_maps: 0,
        completed_pro: 0,
        completed_tp_only: 0,
        not_completed: 0,
        by_difficulty: {},
      });
    });
  });

  describe("toCountQuery", () => {
    const { toCountQuery } = require("../src/utils/kzHelpers");
    const flat = (sql) => sql.replace(/\s+/g, " ").trim();

    it("replaces the projection with COUNT(*) and keeps the rest", () => {
      const query = `
        SELECT b.id, b.ban_type, s.server_name
        FROM kz_bans b
        LEFT JOIN kz_servers s ON b.server_id = s.server_id
        WHERE 1=1 AND b.ban_type = ?
      `;
      expect(flat(toCountQuery(query))).toBe(
        "SELECT COUNT(*) as total FROM kz_bans b " +
          "LEFT JOIN kz_servers s ON b.server_id = s.server_id " +
          "WHERE 1=1 AND b.ban_type = ?",
      );
    });

    it("anchors on the first FROM, not the last", () => {
      // A greedy match would anchor on the subquery's FROM.
      const query =
        "SELECT id FROM kz_records r WHERE r.id IN (SELECT id FROM other)";
      expect(toCountQuery(query)).toBe(
        "SELECT COUNT(*) as total FROM kz_records r WHERE r.id IN (SELECT id FROM other)",
      );
    });

    it("is unbothered by a multi-line projection", () => {
      const query = `
        SELECT
          a,
          CASE WHEN x THEN 1 ELSE 0 END as flag
        FROM t
        WHERE 1=1
      `;
      expect(flat(toCountQuery(query))).toBe(
        "SELECT COUNT(*) as total FROM t WHERE 1=1",
      );
    });
  });
});
