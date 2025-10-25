const express = require("express");
const router = express.Router();
const pool = require("../db");
const {
  validatePagination,
  sanitizeString,
  isValidIP,
  isValidPort,
} = require("../utils/validators");
const logger = require("../utils/logger");
const {
  cacheMiddleware,
  mapsKeyGenerator,
} = require("../utils/cacheMiddleware");

// Cache for 30 seconds
router.get("/", cacheMiddleware(30, mapsKeyGenerator), async (req, res) => {
  try {
    const { page, limit, sort, order, server, name } = req.query;
    const { limit: validLimit, offset } = validatePagination(page, limit, 100);

    const validSortFields = ["total_playtime", "name"];
    const sortField = validSortFields.includes(sort)
      ? sort
      : "total_playtime";
    const sortOrder = order === "asc" ? "ASC" : "DESC";

    let query =
      "SELECT name, SUM(playtime) AS total_playtime FROM maps WHERE 1=1";
    const params = [];

    if (server) {
      const [ip, port] = server.split(":");
      if (ip && port && isValidIP(ip) && isValidPort(port)) {
        query += " AND server_ip = ? AND server_port = ?";
        params.push(ip, parseInt(port, 10));
      }
    }

    if (name) {
      query += " AND name LIKE ?";
      params.push(`%${sanitizeString(name, 100)}%`);
    }

    query += ` GROUP BY name ORDER BY ${sortField} ${sortOrder} LIMIT ? OFFSET ?`;
    params.push(validLimit, offset);

    const [maps] = await pool.query(query, params);

    let countQuery = "SELECT COUNT(DISTINCT name) as total FROM maps WHERE 1=1";
    const countParams = [];
    if (server) {
      const [ip, port] = server.split(":");
      if (ip && port && isValidIP(ip) && isValidPort(port)) {
        countQuery += " AND server_ip = ? AND server_port = ?";
        countParams.push(ip, parseInt(port, 10));
      }
    }
    if (name) {
      countQuery += " AND name LIKE ?";
      countParams.push(`%${sanitizeString(name, 100)}%`);
    }

    const [countResult] = await pool.query(countQuery, countParams);

    res.json({
      data: maps,
      pagination: {
        page: parseInt(page, 10) || 1,
        limit: validLimit,
        total: countResult[0].total,
        totalPages: Math.ceil(countResult[0].total / validLimit),
      },
    });
  } catch (e) {
    logger.error(`Failed to fetch maps: ${e.message}`);
    res.status(500).json({ error: "Failed to fetch maps" });
  }
});

module.exports = router;
