const express = require("express");
const router = express.Router();
const pool = require("../db");

router.get("/", async (req, res) => {
  try {
    const [players] = await pool.query(
      "SELECT steamid, SUM(playtime) as total_playtime FROM players GROUP BY steamid",
    );
    res.json(players);
  } catch (e) {
    res.status(500).json({ error: "Failed to fetch players" });
  }
});

router.get("/:steamid", async (req, res) => {
  try {
    const { steamid } = req.params;
    const [rows] = await pool.query("SELECT * FROM players WHERE steamid = ?", [
      steamid,
    ]);
    if (rows.length === 0)
      return res.status(404).json({ error: "Player not found" });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: "Player fetch error" });
  }
});

module.exports = router;
