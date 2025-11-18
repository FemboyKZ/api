const request = require("supertest");
const app = require("../src/app");
const kzRecords = require("../src/db/kzRecords");

// Create a single shared mock pool
const mockPool = {
  query: jest.fn(),
};

jest.mock("../src/db/kzRecords");

jest.mock("../src/db/redis", () => ({
  isRedisConnected: jest.fn(() => false),
  getCachedData: jest.fn(() => null),
  setCachedData: jest.fn(),
}));

describe("KZ Maps Endpoints", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    kzRecords.getKzPool.mockReturnValue(mockPool);
  });

  describe("GET /kzglobal/maps", () => {
    it("should return paginated list of maps", async () => {
      mockPool.query.mockResolvedValueOnce([
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
            world_record_time: 125.456,
            total_count: 1,
          },
        ],
      ]);

      const response = await request(app)
        .get("/kzglobal/maps")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("data");
      expect(response.body).toHaveProperty("pagination");
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data[0]).toHaveProperty("map_name");
      expect(response.body.data[0]).toHaveProperty("records");
      expect(response.body.data[0]).not.toHaveProperty("total_count");
    });

    it("should filter by map name", async () => {
      mockPool.query.mockResolvedValueOnce([[]]);

      await request(app).get("/kzglobal/maps?name=synergy").expect(200);

      const call = mockPool.query.mock.calls[0];
      expect(call[0]).toContain("map_name LIKE");
      expect(call[1]).toContain("%synergy%");
    });

    it("should filter by difficulty tier", async () => {
      mockPool.query.mockResolvedValueOnce([[]]);

      await request(app).get("/kzglobal/maps?difficulty=5").expect(200);

      const call = mockPool.query.mock.calls[0];
      expect(call[0]).toContain("difficulty =");
      expect(call[1]).toContain(5);
    });

    it("should filter by validation status", async () => {
      mockPool.query.mockResolvedValueOnce([[]]);

      await request(app).get("/kzglobal/maps?validated=true").expect(200);

      const call = mockPool.query.mock.calls[0];
      expect(call[0]).toContain("validated =");
    });

    it("should sort by difficulty", async () => {
      mockPool.query.mockResolvedValueOnce([[]]);

      await request(app)
        .get("/kzglobal/maps?sort=difficulty&order=asc")
        .expect(200);

      const call = mockPool.query.mock.calls[0];
      expect(call[0]).toContain("ORDER BY m.difficulty ASC");
    });

    it("should handle database connection errors gracefully", async () => {
      mockPool.query.mockRejectedValueOnce({
        code: "ECONNREFUSED",
        message: "Connection refused",
      });

      const response = await request(app).get("/kzglobal/maps").expect(503);

      expect(response.body).toHaveProperty("error");
      expect(response.body.error).toContain("connection refused");
    });
  });

  describe("GET /kzglobal/maps/top/difficulty", () => {
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
        .get("/kzglobal/maps/top/difficulty")
        .expect(200);

      expect(response.body.data).toHaveLength(2);
      expect(response.body.data[0]).toHaveProperty("difficulty");
      expect(response.body.data[0]).toHaveProperty("total_records");
    });

    it("should filter by specific tier", async () => {
      mockPool.query.mockResolvedValueOnce([[]]);

      await request(app)
        .get("/kzglobal/maps/top/difficulty?tier=5")
        .expect(200);

      const call = mockPool.query.mock.calls[0];
      expect(call[0]).toContain("difficulty =");
      expect(call[1]).toContain(5);
    });
  });

  describe("GET /kzglobal/maps/:mapname", () => {
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
            },
          ],
        ])
        .mockResolvedValueOnce([
          [
            {
              total_records: 1500,
              unique_players: 850,
              world_record: 125.456,
              average_time: 180.5,
            },
          ],
        ])
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
        .get("/kzglobal/maps/kz_synergy_x")
        .expect(200);

      expect(response.body).toHaveProperty("map");
      expect(response.body).toHaveProperty("statistics");
      expect(response.body).toHaveProperty("top_records");
      expect(response.body.map.map_name).toBe("kz_synergy_x");
      expect(response.body.statistics).toHaveProperty("mode_breakdown");
    });

    it("should return 404 for non-existent map", async () => {
      mockPool.query.mockResolvedValueOnce([[]]);

      await request(app).get("/kzglobal/maps/nonexistent_map").expect(404);
    });
  });

  describe("GET /kzglobal/maps/:mapname/records", () => {
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
        .get("/kzglobal/maps/kz_synergy_x/records")
        .expect(200);

      expect(response.body).toHaveProperty("data");
      expect(response.body).toHaveProperty("pagination");
      expect(response.body.map_name).toBe("kz_synergy_x");
    });

    it("should filter by mode", async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ id: 1 }]])
        .mockResolvedValueOnce([[{ total: 0 }]])
        .mockResolvedValueOnce([[]]);

      await request(app)
        .get("/kzglobal/maps/kz_synergy_x/records?mode=kz_timer")
        .expect(200);

      const call = mockPool.query.mock.calls[2];
      expect(call[0]).toContain("mode =");
    });

    it("should filter by stage", async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ id: 1 }]])
        .mockResolvedValueOnce([[{ total: 0 }]])
        .mockResolvedValueOnce([[]]);

      await request(app)
        .get("/kzglobal/maps/kz_synergy_x/records?stage=0")
        .expect(200);

      const call = mockPool.query.mock.calls[2];
      expect(call[0]).toContain("stage =");
    });

    it("should filter pro runs only", async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ id: 1 }]])
        .mockResolvedValueOnce([[{ total: 0 }]])
        .mockResolvedValueOnce([[]]);

      await request(app)
        .get("/kzglobal/maps/kz_synergy_x/records?teleports=pro")
        .expect(200);

      const call = mockPool.query.mock.calls[2];
      expect(call[0]).toContain("teleports = 0");
    });

    it("should return 404 for non-existent map", async () => {
      mockPool.query.mockResolvedValueOnce([[]]);

      await request(app)
        .get("/kzglobal/maps/nonexistent/records")
        .expect(404);
    });
  });
});
