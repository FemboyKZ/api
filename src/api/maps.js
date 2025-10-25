const express = require("express");
const router = express.Router();
const pool = require("../db");

router.get("/", async (req, res) => {
  try {
    const [maps] = await pool.query(
      "SELECT name, SUM(playtime) AS total_playtime FROM maps GROUP BY name",
    );
    res.json(maps);
  } catch (e) {
    res.status(500).json({ error: "Failed to fetch maps" });
  }
});

module.exports = router;
