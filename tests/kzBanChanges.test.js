jest.mock("../src/utils/logger", () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const banChanges = require("../src/services/kzBanChanges");

const FIXED_NOW = new Date("2026-07-23T12:00:00Z");

/**
 * Stored rows come back from mysql2 with DATETIME columns as Date objects built
 * from the literal in local time, which is what these helpers reproduce.
 */
function storedDate(literal) {
  const [date, time] = literal.split(" ");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute, second] = time.split(":").map(Number);
  return new Date(year, month - 1, day, hour, minute, second);
}

function storedBan(overrides = {}) {
  return {
    id: 1,
    ban_type: "bhop_hack",
    expires_on: storedDate("2027-01-01 00:00:00"),
    notes: "cheating",
    stats: null,
    server_id: 5,
    updated_by_id: "76561198000000009",
    steamid64: "76561198000000001",
    player_name: "someone",
    ...overrides,
  };
}

function apiBan(overrides = {}) {
  return banChanges.normalizeBan({
    id: 1,
    ban_type: "bhop_hack",
    expires_on: "2027-01-01T00:00:00",
    ip: null,
    steamid64: "76561198000000001",
    player_name: "someone",
    steam_id: "STEAM_1:1:1",
    notes: "cheating",
    stats: null,
    server_id: 5,
    updated_by_id: "76561198000000009",
    created_on: "2026-01-01T00:00:00",
    updated_on: "2026-01-01T00:00:00",
    ...overrides,
  });
}

describe("KZ Ban Changes", () => {
  describe("formatDateTime", () => {
    it("keeps a zoneless timestamp as the literal it is", () => {
      expect(banChanges.formatDateTime("2026-08-22T13:00:12")).toBe(
        "2026-08-22 13:00:12",
      );
      expect(banChanges.formatDateTime("9999-12-31T23:59:59")).toBe(
        "9999-12-31 23:59:59",
      );
    });

    it("converts zoned timestamps to UTC", () => {
      expect(banChanges.formatDateTime("2025-11-09T18:14:57.736Z")).toBe(
        "2025-11-09 18:14:57",
      );
      expect(banChanges.formatDateTime("2026-08-22T13:00:12+02:00")).toBe(
        "2026-08-22 11:00:12",
      );
    });

    it("returns null for empty or unparseable input", () => {
      expect(banChanges.formatDateTime(null)).toBeNull();
      expect(banChanges.formatDateTime("")).toBeNull();
      expect(banChanges.formatDateTime("not-a-date")).toBeNull();
    });
  });

  describe("isActiveExpiry", () => {
    it("treats a NULL expiry as permanent", () => {
      expect(banChanges.isActiveExpiry(null, FIXED_NOW)).toBe(true);
    });

    it("distinguishes future from past expiries", () => {
      expect(banChanges.isActiveExpiry("2027-01-01 00:00:00", FIXED_NOW)).toBe(
        true,
      );
      expect(banChanges.isActiveExpiry("2020-01-01 00:00:00", FIXED_NOW)).toBe(
        false,
      );
    });
  });

  describe("diffBans", () => {
    it("classifies an expiry moved into the past as an unban", () => {
      const changes = banChanges.diffBans(
        [storedBan()],
        [apiBan({ expires_on: "2026-07-01T00:00:00" })],
        FIXED_NOW,
      );

      expect(changes).toHaveLength(1);
      expect(changes[0]).toMatchObject({
        ban_id: 1,
        steamid64: "76561198000000001",
        change_type: "unban",
        field: "expires_on",
        old_value: "2027-01-01 00:00:00",
        new_value: "2026-07-01 00:00:00",
      });
    });

    it("classifies an expiry moved into the future as a reban", () => {
      const changes = banChanges.diffBans(
        [storedBan({ expires_on: storedDate("2020-01-01 00:00:00") })],
        [apiBan()],
        FIXED_NOW,
      );

      expect(changes).toHaveLength(1);
      expect(changes[0].change_type).toBe("reban");
    });

    it("classifies an expiry moved within the future as an expiry change", () => {
      const changes = banChanges.diffBans(
        [storedBan()],
        [apiBan({ expires_on: "2028-01-01T00:00:00" })],
        FIXED_NOW,
      );

      expect(changes).toHaveLength(1);
      expect(changes[0].change_type).toBe("expiry_change");
    });

    it("reports other tracked fields as edits", () => {
      const changes = banChanges.diffBans(
        [storedBan()],
        [apiBan({ ban_type: "ban_evasion", notes: "reviewed" })],
        FIXED_NOW,
      );

      expect(changes).toHaveLength(2);
      expect(changes.map((change) => change.field).sort()).toEqual([
        "ban_type",
        "notes",
      ]);
      expect(changes.every((change) => change.change_type === "edit")).toBe(
        true,
      );
    });

    it("reports nothing when a ban is unchanged", () => {
      expect(banChanges.diffBans([storedBan()], [apiBan()], FIXED_NOW)).toEqual(
        [],
      );
    });

    it("ignores bans that are not stored yet", () => {
      const changes = banChanges.diffBans([], [apiBan({ id: 999 })], FIXED_NOW);

      expect(changes).toEqual([]);
    });

    it("does not treat identity field churn as a change", () => {
      const changes = banChanges.diffBans(
        [storedBan()],
        [apiBan({ player_name: "renamed", ip: "1.2.3.4" })],
        FIXED_NOW,
      );

      expect(changes).toEqual([]);
    });
  });

  describe("upsertBansWithChangeTracking", () => {
    it("returns zeros for an empty batch without touching the database", async () => {
      const connection = { query: jest.fn() };

      const result = await banChanges.upsertBansWithChangeTracking(
        connection,
        [],
      );

      expect(connection.query).not.toHaveBeenCalled();
      expect(result).toEqual({
        inserted: 0,
        seen: 0,
        changed: 0,
        changes: 0,
        unbans: 0,
      });
    });

    it("diffs before upserting and logs the changes it found", async () => {
      const connection = {
        query: jest
          .fn()
          // SELECT of stored rows
          .mockResolvedValueOnce([[storedBan()]])
          // upsert, one existing row reports 2 affected
          .mockResolvedValueOnce([{ affectedRows: 2 }])
          // insert into kz_ban_changes
          .mockResolvedValueOnce([{ affectedRows: 1 }]),
      };

      const result = await banChanges.upsertBansWithChangeTracking(connection, [
        {
          id: 1,
          ban_type: "bhop_hack",
          expires_on: "2020-01-01T00:00:00",
          steamid64: "76561198000000001",
          player_name: "someone",
          steam_id: "STEAM_1:1:1",
          notes: "cheating",
          server_id: 5,
          updated_by_id: "76561198000000009",
          created_on: "2026-01-01T00:00:00",
          updated_on: "2026-07-23T10:00:00",
        },
      ]);

      const [selectSql] = connection.query.mock.calls[0];
      const [upsertSql] = connection.query.mock.calls[1];
      const [changesSql] = connection.query.mock.calls[2];

      expect(selectSql).toContain("FROM kz_bans");
      expect(upsertSql).toContain("ON DUPLICATE KEY UPDATE");
      expect(upsertSql).toContain("last_seen_at = CURRENT_TIMESTAMP");
      expect(changesSql).toContain("INSERT INTO kz_ban_changes");

      expect(result).toEqual({
        inserted: 0,
        seen: 1,
        changed: 1,
        changes: 1,
        unbans: 1,
      });
    });

    it("counts inserts from affected rows", async () => {
      const connection = {
        query: jest
          .fn()
          .mockResolvedValueOnce([[]])
          .mockResolvedValueOnce([{ affectedRows: 2 }]),
      };

      const result = await banChanges.upsertBansWithChangeTracking(connection, [
        { id: 7, ban_type: "bhop_macro", expires_on: "2027-01-01T00:00:00" },
        { id: 8, ban_type: "bhop_macro", expires_on: "2027-01-01T00:00:00" },
      ]);

      expect(result.inserted).toBe(2);
      expect(result.changed).toBe(0);
    });

    it("survives a missing kz_ban_changes table", async () => {
      const missingTable = new Error("Table doesn't exist");
      missingTable.code = "ER_NO_SUCH_TABLE";

      const connection = {
        query: jest
          .fn()
          .mockResolvedValueOnce([[storedBan()]])
          .mockResolvedValueOnce([{ affectedRows: 2 }])
          .mockRejectedValueOnce(missingTable),
      };

      const result = await banChanges.upsertBansWithChangeTracking(connection, [
        {
          id: 1,
          ban_type: "ban_evasion",
          expires_on: "2027-01-01T00:00:00",
          steamid64: "76561198000000001",
          notes: "cheating",
          server_id: 5,
          updated_by_id: "76561198000000009",
          created_on: "2026-01-01T00:00:00",
          updated_on: "2026-01-01T00:00:00",
        },
      ]);

      expect(result.changed).toBe(1);
    });
  });
});
