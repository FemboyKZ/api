const express = require("express");
const router = express.Router();
const pool = require("../db");

router.get("/", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM servers WHERE status=1");
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
    res.status(500).json({ error: "Failed to fetch servers" });
  }
});

router.get("/:ip", async (req, res) => {
  try {
    const { ip } = req.params;
    const [rows] = await pool.query("SELECT * FROM servers WHERE ip = ?", [ip]);
    if (rows.length === 0)
      return res.status(404).json({ error: "Server not found" });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: "Server fetch error" });
  }
});

module.exports = router;
