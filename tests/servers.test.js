const request = require("supertest");
const app = require("../src/app");

describe("Server Endpoints", () => {
  describe("GET /api/servers", () => {
    it("should return servers list with metadata", async () => {
      const response = await request(app)
        .get("/api/servers")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("playersTotal");
      expect(response.body).toHaveProperty("serversOnline");
      expect(typeof response.body.playersTotal).toBe("number");
      expect(typeof response.body.serversOnline).toBe("number");
    });

    it("should filter by game type", async () => {
      const response = await request(app)
        .get("/api/servers?game=csgo")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("playersTotal");
      expect(response.body).toHaveProperty("serversOnline");
    });

    it("should filter by status", async () => {
      const response = await request(app)
        .get("/api/servers?status=1")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("serversOnline");
    });
  });

  describe("GET /api/servers/:ip", () => {
    it("should return 400 for invalid IP", async () => {
      const response = await request(app)
        .get("/api/servers/invalid-ip")
        .expect("Content-Type", /json/)
        .expect(400);

      expect(response.body).toHaveProperty("error");
    });

    it("should return 404 for non-existent server", async () => {
      await request(app).get("/api/servers/192.168.1.1").expect(404);
    });
  });
});
