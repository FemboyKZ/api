const express = require("express");
const router = express.Router();
const pool = require("../db");
const {
  isValidSteamID,
  validatePagination,
  sanitizeString,
} = require("../utils/validators");
const logger = require("../utils/logger");

router.get("/", async (req, res) => {
  try {
    const { page, limit, sort, order, name } = req.query;
    const { limit: validLimit, offset } = validatePagination(page, limit, 100);

    const validSortFields = ["total_playtime", "steamid"];
    const sortField = validSortFields.includes(sort)
      ? sort
      : "total_playtime";
    const sortOrder = order === "asc" ? "ASC" : "DESC";

    let query =
      "SELECT steamid, SUM(playtime) as total_playtime FROM players";
    const params = [];

    if (name) {
      query += " WHERE name LIKE ?";
      params.push(`%${sanitizeString(name, 100)}%`);
    }

    query += ` GROUP BY steamid ORDER BY ${sortField} ${sortOrder} LIMIT ? OFFSET ?`;
    params.push(validLimit, offset);

    const [players] = await pool.query(query, params);

    let countQuery = "SELECT COUNT(DISTINCT steamid) as total FROM players";
    const countParams = [];
    if (name) {
      countQuery += " WHERE name LIKE ?";
      countParams.push(`%${sanitizeString(name, 100)}%`);
    }
    const [countResult] = await pool.query(countQuery, countParams);

    res.json({
      data: players,
      pagination: {
        page: parseInt(page, 10) || 1,
        limit: validLimit,
        total: countResult[0].total,
        totalPages: Math.ceil(countResult[0].total / validLimit),
      },
    });
  } catch (e) {
    logger.error(`Failed to fetch players: ${e.message}`);
    res.status(500).json({ error: "Failed to fetch players" });
  }
});

router.get("/:steamid", async (req, res) => {
  try {
    const { steamid } = req.params;

    if (!isValidSteamID(steamid)) {
      return res.status(400).json({ error: "Invalid SteamID format" });
    }

    const [rows] = await pool.query(
      "SELECT * FROM players WHERE steamid = ? ORDER BY last_seen DESC",
      [steamid],
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "Player not found" });
    }

    const [stats] = await pool.query(
      "SELECT SUM(playtime) as total_playtime, MAX(last_seen) as last_seen FROM players WHERE steamid = ?",
      [steamid],
    );

    res.json({
      steamid,
      total_playtime: stats[0].total_playtime || 0,
      last_seen: stats[0].last_seen,
      sessions: rows,
    });
  } catch (e) {
    logger.error(`Player fetch error for ${req.params.steamid}: ${e.message}`);
    res.status(500).json({ error: "Player fetch error" });
  }
});

module.exports = router;
