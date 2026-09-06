const {
  tableExists,
  columnExists,
  resetSchemaCache,
  RECHECK_MS,
} = require("../src/db/schema");

const runnerReturning = (count) => ({
  query: jest.fn().mockResolvedValue([[{ count }]]),
});

describe("schema probes", () => {
  beforeEach(() => resetSchemaCache());

  it("reports whether a table exists", async () => {
    await expect(tableExists(runnerReturning(1), "kz_players")).resolves.toBe(
      true,
    );
    await expect(tableExists(runnerReturning(0), "nope")).resolves.toBe(false);
  });

  it("reports whether a column exists", async () => {
    const runner = runnerReturning(1);
    await expect(columnExists(runner, "kz_maps", "difficulty")).resolves.toBe(
      true,
    );
    expect(runner.query.mock.calls[0][1]).toEqual(["kz_maps", "difficulty"]);
  });

  it("caches a positive answer instead of re-querying", async () => {
    const runner = runnerReturning(1);
    await tableExists(runner, "kz_players");
    await tableExists(runner, "kz_players");
    expect(runner.query).toHaveBeenCalledTimes(1);
  });

  it("re-probes a missing table once the recheck window passes", async () => {
    const runner = runnerReturning(0);
    const now = jest.spyOn(Date, "now").mockReturnValue(0);

    await tableExists(runner, "later");
    await tableExists(runner, "later");
    expect(runner.query).toHaveBeenCalledTimes(1);

    now.mockReturnValue(RECHECK_MS + 1);
    await tableExists(runner, "later");
    expect(runner.query).toHaveBeenCalledTimes(2);

    now.mockRestore();
  });

  it("caches each table name separately", async () => {
    const runner = runnerReturning(1);
    await tableExists(runner, "a");
    await tableExists(runner, "b");
    await tableExists(runner, "a");
    expect(runner.query).toHaveBeenCalledTimes(2);
  });

  it("keeps answers separate per connection", async () => {
    const kz = runnerReturning(1);
    const main = runnerReturning(0);

    await expect(tableExists(kz, "shared_name")).resolves.toBe(true);
    await expect(tableExists(main, "shared_name")).resolves.toBe(false);
    expect(kz.query).toHaveBeenCalledTimes(1);
    expect(main.query).toHaveBeenCalledTimes(1);
  });

  it("returns false without caching when the probe itself fails", async () => {
    const runner = { query: jest.fn().mockRejectedValue(new Error("down")) };
    await expect(tableExists(runner, "x")).resolves.toBe(false);
    await tableExists(runner, "x");
    expect(runner.query).toHaveBeenCalledTimes(2);
  });
});
