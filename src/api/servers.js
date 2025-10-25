const express = require("express");
const router = express.Router();
const pool = require("../db");
const { isValidIP, sanitizeString } = require("../utils/validators");
const logger = require("../utils/logger");

router.get("/", async (req, res) => {
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

    const [rows] = await pool.query(query, params);
    const response = {
      playersTotal: rows.reduce((a, s) => a + s.player_count, 0),
      serversOnline: rows.length,
    };
    rows.forEach((server) => {
      response[`${server.ip}:${server.port}`] = {
        ip: server.ip,
        port: server.port,
        game: server.game,
        status: server.status,
        map: server.map,
        players: server.player_count,
        version: server.version,
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
