const request = require("supertest");
const app = require("../../../src/app");
const kzRecords = require("../../../src/db/kzRecords");
const { driveList } = require("../../fixtures/listEndpoint");

// Create a single shared mock pool
const mockPool = {
  query: jest.fn(),
};

jest.mock("../../../src/db/kzRecords");

jest.mock("../../../src/db/redis", () => ({
  isRedisConnected: jest.fn(() => false),
  getCachedData: jest.fn(() => null),
  setCachedData: jest.fn(),
}));

describe("KZ Maps Endpoints", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    kzRecords.getKzPool.mockReturnValue(mockPool);
  });

  describe("GET /global/maps", () => {
    it("should return paginated list of maps", async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ total: 1 }]]) // COUNT query
        .mockResolvedValueOnce([
          [
            {
              id: 1,
              map_id: 100,
              map_name: "kz_synergy_x",
              difficulty: 5,
              validated: true,
              filesize: 45000000,
              workshop_url: "https://steamcommunity.com/sharedfiles/123",
              records: 1500,
              unique_players: 850,
            },
          ],
        ]);

      const response = await request(app)
        .get("/global/maps")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("data");
      expect(response.body).toHaveProperty("pagination");
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data[0]).toHaveProperty("map_name");
      expect(response.body.data[0]).toHaveProperty("records");
      expect(response.body.data[0]).not.toHaveProperty("total_count");
    });

    it.each([
      ["map name", "?name=synergy", "map_name LIKE", ["%synergy%"]],
      ["difficulty tier", "?difficulty=5", "difficulty =", [5]],
      ["validation status", "?validated=true", "validated =", []],
      [
        "nothing, sorting as asked",
        "?sort=difficulty&order=asc",
        "ORDER BY m.difficulty ASC",
        [],
      ],
    ])("filters by %s", async (_name, queryString, fragment, params) => {
      const { rowsQuery } = await driveList(
        app,
        mockPool,
        `/global/maps${queryString}`,
      );

      expect(rowsQuery[0]).toContain(fragment);
      expect(rowsQuery[1]).toEqual(expect.arrayContaining(params));
    });

    it("should handle database connection errors gracefully", async () => {
      mockPool.query.mockRejectedValueOnce({
        code: "ECONNREFUSED",
        message: "Connection refused",
      });

      const response = await request(app).get("/global/maps").expect(503);

      expect(response.body).toHaveProperty("error");
      expect(response.body.error).toContain("connection refused");
    });
  });

  describe("GET /global/maps/top/difficulty", () => {
    it("should return maps grouped by difficulty", async () => {
      mockPool.query.mockResolvedValueOnce([
        [
          {
            map_name: "kz_easy_map",
            difficulty: 1,
            validated: true,
            total_records: 5000,
            world_record: 45.123,
          },
          {
            map_name: "kz_hard_map",
            difficulty: 7,
            validated: true,
            total_records: 200,
            world_record: 350.789,
          },
        ],
      ]);

      const response = await request(app)
        .get("/global/maps/top/difficulty")
        .expect(200);

      expect(response.body.data).toHaveLength(2);
      expect(response.body.data[0]).toHaveProperty("difficulty");
      expect(response.body.data[0]).toHaveProperty("total_records");
    });

    it("should filter by specific tier", async () => {
      mockPool.query.mockResolvedValueOnce([[]]);

      await request(app).get("/global/maps/top/difficulty?tier=5").expect(200);

      const call = mockPool.query.mock.calls[0];
      expect(call[0]).toContain("difficulty =");
      expect(call[1]).toContain(5);
    });
  });

  describe("GET /global/maps/:mapname", () => {
    it("should return map details with statistics", async () => {
      mockPool.query
        .mockResolvedValueOnce([
          [
            {
              id: 1,
              map_id: 100,
              map_name: "kz_synergy_x",
              difficulty: 5,
              validated: true,
              total_records: 1500,
              unique_players: 850,
              average_time: 180.5,
              pro_records: 1000,
              tp_records: 500,
              first_record: "2023-01-01",
              last_record: "2024-01-01",
              wr_kz_timer_pro_time: 125.456,
              wr_kz_timer_pro_steamid64: "76561198000000000",
              wr_kz_timer_pro_player_name: "TestPlayer",
            },
          ],
        ])
        .mockResolvedValueOnce([[{ worst_time: 999.999 }]])
        .mockResolvedValueOnce([
          [
            {
              mode: "kz_timer",
              records: 1000,
              players: 600,
              world_record: 125.456,
            },
          ],
        ])
        .mockResolvedValueOnce([
          [{ stage: 0, records: 1500, world_record: 125.456 }],
        ])
        .mockResolvedValueOnce([[]]);

      const response = await request(app)
        .get("/global/maps/kz_synergy_x")
        .expect(200);

      expect(response.body).toHaveProperty("map");
      expect(response.body).toHaveProperty("statistics");
      expect(response.body).toHaveProperty("top_records");
      expect(response.body.map.map_name).toBe("kz_synergy_x");
      expect(response.body.statistics).toHaveProperty("mode_breakdown");
    });

    it("should return 404 for non-existent map", async () => {
      mockPool.query.mockResolvedValueOnce([[]]);

      await request(app).get("/global/maps/nonexistent_map").expect(404);
    });
  });

  describe("GET /global/maps/:mapname/records", () => {
    it("should return paginated records for a map", async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ id: 1 }]])
        .mockResolvedValueOnce([[{ total: 100 }]])
        .mockResolvedValueOnce([
          [
            {
              id: 1,
              player_name: "Player1",
              mode: "kz_timer",
              time: 125.456,
              teleports: 0,
            },
          ],
        ]);

      const response = await request(app)
        .get("/global/maps/kz_synergy_x/records")
        .expect(200);

      expect(response.body).toHaveProperty("data");
      expect(response.body).toHaveProperty("pagination");
      expect(response.body.map_name).toBe("kz_synergy_x");
    });

    it.each([
      ["mode", "?mode=kz_timer", "mode ="],
      ["stage", "?stage=0", "stage ="],
      ["pro runs only", "?teleports=pro", "teleports = 0"],
    ])(
      "filters a map's records by %s",
      async (_name, queryString, fragment) => {
        const { rowsQuery } = await driveList(
          app,
          mockPool,
          `/global/maps/kz_synergy_x/records${queryString}`,
          { probes: [[{ id: 1 }]] },
        );

        expect(rowsQuery[0]).toContain(fragment);
      },
    );

    it("should return 404 for non-existent map", async () => {
      mockPool.query.mockResolvedValueOnce([[]]);

      await request(app).get("/global/maps/nonexistent/records").expect(404);
    });
  });
});
