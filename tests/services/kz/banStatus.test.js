const kzRecords = require("../../../src/db/kzRecords");

// Create mock connection with release function
const mockConnection = {
  query: jest.fn(),
  release: jest.fn(),
};

// Create a single shared mock pool
const mockPool = {
  query: jest.fn(),
  getConnection: jest.fn().mockResolvedValue(mockConnection),
};

// Mock KZ database pool
jest.mock("../../../src/db/kzRecords", () => ({
  getKzPool: jest.fn(),
}));

// Mock logger
jest.mock("../../../src/utils/logger", () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

// Import after mocking
const banStatus = require("../../../src/services/kz/banStatus");

describe("KZ Ban Status Service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    kzRecords.getKzPool.mockReturnValue(mockPool);
    mockPool.getConnection.mockResolvedValue(mockConnection);
  });

  // All three are thin wrappers over a stored procedure: call it, rename its columns, release.
  describe("stored procedure wrappers", () => {
    const STEAMID = "76561198000000001";
    const wrappers = [
      [
        "archiveBannedPlayerRecords",
        () => banStatus.archiveBannedPlayerRecords(STEAMID, 123),
        ["CALL archive_banned_player_records(?, ?)", [STEAMID, 123]],
        { records_archived: 5, already_archived: 0 },
        { archived: 5, alreadyArchived: 0 },
        { archived: 0, alreadyArchived: 0, error: "procedure_not_found" },
      ],
      [
        "restoreUnbannedPlayerRecords",
        () => banStatus.restoreUnbannedPlayerRecords(STEAMID),
        ["CALL restore_unbanned_player_records(?)", [STEAMID]],
        { records_restored: 3 },
        { restored: 3 },
        { restored: 0, error: "procedure_not_found" },
      ],
      [
        "batchArchiveBannedRecords",
        () => banStatus.batchArchiveBannedRecords(),
        ["CALL batch_archive_banned_records()"],
        { records_archived: 100, players_processed: 5 },
        { archived: 100, playersProcessed: 5 },
        { archived: 0, playersProcessed: 0, error: "procedure_not_found" },
      ],
    ];

    it.each(wrappers)(
      "%s calls its procedure and maps the row it returns",
      async (_name, invoke, expectedCall, row, expected) => {
        mockConnection.query.mockResolvedValueOnce([[row]]);

        await expect(invoke()).resolves.toEqual(expected);
        expect(mockConnection.query).toHaveBeenCalledWith(...expectedCall);
        expect(mockConnection.release).toHaveBeenCalled();
      },
    );

    // The archive migration may not have run yet; a missing procedure must not take the sweep down.
    it.each(wrappers)(
      "%s reports a missing procedure instead of throwing",
      async (_name, invoke, _call, _row, _expected, expectedOnMissing) => {
        const error = new Error("Procedure not found");
        error.code = "ER_SP_DOES_NOT_EXIST";
        mockConnection.query.mockRejectedValueOnce(error);

        await expect(invoke()).resolves.toEqual(expectedOnMissing);
        expect(mockConnection.release).toHaveBeenCalled();
      },
    );

    it("rethrows any other database error", async () => {
      const error = new Error("Database connection failed");
      error.code = "ER_CON_COUNT_ERROR";
      mockConnection.query.mockRejectedValueOnce(error);

      await expect(
        banStatus.archiveBannedPlayerRecords(STEAMID, 123),
      ).rejects.toThrow("Database connection failed");
    });
  });

  describe("updatePlayerBanStatus with archiving", () => {
    it("should update ban status and archive records for permanent bans", async () => {
      // First query: find active bans
      mockConnection.query
        .mockResolvedValueOnce([
          [
            {
              steamid64: "76561198000000001",
              ban_id: 1,
              expires_on: new Date("9999-12-31T23:59:59Z"), // permanent ban
            },
          ],
        ])
        // Second query: update players to banned
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      // Mock getConnection for archive call
      const archiveConnection = {
        query: jest
          .fn()
          .mockResolvedValue([[{ records_archived: 5, already_archived: 0 }]]),
        release: jest.fn(),
      };

      let getConnectionCalls = 0;
      mockPool.getConnection.mockImplementation(() => {
        getConnectionCalls++;
        if (getConnectionCalls === 1) {
          return Promise.resolve(mockConnection);
        }
        return Promise.resolve(archiveConnection);
      });

      const result = await banStatus.updatePlayerBanStatus([
        "76561198000000001",
      ]);

      expect(result).toHaveProperty("banned");
      expect(result).toHaveProperty("recordsArchived");
    });

    it("should skip archiving when archiveRecords is false", async () => {
      // First query: find active bans (temporary ban, not permanent)
      mockConnection.query
        .mockResolvedValueOnce([
          [
            {
              steamid64: "76561198000000001",
              ban_id: 1,
              expires_on: new Date("2026-01-01T00:00:00Z"), // temporary ban
            },
          ],
        ])
        // Second query: update players
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        // Third query: no inactiveSteamIds to unban
        .mockResolvedValueOnce([{ affectedRows: 0 }]);

      const result = await banStatus.updatePlayerBanStatus(
        ["76561198000000001"],
        false, // Don't archive
      );

      expect(result.banned).toBe(1);
      expect(result.recordsArchived).toBe(0);
    });

    it("should handle empty steamIds array", async () => {
      const result = await banStatus.updatePlayerBanStatus([]);

      expect(result).toEqual({
        banned: 0,
        unbanned: 0,
        recordsArchived: 0,
        recordsRestored: 0,
      });
      expect(mockConnection.query).not.toHaveBeenCalled();
    });
  });

  describe("getStats", () => {
    it("should include record archival stats", () => {
      const stats = banStatus.getStats();

      expect(stats).toHaveProperty("totalRecordsArchived");
      expect(stats).toHaveProperty("totalRecordsRestored");
      expect(typeof stats.totalRecordsArchived).toBe("number");
      expect(typeof stats.totalRecordsRestored).toBe("number");
    });
  });
});
