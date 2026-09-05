// processCS2Filter and processCSGOFilter share one implementation.
// Pins the SQL each variant emits, since the non-dry-run path copies rows then DELETEs them.

jest.mock("../src/db/kzLocal", () => ({
  getKzLocalCS2Pool: jest.fn(),
  getKzLocalCSGO128Pool: jest.fn(),
  getKzLocalCSGO64Pool: jest.fn(),
}));

const {
  processCS2Filter,
  processCSGOFilter,
} = require("../src/services/jumpstatCleanup");

const FILTER = {
  id: "impossible_lj",
  name: "Impossible longjump",
  enabled: true,
  jump_type: 0,
  conditions: [{ field: "distance", operator: ">", value: 300 }],
};

// Collapse whitespace so formatting differences don't matter.
const flat = (sql) => sql.replace(/\s+/g, " ").trim();

function fakePool() {
  const queries = [];
  const connection = {
    query: jest.fn(async (sql, params) => {
      queries.push({ sql, params });
      return [{ affectedRows: 7 }];
    }),
    beginTransaction: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    release: jest.fn(),
  };
  return {
    queries,
    connection,
    query: jest.fn(async (sql, params) => {
      queries.push({ sql, params });
      return [[{ count: 12 }]];
    }),
    getConnection: jest.fn().mockResolvedValue(connection),
  };
}

const CS2_COLUMNS =
  "ID, SteamID64, JumpType, Mode, Distance, IsBlockJump, Block, Strafes, Sync, Pre, Max, Airtime, Created";
const CSGO_COLUMNS =
  "JumpID, SteamID32, JumpType, Mode, Distance, IsBlockJump, Block, Strafes, Sync, Pre, Max, Airtime, Created";

describe("CS2 filter SQL", () => {
  it("quarantines with the CS2 identity columns, then deletes the same rows", async () => {
    const pool = fakePool();
    const result = await processCS2Filter(pool, FILTER, { dryRun: false });

    const insert = pool.queries.find((q) => q.sql.includes("INSERT INTO"));
    const del = pool.queries.find((q) => q.sql.includes("DELETE FROM"));

    expect(flat(insert.sql)).toContain(
      `INSERT INTO Jumpstats_Quarantine ( ${CS2_COLUMNS}, filter_id, filter_name, filter_conditions, quarantined_by )`,
    );
    expect(flat(insert.sql)).toContain(`SELECT ${CS2_COLUMNS}, ?, ?, ?, ?`);

    // The copy and the delete must select exactly the same rows.
    const where = (sql) => flat(sql).split("WHERE ")[1];
    expect(where(del.sql)).toBe(where(insert.sql));
    expect(del.params).toEqual(insert.params.slice(4));

    expect(result).toMatchObject({
      game: "cs2",
      matched: 12,
      quarantined: 7,
      dry_run: false,
    });
  });

  it("counts without touching anything in dry-run mode", async () => {
    const pool = fakePool();
    const result = await processCS2Filter(pool, FILTER, { dryRun: true });

    expect(pool.getConnection).not.toHaveBeenCalled();
    expect(pool.queries).toHaveLength(1);
    expect(pool.queries[0].sql).toContain("SELECT COUNT(*)");
    expect(result).toMatchObject({
      matched: 12,
      quarantined: 0,
      dry_run: true,
    });
  });
});

describe("CSGO filter SQL", () => {
  it("quarantines with the CSGO identity columns and labels the tickrate", async () => {
    const pool = fakePool();
    const result = await processCSGOFilter(
      pool,
      FILTER,
      { dryRun: false },
      "64",
    );

    const insert = pool.queries.find((q) => q.sql.includes("INSERT INTO"));
    expect(flat(insert.sql)).toContain(
      `INSERT INTO Jumpstats_Quarantine ( ${CSGO_COLUMNS}, filter_id, filter_name, filter_conditions, quarantined_by )`,
    );
    expect(result.game).toBe("csgo64");
  });

  it("defaults to the 128 tick label", async () => {
    const pool = fakePool();
    const result = await processCSGOFilter(pool, FILTER, { dryRun: true });
    expect(result.game).toBe("csgo128");
  });
});

describe("failure handling", () => {
  it("rolls back and reports the error instead of throwing", async () => {
    const pool = fakePool();
    pool.connection.query.mockRejectedValueOnce(new Error("table is gone"));

    const result = await processCS2Filter(pool, FILTER, { dryRun: false });

    expect(pool.connection.rollback).toHaveBeenCalled();
    expect(pool.connection.release).toHaveBeenCalled();
    expect(result).toMatchObject({
      game: "cs2",
      matched: 0,
      quarantined: 0,
      error: "table is gone",
    });
  });

  it("does nothing when no rows match", async () => {
    const pool = fakePool();
    pool.query.mockResolvedValueOnce([[{ count: 0 }]]);

    const result = await processCS2Filter(pool, FILTER, { dryRun: false });
    expect(pool.getConnection).not.toHaveBeenCalled();
    expect(result).toMatchObject({ matched: 0, quarantined: 0 });
  });
});
