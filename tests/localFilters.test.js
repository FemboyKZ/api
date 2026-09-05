/**
 * Characterization tests for the local-timer filter branches.
 *
 * These pin the SQL and params each filter produces, including that the main query and its count query stay in step
 */
const request = require("supertest");
const express = require("express");

jest.mock("../src/db/kzLocal", () => ({
  getKzLocalCSGO128Pool: jest.fn(),
  getKzLocalCSGO64Pool: jest.fn(),
  getKzLocalCS2Pool: jest.fn(),
}));

jest.mock("../src/utils/logger", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

const {
  getKzLocalCSGO128Pool,
  getKzLocalCSGO64Pool,
  getKzLocalCS2Pool,
} = require("../src/db/kzLocal");

const gokzRouter = require("../src/api/local/gokz");
const cs2kzRouter = require("../src/api/local/cs2kz");

const app = express();
app.use(express.json());
app.use("/local/gokz", gokzRouter);
app.use("/local/cs2kz", cs2kzRouter);

// A SteamID64 and its SteamID32 equivalent, for the id-vs-name filter split.
const STEAMID64 = "76561197960287930";
const STEAMID32 = 22202;

describe("local timer filter branches", () => {
  let mockPool;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPool = { query: jest.fn() };
    getKzLocalCSGO128Pool.mockReturnValue(mockPool);
    getKzLocalCSGO64Pool.mockReturnValue(mockPool);
    getKzLocalCS2Pool.mockReturnValue(mockPool);
  });

  /** Every query the route issued, as [sql, params] pairs. */
  const calls = () => mockPool.query.mock.calls;

  describe("gokz /local/gokz/records", () => {
    it("course filter applies to both the rows query and the count query", async () => {
      mockPool.query
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([[{ total: 0 }]]);

      await request(app).get("/local/gokz/records?course=2").expect(200);

      const withCourse = calls().filter(([sql]) =>
        sql.includes("mc.Course = ?"),
      );
      expect(withCourse).toHaveLength(2);
      for (const [, params] of withCourse) expect(params).toContain(2);
    });

    it("course is coerced to an integer, not passed as a string", async () => {
      mockPool.query
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([[{ total: 0 }]]);

      await request(app).get("/local/gokz/records?course=3").expect(200);

      const [, params] = calls().find(([sql]) => sql.includes("mc.Course = ?"));
      expect(params).toContain(3);
      expect(params).not.toContain("3");
    });
  });

  describe("gokz /local/gokz/jumpstats", () => {
    it("a SteamID player filter matches on SteamID32", async () => {
      mockPool.query
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([[{ total: 0 }]]);

      await request(app)
        .get(`/local/gokz/jumpstats?player=${STEAMID64}`)
        .expect(200);

      const matched = calls().filter(([sql]) =>
        sql.includes("j.SteamID32 = ?"),
      );
      expect(matched).toHaveLength(2);
      for (const [, params] of matched) expect(params).toContain(STEAMID32);
    });

    it("a non-SteamID player filter falls back to an alias LIKE", async () => {
      mockPool.query
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([[{ total: 0 }]]);

      await request(app)
        .get("/local/gokz/jumpstats?player=somename")
        .expect(200);

      const matched = calls().filter(([sql]) => sql.includes("p.Alias LIKE ?"));
      expect(matched).toHaveLength(2);
      for (const [, params] of matched) {
        expect(params).toContain("%somename%");
      }
      expect(calls().some(([sql]) => sql.includes("j.SteamID32 = ?"))).toBe(
        false,
      );
    });

    it("mode filter applies to both queries as an integer", async () => {
      mockPool.query
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([[{ total: 0 }]]);

      await request(app).get("/local/gokz/jumpstats?mode=1").expect(200);

      const matched = calls().filter(([sql]) => sql.includes("j.Mode = ?"));
      expect(matched).toHaveLength(2);
      for (const [, params] of matched) expect(params).toContain(1);
    });
  });

  describe("cs2kz /local/cs2kz/records", () => {
    it("mode filter applies to both queries as an integer", async () => {
      mockPool.query
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([[{ total: 0 }]]);

      await request(app).get("/local/cs2kz/records?mode=2").expect(200);

      const matched = calls().filter(([sql]) => sql.includes("t.ModeID = ?"));
      expect(matched).toHaveLength(2);
      for (const [, params] of matched) expect(params).toContain(2);
    });

    it("course filter is a name LIKE here, unlike gokz's numeric course", async () => {
      mockPool.query
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([[{ total: 0 }]]);

      await request(app).get("/local/cs2kz/records?course=bonus").expect(200);

      const matched = calls().filter(([sql]) => sql.includes("mc.Name LIKE ?"));
      expect(matched).toHaveLength(2);
      for (const [, params] of matched) expect(params).toContain("%bonus%");
    });
  });

  describe("cs2kz /local/cs2kz/jumpstats", () => {
    it("a SteamID player filter matches on SteamID64", async () => {
      mockPool.query
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([[{ total: 0 }]]);

      await request(app)
        .get(`/local/cs2kz/jumpstats?player=${STEAMID64}`)
        .expect(200);

      const matched = calls().filter(([sql]) =>
        sql.includes("j.SteamID64 = ?"),
      );
      expect(matched).toHaveLength(2);
      for (const [, params] of matched) expect(params).toContain(STEAMID64);
    });

    it("a non-SteamID player filter falls back to an alias LIKE", async () => {
      mockPool.query
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([[{ total: 0 }]]);

      await request(app)
        .get("/local/cs2kz/jumpstats?player=somename")
        .expect(200);

      const matched = calls().filter(([sql]) => sql.includes("p.Alias LIKE ?"));
      expect(matched).toHaveLength(2);
      for (const [, params] of matched) expect(params).toContain("%somename%");
    });

    it("jump_type and mode filters both reach the count query", async () => {
      mockPool.query
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([[{ total: 0 }]]);

      await request(app)
        .get("/local/cs2kz/jumpstats?jump_type=6&mode=1")
        .expect(200);

      const jt = calls().filter(([sql]) => sql.includes("j.JumpType = ?"));
      const md = calls().filter(([sql]) => sql.includes("j.Mode = ?"));
      expect(jt).toHaveLength(2);
      expect(md).toHaveLength(2);
      for (const [, params] of jt) expect(params).toContain(6);
      for (const [, params] of md) expect(params).toContain(1);
    });
  });
  describe("cs2kz /local/cs2kz/records/top/:mapname", () => {
    // This route resolves the map first, then builds the leaderboard query.
    const mapLookup = () =>
      mockPool.query.mockResolvedValueOnce([[{ id: 1, name: "kz_test" }]]);

    it("course filter is an exact name match here, not a LIKE", async () => {
      mapLookup().mockResolvedValueOnce([[]]);

      await request(app)
        .get("/local/cs2kz/records/top/kz_test?course=main")
        .expect(200);

      const [, params] = calls().find(([sql]) => sql.includes("mc.Name = ?"));
      expect(params).toContain("main");
    });

    it("teleports=pro and teleports=tp select opposite sides", async () => {
      mapLookup().mockResolvedValueOnce([[]]);
      await request(app)
        .get("/local/cs2kz/records/top/kz_test?teleports=pro")
        .expect(200);
      expect(calls().some(([sql]) => sql.includes("t.Teleports = 0"))).toBe(
        true,
      );

      jest.clearAllMocks();
      getKzLocalCS2Pool.mockReturnValue(mockPool);
      mapLookup().mockResolvedValueOnce([[]]);
      await request(app)
        .get("/local/cs2kz/records/top/kz_test?teleports=tp")
        .expect(200);
      expect(calls().some(([sql]) => sql.includes("t.Teleports > 0"))).toBe(
        true,
      );
    });
  });
});
