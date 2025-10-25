const express = require("express");
const router = express.Router();
const pool = require("../db");
const { isValidIP, sanitizeString } = require("../utils/validators");
const logger = require("../utils/logger");
const {
  cacheMiddleware,
  serversKeyGenerator,
} = require("../utils/cacheMiddleware");

// Cache for 30 seconds
router.get("/", cacheMiddleware(30, serversKeyGenerator), async (req, res) => {
  try {
    const { game, status } = req.query;
    let query = "SELECT * FROM servers WHERE 1=1";
    const params = [];

    if (game) {
      query += " AND game = ?";
      params.push(sanitizeString(game, 50));
    }

    if (status !== undefined) {
      query += " AND status = ?";
      params.push(parseInt(status, 10) || 0);
    } else {
      query += " AND status = 1";
    }

    logger.info(
      `Executing query: ${query} with params: ${JSON.stringify(params)}`,
    );

    const [rows] = await pool.query(query, params);

    logger.info(`Query returned ${rows.length} rows`);

    const response = {
      playersTotal: rows.reduce((a, s) => a + s.player_count, 0),
      serversOnline: rows.length,
    };
    rows.forEach((server) => {
      // Parse players_list - MariaDB JSON columns return as strings even with jsonStrings: false
      let playersList = [];
      if (server.players_list) {
        try {
          playersList =
            typeof server.players_list === "string"
              ? JSON.parse(server.players_list)
              : server.players_list;
        } catch (e) {
          logger.error(
            `Failed to parse players_list for ${server.ip}:${server.port}`,
            { error: e.message },
          );
          playersList = [];
        }
      }

      response[`${server.ip}:${server.port}`] = {
        ip: server.ip,
        port: server.port,
        game: server.game,
        status: server.status,
        map: server.map,
        players: server.player_count,
        maxplayers: server.maxplayers,
        playersList: playersList,
        version: server.version,
        hostname: server.hostname,
        os: server.os,
        secure: server.secure,
        steamid: server.steamid,
        botCount: server.bot_count,
      };
    });
    res.json(response);
  } catch (e) {
    logger.error(`Failed to fetch servers: ${e.message}`);
    res.status(500).json({ error: "Failed to fetch servers" });
  }
});

router.get("/:ip", async (req, res) => {
  try {
    const { ip } = req.params;

    if (!isValidIP(ip)) {
      return res.status(400).json({ error: "Invalid IP address format" });
    }

    const [rows] = await pool.query("SELECT * FROM servers WHERE ip = ?", [ip]);
    if (rows.length === 0) {
      return res.status(404).json({ error: "Server not found" });
    }
    res.json(rows);
  } catch (e) {
    logger.error(`Server fetch error for IP ${req.params.ip}: ${e.message}`);
    res.status(500).json({ error: "Server fetch error" });
  }
});

module.exports = router;
