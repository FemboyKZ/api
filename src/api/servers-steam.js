const express = require("express");
const router = express.Router();
const axios = require("axios");
const fs = require("fs").promises;
const path = require("path");
const logger = require("../utils/logger");
const { sanitizeString } = require("../utils/validators");
const {
  cacheMiddleware,
  serversKeyGenerator,
} = require("../utils/cacheMiddleware");

/**
 * @swagger
 * /servers-test:
 *   get:
 *     summary: Get servers from Steam Master Server API
 *     description: Fetches server list from Steam's Master Server Query Protocol
 *     tags: [Servers]
 *     parameters:
 *       - in: query
 *         name: ip
 *         schema:
 *           type: string
 *         description: Filter by specific IP address
 *         example: "37.27.107.76"
 *       - in: query
 *         name: map
 *         schema:
 *           type: string
 *         description: Filter by map name
 *         example: "kz_synergy_x"
 *       - in: query
 *         name: appid
 *         schema:
 *           type: integer
 *         description: Steam App ID (730 for CS:GO, 2357570 for CS2)
 *         example: 730
 *       - in: query
 *         name: gamedir
 *         schema:
 *           type: string
 *         description: Filter by game directory
 *         example: "csgo"
 *     responses:
 *       200:
 *         description: Successful response with server list from Steam
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 servers:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       addr:
 *                         type: string
 *                         description: Server address (IP:Port)
 *                       appid:
 *                         type: integer
 *                         description: Steam App ID
 *                       bots:
 *                         type: integer
 *                         description: Number of bots
 *                       dedicated:
 *                         type: boolean
 *                         description: Whether server is dedicated
 *                       gamedir:
 *                         type: string
 *                         description: Game directory
 *                       gameport:
 *                         type: integer
 *                         description: Game port
 *                       gametype:
 *                         type: string
 *                         description: Game type/tags
 *                       map:
 *                         type: string
 *                         description: Current map
 *                       max_players:
 *                         type: integer
 *                         description: Maximum players
 *                       name:
 *                         type: string
 *                         description: Server name
 *                       os:
 *                         type: string
 *                         description: Operating system
 *                       players:
 *                         type: integer
 *                         description: Current players
 *                       product:
 *                         type: string
 *                         description: Product name
 *                       region:
 *                         type: integer
 *                         description: Region code
 *                       secure:
 *                         type: boolean
 *                         description: VAC secure
 *                       steamid:
 *                         type: string
 *                         description: Server Steam ID
 *                       version:
 *                         type: string
 *                         description: Server version
 *       400:
 *         description: Missing Steam API key
 *       500:
 *         description: Failed to fetch from Steam API
 */
// Cache for 30 seconds
router.get("/", cacheMiddleware(30, serversKeyGenerator), async (req, res) => {
  try {
    const STEAM_API_KEY = process.env.STEAM_API_KEY;

    if (!STEAM_API_KEY) {
      logger.error("STEAM_API_KEY not set in environment variables");
      return res.status(400).json({
        error: "Steam API key not configured on server",
      });
    }

    // Load server configuration
    const configPath = path.join(__dirname, "../../config/servers.json");
    const configData = await fs.readFile(configPath, "utf8");
    const servers = JSON.parse(configData);

    // Extract query parameters for additional filtering
    const { map, appid, gamedir, game } = req.query;

    // Default to CS:GO (730) if no appid specified
    const steamAppId = appid || "730";

    // Filter servers by game type if specified
    let filteredServers = servers;
    if (game) {
      const sanitizedGame = sanitizeString(game, 50);
      filteredServers = servers.filter((s) => s.game === sanitizedGame);
    }

    // Build filter string for Steam API
    // We'll query for each server individually and combine results
    const allResults = [];

    for (const server of filteredServers) {
      const filters = [];
      filters.push(`appid\\${steamAppId}`);
      filters.push(`addr\\${server.ip}:${server.port}`);

      if (map) {
        filters.push(`map\\${sanitizeString(map, 100)}`);
      }

      if (gamedir) {
        filters.push(`gamedir\\${sanitizeString(gamedir, 50)}`);
      }

      const filterString = filters.join("\\");

      try {
        const url =
          "https://api.steampowered.com/IGameServersService/GetServerList/v1/";
        const params = {
          key: STEAM_API_KEY,
          format: "json",
          filter: filterString,
        };

        logger.info(
          `Fetching from Steam Master Server for ${server.ip}:${server.port} with filter: ${filterString}`,
        );

        const response = await axios.get(url, {
          params,
          timeout: 10000,
        });

        if (
          response.data &&
          response.data.response &&
          response.data.response.servers
        ) {
          allResults.push(...response.data.response.servers);
        }
      } catch (error) {
        logger.error(
          `Failed to fetch server ${server.ip}:${server.port} from Steam: ${error.message}`,
        );
        // Continue with other servers even if one fails
      }
    }

    logger.info(
      `Steam Master Server returned ${allResults.length} total servers`,
    );

    res.json({
      count: allResults.length,
      queried_servers: filteredServers.length,
      servers: allResults,
    });
  } catch (error) {
    logger.error(`Failed to fetch from Steam Master Server: ${error.message}`);

    if (error.code === "ENOENT") {
      return res.status(500).json({
        error: "Server configuration file not found",
      });
    }

    res.status(500).json({
      error: "Failed to fetch server list from Steam",
      message: error.message,
    });
  }
});

module.exports = router;
