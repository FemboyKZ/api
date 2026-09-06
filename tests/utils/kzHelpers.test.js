const {
  formatRuntimeMs,
  formatDistance,
  formatStat,
  formatAirtime,
  getYearlyPartitionHint,
  getPlayerPartitionHint,
} = require("../../src/utils/kzHelpers");

describe("KZ Helpers", () => {
  // Every stat comes off the wire as an integer; each formatter divides by its own scale.
  describe("Format Functions", () => {
    it.each([
      ["formatRuntimeMs", formatRuntimeMs, 1000, 1],
      ["formatRuntimeMs", formatRuntimeMs, 1500, 1.5],
      ["formatRuntimeMs", formatRuntimeMs, 1234, 1.234],
      ["formatRuntimeMs", formatRuntimeMs, 0, 0],
      ["formatDistance", formatDistance, 10000, 1],
      ["formatDistance", formatDistance, 25000, 2.5],
      ["formatDistance", formatDistance, 2885000, 288.5],
      ["formatDistance", formatDistance, 0, 0],
      ["formatStat", formatStat, 100, 1],
      ["formatStat", formatStat, 250, 2.5],
      ["formatStat", formatStat, 9999, 99.99],
      ["formatStat", formatStat, 0, 0],
    ])("%s(%p) is %p", (_name, format, input, expected) => {
      expect(format(input)).toBe(expected);
    });

    it.each([
      [64, undefined, 1],
      [128, undefined, 2],
      [32, undefined, 0.5],
      [0, undefined, 0],
      [128, 128, 1],
      [64, 128, 0.5],
      [0, 128, 0],
    ])(
      "formatAirtime(%p ticks, %p tickrate) is %p seconds",
      (ticks, tickrate, expected) => {
        expect(
          tickrate === undefined
            ? formatAirtime(ticks)
            : formatAirtime(ticks, tickrate),
        ).toBe(expected);
      },
    );
  });

  describe("Query Helpers", () => {
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
    const { computeCompletionStats } = require("../../src/utils/kzHelpers");

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
    const { toCountQuery } = require("../../src/utils/kzHelpers");
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
