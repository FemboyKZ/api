// tableExists guards optional tables and is called on every request,
// so its information_schema lookups are cached.

const mockQuery = jest.fn();
jest.mock("../src/db/kzRecords", () => ({
  getKzPool: () => ({ query: mockQuery }),
}));

const { tableExists } = require("../src/api/kzPlayers");

const found = () => mockQuery.mockResolvedValueOnce([[{ count: 1 }]]);
const missing = () => mockQuery.mockResolvedValueOnce([[{ count: 0 }]]);

beforeEach(() => {
  mockQuery.mockReset();
});

describe("tableExists caching", () => {
  it("queries information_schema once for a table that exists", async () => {
    found();

    await expect(tableExists("cached_present")).resolves.toBe(true);
    await expect(tableExists("cached_present")).resolves.toBe(true);
    await expect(tableExists("cached_present")).resolves.toBe(true);

    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0][1]).toEqual(["cached_present"]);
  });

  it("caches each table name separately", async () => {
    found();
    missing();

    await expect(tableExists("present_one")).resolves.toBe(true);
    await expect(tableExists("absent_one")).resolves.toBe(false);
    await expect(tableExists("present_one")).resolves.toBe(true);

    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it("re-checks a missing table after the recheck window", async () => {
    jest.useFakeTimers();
    try {
      missing();
      await expect(tableExists("appears_later")).resolves.toBe(false);

      // Still inside the window: no second lookup.
      jest.advanceTimersByTime(30_000);
      await expect(tableExists("appears_later")).resolves.toBe(false);
      expect(mockQuery).toHaveBeenCalledTimes(1);

      // Past it: the table has since been created by a migration.
      jest.advanceTimersByTime(31_000);
      found();
      await expect(tableExists("appears_later")).resolves.toBe(true);
      expect(mockQuery).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it("does not cache a failed lookup", async () => {
    mockQuery.mockRejectedValueOnce(new Error("connection lost"));
    await expect(tableExists("flaky")).resolves.toBe(false);

    found();
    await expect(tableExists("flaky")).resolves.toBe(true);
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });
});
