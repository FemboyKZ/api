const request = require("supertest");
const app = require("../src/app");

describe("Health Endpoints", () => {
  describe("GET /health", () => {
    it("should return 200 and healthy status", async () => {
      const response = await request(app)
        .get("/health")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("status", "healthy");
      expect(response.body).toHaveProperty("timestamp");
      expect(response.body).toHaveProperty("database");
    });
  });

  describe("GET /health/stats", () => {
    it("should return 200 and statistics", async () => {
      const response = await request(app)
        .get("/health/stats")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("uptime");
      expect(response.body).toHaveProperty("servers");
      expect(response.body).toHaveProperty("players");
      expect(response.body).toHaveProperty("maps");
    });
  });
});
