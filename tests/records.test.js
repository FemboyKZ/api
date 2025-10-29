const request = require("supertest");
const app = require("../src/app");
const pool = require("../src/db");
const { fetchRecentRecordsForServers } = require("../src/services/cs2kzRecords");

// Mock the CS2KZ records service
jest.mock("../src/services/cs2kzRecords");

describe("Records API", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await pool.end();
  });

  describe("GET /records/recent", () => {
    it("should return recent records for all CS2 servers", async () => {
      // Mock database response
      pool.query = jest.fn().mockResolvedValue([
        [
          {
            ip: "37.27.107.76",
            port: 27015,
            game: "counterstrike2",
            apiId: 4,
          },
          {
            ip: "37.27.107.76",
            port: 27016,
            game: "counterstrike2",
            apiId: 5,
          },
        ],
      ]);

      // Mock CS2KZ API response
      fetchRecentRecordsForServers.mockResolvedValue({
        "37.27.107.76:27015": {
          apiId: 4,
          records: [
            {
              id: 123456,
              player_name: "Joee",
              map_name: "kz_checkmate",
              time: 185.42,
              created_on: "2025-01-15T14:32:10Z",
            },
          ],
        },
        "37.27.107.76:27016": {
          apiId: 5,
          records: [
            {
              id: 789012,
              player_name: "TestPlayer",
              map_name: "kz_synergy_x",
              time: 245.67,
              created_on: "2025-01-15T15:45:20Z",
            },
          ],
        },
      });

      const response = await request(app).get("/records/recent");

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("37.27.107.76:27015");
      expect(response.body).toHaveProperty("37.27.107.76:27016");
      expect(response.body["37.27.107.76:27015"].apiId).toBe(4);
      expect(response.body["37.27.107.76:27015"].records).toHaveLength(1);
      expect(response.body["37.27.107.76:27015"].records[0].player_name).toBe(
        "Joee",
      );
    });

    it("should return empty object when no CS2 servers found", async () => {
      pool.query = jest.fn().mockResolvedValue([[]]);

      const response = await request(app).get("/records/recent");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({});
    });

    it("should respect limit parameter", async () => {
      pool.query = jest.fn().mockResolvedValue([
        [
          {
            ip: "37.27.107.76",
            port: 27015,
            game: "counterstrike2",
            apiId: 4,
          },
        ],
      ]);

      fetchRecentRecordsForServers.mockResolvedValue({
        "37.27.107.76:27015": {
          apiId: 4,
          records: [],
        },
      });

      await request(app).get("/records/recent?limit=5");

      expect(fetchRecentRecordsForServers).toHaveBeenCalledWith(
        expect.any(Array),
        5,
      );
    });

    it("should clamp limit to maximum of 100", async () => {
      pool.query = jest.fn().mockResolvedValue([[]]);

      await request(app).get("/records/recent?limit=500");

      // Should not fail, should clamp to 100
      expect(fetchRecentRecordsForServers).toHaveBeenCalledWith(
        expect.any(Array),
        100,
      );
    });

    it("should handle database errors", async () => {
      pool.query = jest.fn().mockRejectedValue(new Error("Database error"));

      const response = await request(app).get("/records/recent");

      expect(response.status).toBe(500);
      expect(response.body).toHaveProperty("error");
    });
  });

  describe("GET /records/server/:ip/:port", () => {
    it("should return recent records for specific server", async () => {
      pool.query = jest.fn().mockResolvedValue([
        [
          {
            ip: "37.27.107.76",
            port: 27015,
            game: "counterstrike2",
            apiId: 4,
          },
        ],
      ]);

      fetchRecentRecordsForServers.mockResolvedValue({
        "37.27.107.76:27015": {
          apiId: 4,
          records: [
            {
              id: 123456,
              player_name: "Joee",
              map_name: "kz_checkmate",
              time: 185.42,
              created_on: "2025-01-15T14:32:10Z",
            },
          ],
        },
      });

      const response = await request(app).get(
        "/records/server/37.27.107.76/27015",
      );

      expect(response.status).toBe(200);
      expect(response.body.apiId).toBe(4);
      expect(response.body.records).toHaveLength(1);
      expect(response.body.records[0].player_name).toBe("Joee");
    });

    it("should return 404 when server not found", async () => {
      pool.query = jest.fn().mockResolvedValue([[]]);

      const response = await request(app).get(
        "/records/server/1.2.3.4/27015",
      );

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty("error");
      expect(response.body.error).toBe("Server not found");
    });

    it("should return 400 for non-CS2 servers", async () => {
      pool.query = jest.fn().mockResolvedValue([
        [
          {
            ip: "37.27.107.76",
            port: 27025,
            game: "csgo",
            apiId: null,
          },
        ],
      ]);

      const response = await request(app).get(
        "/records/server/37.27.107.76/27025",
      );

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty("error");
      expect(response.body.error).toBe(
        "Records are only available for CS2 servers",
      );
    });

    it("should return 404 when server has no apiId", async () => {
      pool.query = jest.fn().mockResolvedValue([
        [
          {
            ip: "37.27.107.76",
            port: 27015,
            game: "counterstrike2",
            apiId: null,
          },
        ],
      ]);

      const response = await request(app).get(
        "/records/server/37.27.107.76/27015",
      );

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty("error");
      expect(response.body.error).toBe(
        "Server does not have a CS2KZ API ID configured",
      );
    });

    it("should handle database errors", async () => {
      pool.query = jest.fn().mockRejectedValue(new Error("Database error"));

      const response = await request(app).get(
        "/records/server/37.27.107.76/27015",
      );

      expect(response.status).toBe(500);
      expect(response.body).toHaveProperty("error");
    });
  });
});
