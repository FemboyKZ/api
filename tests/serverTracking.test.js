// Session/map tracking is shared between the poller (services/serverUpdateLoop) and the plugin ingest (api/serverStatus).
// A server moving between them must keep one view of who is connected, so nobody gets a second open session.

const mockQuery = jest.fn().mockResolvedValue([{ affectedRows: 1 }]);
jest.mock("../src/db", () => ({ query: mockQuery }));

const {
  trackPlayerSessions,
  closeServerSessions,
  trackMapChange,
} = require("../src/services/servers/tracking");

// State is keyed by ip:port and lives for the process,
// so each test takes its own port rather than reaching into the module to reset it.
const IP = "10.0.0.1";
let PORT = 27015;

const player = (steamid, name = "Someone") => ({ steamid, name });

// Calls that opened a session, as steamids.
const joins = () =>
  mockQuery.mock.calls
    .filter(([sql]) => sql.includes("INSERT INTO player_sessions"))
    .map(([, params]) => params[0]);

// Calls that closed a session, as steamids.
const leaves = () =>
  mockQuery.mock.calls
    .filter(([sql]) => sql.includes("UPDATE player_sessions"))
    .map(([, params]) => params[0]);

const mapSql = () =>
  mockQuery.mock.calls
    .map(([sql]) => sql)
    .filter((sql) => sql.includes("map_history"));

beforeEach(() => {
  PORT += 1;
  mockQuery.mockClear();
});

describe("player sessions", () => {
  it("opens a session only for players who were not already connected", async () => {
    await trackPlayerSessions(IP, PORT, [player("1"), player("2")]);
    expect(joins()).toEqual(["1", "2"]);

    mockQuery.mockClear();
    await trackPlayerSessions(IP, PORT, [player("1"), player("2")]);
    expect(joins()).toEqual([]);
  });

  it("closes the session of a player who left", async () => {
    await trackPlayerSessions(IP, PORT, [player("1"), player("2")]);
    mockQuery.mockClear();

    await trackPlayerSessions(IP, PORT, [player("1")]);
    expect(leaves()).toEqual(["2"]);
    expect(joins()).toEqual([]);
  });

  it("does not reopen sessions when a server hands off between poll and live paths", async () => {
    // Poller observes two players, then the plugin reports the same roster.
    await trackPlayerSessions(IP, PORT, [player("1"), player("2")]);
    mockQuery.mockClear();

    await trackPlayerSessions(IP, PORT, [player("1"), player("2")]);
    expect(joins()).toEqual([]);
    expect(leaves()).toEqual([]);
  });

  it("closes every open session when a server goes offline", async () => {
    await trackPlayerSessions(IP, PORT, [player("1"), player("2")]);
    mockQuery.mockClear();

    await expect(closeServerSessions(IP, PORT)).resolves.toBe(2);
    expect(leaves().sort()).toEqual(["1", "2"]);
  });

  it("is a no-op when there is nobody to close out", async () => {
    await expect(closeServerSessions(IP, PORT)).resolves.toBe(0);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("treats a player as new again after the server went offline", async () => {
    await trackPlayerSessions(IP, PORT, [player("1")]);
    await closeServerSessions(IP, PORT);
    mockQuery.mockClear();

    await trackPlayerSessions(IP, PORT, [player("1")]);
    expect(joins()).toEqual(["1"]);
  });

  it("falls back to a placeholder name when sanitizing empties it", async () => {
    await trackPlayerSessions(IP, PORT, [player("1", "\x01\x07")]);
    const insert = mockQuery.mock.calls.find(([sql]) =>
      sql.includes("INSERT INTO player_sessions"),
    );
    expect(insert[1][1]).toBe("Unknown");
  });
});

describe("map history", () => {
  it("opens a row for the first map seen", async () => {
    await trackMapChange(IP, PORT, "kz_grotto", 3);
    expect(mapSql()).toHaveLength(1);
    expect(mapSql()[0]).toContain("INSERT INTO map_history");
  });

  it("closes the previous row and opens a new one on a map change", async () => {
    await trackMapChange(IP, PORT, "kz_grotto", 3);
    mockQuery.mockClear();

    await trackMapChange(IP, PORT, "kz_synergy_x", 4);
    const sql = mapSql();
    expect(sql).toHaveLength(2);
    expect(sql[0]).toContain("SET ended_at = NOW()");
    expect(sql[1]).toContain("INSERT INTO map_history");
  });

  it("only updates player counts while the map is unchanged", async () => {
    await trackMapChange(IP, PORT, "kz_grotto", 3);
    mockQuery.mockClear();

    await trackMapChange(IP, PORT, "kz_grotto", 8);
    const sql = mapSql();
    expect(sql).toHaveLength(1);
    expect(sql[0]).toContain("player_count_peak");
  });
});
