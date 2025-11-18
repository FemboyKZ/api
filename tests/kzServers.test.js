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

describe("KZ Servers Endpoints", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    kzRecords.getKzPool.mockReturnValue(mockPool);
  });

  describe("GET /kzglobal/servers", () => {
    it("should return paginated list of servers with stats", async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ total: 2 }]])
        .mockResolvedValueOnce([
          [
            {
              id: 1,
              server_id: 123,
              server_name: "KZ Server #1",
              ip: "192.168.1.1",
              port: 27015,
              owner_steamid64: "76561198000000001",
              created_on: "2024-01-01T00:00:00Z",
              approval_status: 1,
              total_records: 5000,
              unique_players: 500,
            },
            {
              id: 2,
              server_id: 124,
              server_name: "KZ Server #2",
              ip: "192.168.1.2",
              port: 27015,
              owner_steamid64: "76561198000000002",
              created_on: "2024-02-01T00:00:00Z",
              approval_status: 1,
              total_records: 3000,
              unique_players: 300,
            },
          ],
        ]);

      const response = await request(app)
        .get("/kzglobal/servers")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("data");
      expect(response.body).toHaveProperty("pagination");
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data[0]).toHaveProperty("server_name");
      expect(response.body.data[0]).toHaveProperty("total_records");
      expect(response.body.data[0]).toHaveProperty("unique_players");
    });

    it("should filter by server name", async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ total: 0 }]])
        .mockResolvedValueOnce([[]]);

      await request(app).get("/kzglobal/servers?name=Server").expect(200);

      const call = mockPool.query.mock.calls[1];
      expect(call[0]).toContain("server_name LIKE");
      expect(call[1]).toContain("%Server%");
    });

    it("should filter by owner steamid", async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ total: 0 }]])
        .mockResolvedValueOnce([[]]);

      await request(app)
        .get("/kzglobal/servers?owner=76561198000000001")
        .expect(200);

      const call = mockPool.query.mock.calls[1];
      expect(call[0]).toContain("owner_steamid64 =");
    });

    it("should filter by approval status", async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ total: 0 }]])
        .mockResolvedValueOnce([[]]);

      await request(app).get("/kzglobal/servers?approval_status=1").expect(200);

      const call = mockPool.query.mock.calls[1];
      expect(call[0]).toContain("approval_status =");
    });

    it("should sort by name ascending", async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ total: 0 }]])
        .mockResolvedValueOnce([[]]);

      await request(app)
        .get("/kzglobal/servers?sort=name&order=asc")
        .expect(200);

      const call = mockPool.query.mock.calls[1];
      expect(call[0]).toContain("ORDER BY s.server_name ASC");
    });

    it("should sort by total records", async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ total: 0 }]])
        .mockResolvedValueOnce([[]]);

      await request(app)
        .get("/kzglobal/servers?sort=records&order=desc")
        .expect(200);

      const call = mockPool.query.mock.calls[1];
      expect(call[0]).toContain("ORDER BY total_records DESC");
    });
  });

  describe("GET /kzglobal/servers/top/records", () => {
    it("should return servers ranked by record count", async () => {
      mockPool.query.mockResolvedValueOnce([
        [
          {
            server_id: 123,
            server_name: "Top Server",
            ip: "192.168.1.1",
            port: 27015,
            total_records: 10000,
            unique_players: 1500,
            unique_maps: 200,
          },
          {
            server_id: 124,
            server_name: "Second Server",
            ip: "192.168.1.2",
            port: 27015,
            total_records: 8000,
            unique_players: 1200,
            unique_maps: 180,
          },
        ],
      ]);

      const response = await request(app)
        .get("/kzglobal/servers/top/records")
        .expect(200);

      expect(response.body.data).toHaveLength(2);
      expect(response.body.data[0]).toHaveProperty("rank", 1);
      expect(response.body.data[0].total_records).toBe(10000);
      expect(response.body.data[1]).toHaveProperty("rank", 2);
    });

    it("should respect limit parameter", async () => {
      mockPool.query.mockResolvedValueOnce([[]]);

      await request(app)
        .get("/kzglobal/servers/top/records?limit=50")
        .expect(200);

      const call = mockPool.query.mock.calls[0];
      expect(call[1]).toContain(50);
    });
  });

  describe("GET /kzglobal/servers/:id", () => {
    it("should return server details with statistics", async () => {
      mockPool.query
        .mockResolvedValueOnce([
          [
            {
              id: 1,
              server_id: 123,
              server_name: "KZ Server #1",
              ip: "192.168.1.1",
              port: 27015,
              owner_steamid64: "76561198000000001",
              created_on: "2024-01-01T00:00:00Z",
              approval_status: 1,
            },
          ],
        ])
        .mockResolvedValueOnce([
          [
            {
              total_records: 5000,
              unique_players: 500,
              unique_maps: 150,
              first_record: "2024-01-01T00:00:00Z",
              last_record: "2025-01-15T12:00:00Z",
            },
          ],
        ])
        .mockResolvedValueOnce([
          [
            {
              mode: "kz_timer",
              records: 3500,
              players: 400,
              maps: 120,
            },
            {
              mode: "kz_simple",
              records: 1500,
              players: 250,
              maps: 90,
            },
          ],
        ])
        .mockResolvedValueOnce([[]]);

      const response = await request(app)
        .get("/kzglobal/servers/123")
        .expect(200);

      expect(response.body).toHaveProperty("server");
      expect(response.body).toHaveProperty("statistics");
      expect(response.body).toHaveProperty("recent_records");
      expect(response.body.server.server_id).toBe(123);
      expect(response.body.statistics.mode_breakdown).toHaveLength(2);
    });

    it("should return 400 for invalid server id", async () => {
      await request(app).get("/kzglobal/servers/invalid").expect(400);
    });

    it("should return 404 for non-existent server", async () => {
      mockPool.query.mockResolvedValueOnce([[]]);

      await request(app).get("/kzglobal/servers/999999").expect(404);
    });
  });

  describe("GET /kzglobal/servers/:id/records", () => {
    it("should return paginated records from a server", async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ id: 1 }]])
        .mockResolvedValueOnce([[{ total: 100 }]])
        .mockResolvedValueOnce([
          [
            {
              id: 1,
              player_name: "Player1",
              map_name: "kz_synergy_x",
              mode: "kz_timer",
              stage: 0,
              time: 125.456,
              teleports: 0,
              points: 50,
              created_on: "2025-01-15T12:00:00Z",
            },
          ],
        ]);

      const response = await request(app)
        .get("/kzglobal/servers/123/records")
        .expect(200);

      expect(response.body).toHaveProperty("data");
      expect(response.body).toHaveProperty("pagination");
      expect(response.body.server_id).toBe(123);
      expect(response.body.data[0]).toHaveProperty("map_name");
    });

    it("should filter by mode", async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ id: 1 }]])
        .mockResolvedValueOnce([[{ total: 0 }]])
        .mockResolvedValueOnce([[]]);

      await request(app)
        .get("/kzglobal/servers/123/records?mode=kz_timer")
        .expect(200);

      const call = mockPool.query.mock.calls[2];
      expect(call[0]).toContain("mode =");
    });

    it("should filter by map name", async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ id: 1 }]])
        .mockResolvedValueOnce([[{ total: 0 }]])
        .mockResolvedValueOnce([[]]);

      await request(app)
        .get("/kzglobal/servers/123/records?map=synergy")
        .expect(200);

      const call = mockPool.query.mock.calls[2];
      expect(call[0]).toContain("map_name LIKE");
    });

    it("should sort by time", async () => {
      mockPool.query
        .mockResolvedValueOnce([[{ id: 1 }]])
        .mockResolvedValueOnce([[{ total: 0 }]])
        .mockResolvedValueOnce([[]]);

      await request(app)
        .get("/kzglobal/servers/123/records?sort=time&order=asc")
        .expect(200);

      const call = mockPool.query.mock.calls[2];
      expect(call[0]).toContain("ORDER BY r.time ASC");
    });

    it("should return 404 for non-existent server", async () => {
      mockPool.query.mockResolvedValueOnce([[]]);

      await request(app).get("/kzglobal/servers/999999/records").expect(404);
    });
  });
});
