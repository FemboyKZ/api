const request = require("supertest");
const app = require("../../src/app");
const pool = require("../../src/db");

// Mock database pool
jest.mock("../../src/db", () => ({
  query: jest.fn(),
}));

// Mock redis
jest.mock("../../src/db/redis", () => ({
  isRedisConnected: jest.fn(() => false),
  getCachedData: jest.fn(() => null),
  setCachedData: jest.fn(),
}));

// Mock steamPlayerClient service
jest.mock("../../src/services/servers/steamPlayer", () => ({
  getPlayerSummary: jest.fn(() => null),
}));

describe("Players Endpoints", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("GET /players", () => {
    it("should return all players grouped by game with default pagination", async () => {
      // Mock optimized query with SQL aggregation (JSON_OBJECT)
      pool.query
        .mockResolvedValueOnce([
          [
            {
              steamid: "76561198000000001",
              name: "Player1",
              csgo: JSON.stringify({
                total_playtime: 12345,
                last_seen: "2025-10-26T12:00:00Z",
              }),
              counterstrike2: JSON.stringify({
                total_playtime: 5000,
                last_seen: "2025-10-26T14:00:00Z",
              }),
              _total_playtime: 17345,
              _last_seen: "2025-10-26T14:00:00Z",
            },
            {
              steamid: "76561198000000002",
              name: "Player2",
              csgo: JSON.stringify({
                total_playtime: 54321,
                last_seen: "2025-10-25T10:00:00Z",
              }),
              counterstrike2: null,
              _total_playtime: 54321,
              _last_seen: "2025-10-25T10:00:00Z",
            },
          ],
        ])
        .mockResolvedValueOnce([[{ total: 2 }]]); // Count query

      const response = await request(app)
        .get("/players")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("data");
      expect(response.body).toHaveProperty("pagination");
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBe(2); // 2 unique players

      // Check structure has game-specific data
      expect(response.body.data[0]).toHaveProperty("steamid");
      expect(response.body.data[0]).toHaveProperty("name");
      expect(response.body.data[0]).toHaveProperty("csgo");
      expect(response.body.data[0]).toHaveProperty("counterstrike2");

      // Player 1 should have both games
      const player1 = response.body.data.find(
        (p) => p.steamid === "76561198000000001",
      );
      expect(player1.csgo).toHaveProperty("total_playtime");
      expect(player1.counterstrike2).toHaveProperty("total_playtime");

      // Player 2 should have only CS:GO
      const player2 = response.body.data.find(
        (p) => p.steamid === "76561198000000002",
      );
      expect(player2.csgo).toHaveProperty("total_playtime");
      expect(player2.counterstrike2).toEqual({});
    });

    // The response only echoes whatever the mock returned, so the filters are
    // checked where they take effect: the rows query and its parameters.
    it.each([
      ["game", "?game=csgo", " AND p.game = ?", ["csgo"]],
      ["name", "?name=Test", " AND p.latest_name LIKE ?", ["%Test%"]],
      ["playtime, the default sort", "", "ORDER BY _total_playtime DESC", []],
      [
        "last_seen",
        "?sort=last_seen&order=desc",
        "ORDER BY _last_seen DESC",
        [],
      ],
      ["pagination", "?page=2&limit=5", "LIMIT ? OFFSET ?", [5, 5]],
    ])("filters by %s", async (_name, queryString, fragment, expected) => {
      pool.query
        .mockResolvedValueOnce([[]]) // rows
        .mockResolvedValueOnce([[{ total: 0 }]]); // count

      await request(app).get(`/players${queryString}`).expect(200);

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain(fragment);
      expect(params).toEqual(expect.arrayContaining(expected));
    });

    it("should handle SQL injection attempts safely", async () => {
      pool.query
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([[{ total: 0 }]]);

      const response = await request(app)
        .get("/players?name=Test' OR '1'='1")
        .expect("Content-Type", /json/)
        .expect(200);

      // Should not error - parameterized queries prevent injection
      expect(response.body).toHaveProperty("data");
    });

    it("should parse JSON fields correctly from MariaDB", async () => {
      pool.query
        .mockResolvedValueOnce([
          [
            {
              steamid: "76561198000000001",
              name: "Player1",
              // MariaDB returns JSON as string
              csgo: '{"total_playtime":12345,"last_seen":"2025-10-26T12:00:00Z"}',
              counterstrike2: null,
              _total_playtime: 12345,
              _last_seen: "2025-10-26T12:00:00Z",
            },
          ],
        ])
        .mockResolvedValueOnce([[{ total: 1 }]]);

      const response = await request(app)
        .get("/players")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body.data[0].csgo).toHaveProperty(
        "total_playtime",
        12345,
      );
      expect(response.body.data[0].csgo).toHaveProperty("last_seen");
    });

    it("should handle database errors", async () => {
      pool.query.mockRejectedValueOnce(new Error("Database error"));

      const response = await request(app)
        .get("/players")
        .expect("Content-Type", /json/)
        .expect(500);

      expect(response.body).toHaveProperty("error");
    });
  });

  describe("GET /players/:steamid", () => {
    it("should return specific player details grouped by game", async () => {
      pool.query
        .mockResolvedValueOnce([
          [
            {
              id: 1,
              steamid: "76561198000000001",
              latest_name: "Player1",
              game: "csgo",
              playtime: 12345,
              server_ip: "1.2.3.4",
              server_port: 27015,
              last_seen: "2025-10-26T12:00:00Z",
              created_at: "2025-10-20T10:00:00Z",
            },
            {
              id: 2,
              steamid: "76561198000000001",
              latest_name: "Player1",
              game: "counterstrike2",
              playtime: 5000,
              server_ip: "1.2.3.4",
              server_port: 27016,
              last_seen: "2025-10-26T14:00:00Z",
              created_at: "2025-10-21T10:00:00Z",
            },
          ],
        ])
        .mockResolvedValueOnce([
          [
            {
              game: "csgo",
              total_playtime: 12345,
              last_seen: "2025-10-26T12:00:00Z",
            },
            {
              game: "counterstrike2",
              total_playtime: 5000,
              last_seen: "2025-10-26T14:00:00Z",
            },
          ],
        ])
        .mockResolvedValueOnce([[]]);

      const response = await request(app)
        .get("/players/76561198000000001")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("data");
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0]).toHaveProperty("steamid");
      expect(response.body.data[0]).toHaveProperty("csgo");
      expect(response.body.data[0]).toHaveProperty("counterstrike2");

      // Check CS:GO stats
      expect(response.body.data[0].csgo).toHaveProperty("total_playtime");
      expect(response.body.data[0].csgo).toHaveProperty("last_seen");
      expect(response.body.data[0].csgo).toHaveProperty("sessions");
      expect(Array.isArray(response.body.data[0].csgo.sessions)).toBe(true);

      // Check CS2 stats
      expect(response.body.data[0].counterstrike2).toHaveProperty(
        "total_playtime",
      );
      expect(response.body.data[0].counterstrike2).toHaveProperty("last_seen");
      expect(response.body.data[0].counterstrike2).toHaveProperty("sessions");
    });

    it("should return 400 for invalid SteamID", async () => {
      const response = await request(app)
        .get("/players/invalid-steamid")
        .expect("Content-Type", /json/)
        .expect(400);

      expect(response.body).toHaveProperty("error");
      expect(response.body.error).toBe("Invalid SteamID format");
    });

    // Both spellings name the same account, and the route resolves them to SteamID64
    // before it touches the database.
    it.each([
      ["SteamID2", "STEAM_0:1:12345"],
      ["SteamID3", "[U:1:24691]"],
    ])("accepts %s and looks the player up by SteamID64", async (_name, id) => {
      pool.query
        .mockResolvedValueOnce([
          [
            {
              id: 1,
              steamid: "76561197960290419",
              latest_name: "TestPlayer",
              game: "csgo",
              playtime: 1000,
              server_ip: "1.2.3.4",
              server_port: 27015,
              last_seen: "2025-10-26T12:00:00Z",
              created_at: "2025-10-20T10:00:00Z",
            },
          ],
        ])
        .mockResolvedValueOnce([
          [
            {
              game: "csgo",
              total_playtime: 1000,
              last_seen: "2025-10-26T12:00:00Z",
            },
          ],
        ])
        .mockResolvedValueOnce([[]]);

      const response = await request(app)
        .get(`/players/${id}`)
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body.data[0].steamid).toBe("76561197960290419");
      expect(pool.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(["76561197960290419"]),
      );
    });

    it("should return 404 for non-existent player", async () => {
      pool.query.mockResolvedValueOnce([[]]);

      await request(app).get("/players/76561198000000001").expect(404);
    });

    it("should handle database errors", async () => {
      pool.query.mockRejectedValueOnce(new Error("Database error"));

      const response = await request(app)
        .get("/players/76561198000000001")
        .expect("Content-Type", /json/)
        .expect(500);

      expect(response.body).toHaveProperty("error");
    });
  });

  describe("GET /players/online", () => {
    it("should return all currently online players", async () => {
      pool.query.mockResolvedValueOnce([
        [
          {
            ip: "185.107.96.59",
            port: 27015,
            game: "csgo",
            hostname: "FemboyKZ | EU",
            map: "kz_synergy_x",
            players_list: JSON.stringify([
              {
                userid: 1,
                name: "Player1",
                steamid: "76561198000000001",
                time: "12:34",
                ping: 45,
                loss: 0,
                state: "active",
                bot: false,
              },
              {
                userid: 2,
                name: "Player2",
                steamid: "76561198000000002",
                time: "05:12",
                ping: 30,
                loss: 0,
                state: "active",
                bot: false,
              },
            ]),
          },
          {
            ip: "37.27.107.76",
            port: 27016,
            game: "counterstrike2",
            hostname: "FemboyKZ | US",
            map: "kz_grotto",
            players_list: JSON.stringify([
              {
                userid: 3,
                name: "Player3",
                steamid: "76561198000000003",
                time: "01:23",
                ping: 80,
                loss: 0,
                state: "active",
                bot: false,
              },
            ]),
          },
        ],
      ]);

      const response = await request(app)
        .get("/players/online")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body).toHaveProperty("total", 3);
      expect(response.body).toHaveProperty("data");
      expect(response.body.data).toHaveLength(3);
      expect(response.body.data[0]).toHaveProperty("name");
      expect(response.body.data[0]).toHaveProperty("steamid");
      expect(response.body.data[0]).toHaveProperty("server");
      expect(response.body.data[0]).toHaveProperty("server_name");
      expect(response.body.data[0]).toHaveProperty("game");
      expect(response.body.data[0]).toHaveProperty("map");
    });

    it.each([
      ["game", "?game=csgo", " AND game = ?", ["csgo"]],
      [
        "server",
        "?server=185.107.96.59:27015",
        " AND ip = ? AND port = ?",
        ["185.107.96.59", 27015],
      ],
    ])(
      "narrows the online list by %s",
      async (_name, queryString, fragment, expected) => {
        pool.query.mockResolvedValueOnce([[]]);

        await request(app).get(`/players/online${queryString}`).expect(200);

        const [sql, params] = pool.query.mock.calls[0];
        expect(sql).toContain(fragment);
        expect(params).toEqual(expected);
      },
    );

    it("should exclude bots without steamid", async () => {
      pool.query.mockResolvedValueOnce([
        [
          {
            ip: "185.107.96.59",
            port: 27015,
            game: "csgo",
            hostname: "Test Server",
            map: "de_dust2",
            players_list: JSON.stringify([
              {
                userid: 1,
                name: "RealPlayer",
                steamid: "76561198000000001",
                time: "12:34",
                ping: 45,
                state: "active",
                bot: false,
              },
              {
                userid: 2,
                name: "Bot",
                steamid: null,
                time: "00:00",
                ping: 0,
                state: "active",
                bot: true,
              },
            ]),
          },
        ],
      ]);

      const response = await request(app)
        .get("/players/online")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body.total).toBe(1);
      expect(response.body.data[0].name).toBe("RealPlayer");
    });

    it("should handle empty servers", async () => {
      pool.query.mockResolvedValueOnce([
        [
          {
            ip: "185.107.96.59",
            port: 27015,
            game: "csgo",
            hostname: "Empty Server",
            map: "de_dust2",
            players_list: JSON.stringify([]),
          },
        ],
      ]);

      const response = await request(app)
        .get("/players/online")
        .expect("Content-Type", /json/)
        .expect(200);

      expect(response.body.total).toBe(0);
      expect(response.body.data).toHaveLength(0);
    });

    it("should handle database errors", async () => {
      pool.query.mockRejectedValueOnce(new Error("Database error"));

      const response = await request(app)
        .get("/players/online")
        .expect("Content-Type", /json/)
        .expect(500);

      expect(response.body).toHaveProperty("error");
    });
  });
});
