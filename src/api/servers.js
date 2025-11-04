const express = require("express");
const router = express.Router();
const pool = require("../db");
const { isValidIP, sanitizeString } = require("../utils/validators");
const logger = require("../utils/logger");
const {
  cacheMiddleware,
  serversKeyGenerator,
} = require("../utils/cacheMiddleware");

/**
 * @swagger
 * components:
 *   schemas:
 *     Server:
 *       type: object
 *       properties:
 *         ip:
 *           type: string
 *           description: Server IP address
 *           example: "185.107.96.59"
 *         port:
 *           type: integer
 *           description: Server port
 *           example: 27015
 *         game:
 *           type: string
 *           description: Game type
 *           example: "csgo"
 *         hostname:
 *           type: string
 *           description: Server hostname
 *           example: "FemboyKZ | EU"
 *         region:
 *           type: string
 *           description: Server region
 *           example: "EU"
 *         domain:
 *           type: string
 *           description: Server domain/website
 *           example: "femoboykz.com"
 *         apiId:
 *           type: integer
 *           description: CS2KZ API server ID (for CS2 servers)
 *           example: 4
 *         kztId:
 *           type: integer
 *           description: GlobalKZ API server ID (for CS:GO servers)
 *           example: 1279
 *         tickrate:
 *           type: integer
 *           description: Server tickrate (for CS:GO servers)
 *           example: 128
 *         version:
 *           type: string
 *           description: Server version
 *           example: "1.38.8.1"
 *         os:
 *           type: string
 *           description: Server operating system
 *           example: "Linux"
 *         secure:
 *           type: integer
 *           description: VAC secure status (1=secure, 0=insecure)
 *           example: 1
 *         status:
 *           type: integer
 *           description: Server online status (1=online, 0=offline)
 *           example: 1
 *         map:
 *           type: string
 *           description: Current map (sanitized, without workshop paths)
 *           example: "kz_synergy_x"
 *         players:
 *           type: integer
 *           description: Current player count
 *           example: 12
 *         maxplayers:
 *           type: integer
 *           description: Maximum players
 *           example: 32
 *         bots:
 *           type: integer
 *           description: Number of bots
 *           example: 0
 *         playersList:
 *           type: array
 *           description: List of current players (from RCON if available)
 *           items:
 *             type: object
 *             properties:
 *               userid:
 *                 type: integer
 *               name:
 *                 type: string
 *               steamid:
 *                 type: string
 *               time:
 *                 type: string
 *               ping:
 *                 type: integer
 *               loss:
 *                 type: integer
 *               state:
 *                 type: string
 *               bot:
 *                 type: boolean
 *     Servers:
 *       type: object
 *       properties:
 *         playersTotal:
 *           type: integer
 *           description: Total players across all servers
 *           example: 45
 *         serversOnline:
 *           type: integer
 *           description: Number of online servers
 *           example: 3
 *       additionalProperties:
 *         $ref: '#/components/schemas/Server'
 */

/**
 * @swagger
 * /servers:
 *   get:
 *     summary: Get all servers
 *     description: Returns a list of all game servers with their current status
 *     tags: [Servers]
 *     parameters:
 *       - in: query
 *         name: game
 *         schema:
 *           type: string
 *         description: Filter by game type (csgo, counterstrike2)
 *         example: csgo
 *       - in: query
 *         name: status
 *         schema:
 *           type: integer
 *         description: Filter by status (1=online, 0=offline). Default is 1 (online only)
 *         example: 1
 *     responses:
 *       200:
 *         description: Successful response with server list
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ServersResponse'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Failed to fetch servers"
 */
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
    }
    // Removed default status=1 filter to show all servers including offline ones

    logger.info(
      `Executing query: ${query} with params: ${JSON.stringify(params)}`,
    );

    const [rows] = await pool.query(query, params);

    logger.info(`Query returned ${rows.length} rows`);

    const response = {
      playersTotal: rows.reduce((a, s) => a + s.player_count, 0),
      serversOnline: rows.filter((s) => s.status === 1).length,
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

          // Remove IP addresses from player data for privacy
          playersList = playersList.map((player) => {
            const { ip, ...playerWithoutIp } = player;
            return playerWithoutIp;
          });
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
        hostname: server.hostname,
        version: server.version,
        os: server.os,
        secure: server.secure,
        status: server.status,
        map: server.map,
        players: server.player_count,
        maxplayers: server.maxplayers,
        bots: server.bot_count,
        playersList: playersList,
        region: server.region,
        domain: server.domain,
        apiId: server.api_id,
        kztId: server.kzt_id,
        tickrate: server.tickrate,
      };
    });
    res.json(response);
  } catch (e) {
    logger.error(`Failed to fetch servers: ${e.message}`);
    res.status(500).json({ error: "Failed to fetch servers" });
  }
});

/**
 * @swagger
 * /servers/{ip}:
 *   get:
 *     summary: Get server by IP address
 *     description: Returns detailed information for a specific server by IP
 *     tags: [Servers]
 *     parameters:
 *       - in: path
 *         name: ip
 *         required: true
 *         schema:
 *           type: string
 *         description: Server IP address
 *         example: "185.107.96.59"
 *     responses:
 *       200:
 *         description: Successful response with server details
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Server'
 *       400:
 *         description: Invalid IP address format
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Invalid IP address format"
 *       404:
 *         description: Server not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Server not found"
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Server fetch error"
 */
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

    // Process each server to remove player IPs from players_list
    const servers = rows.map((server) => {
      let playersList = [];
      if (server.players_list) {
        try {
          playersList =
            typeof server.players_list === "string"
              ? JSON.parse(server.players_list)
              : server.players_list;

          // Remove IP addresses from player data for privacy
          playersList = playersList.map((player) => {
            const { ip, ...playerWithoutIp } = player;
            return playerWithoutIp;
          });
        } catch (e) {
          logger.error(
            `Failed to parse players_list for ${server.ip}:${server.port}`,
            { error: e.message },
          );
          playersList = [];
        }
      }

      return {
        ip: server.ip,
        port: server.port,
        game: server.game,
        hostname: server.hostname,
        version: server.version,
        os: server.os,
        secure: server.secure,
        status: server.status,
        map: server.map,
        player_count: server.player_count,
        maxplayers: server.maxplayers,
        bot_count: server.bot_count,
        players_list: playersList,
        region: server.region,
        domain: server.domain,
        api_id: server.api_id,
        kzt_id: server.kzt_id,
        tickrate: server.tickrate,
        last_update: server.last_update,
        created_at: server.created_at,
      };
    });

    res.json(servers);
  } catch (e) {
    logger.error(`Server fetch error for IP ${req.params.ip}: ${e.message}`);
    res.status(500).json({ error: "Server fetch error" });
  }
});

/**
 * @swagger
 * /servers/{ip}/{port}:
 *   get:
 *     summary: Get server by IP and port
 *     description: Returns detailed information for a specific server by IP address and port
 *     tags: [Servers]
 *     parameters:
 *       - in: path
 *         name: ip
 *         required: true
 *         schema:
 *           type: string
 *         description: Server IP address
 *         example: "185.107.96.59"
 *       - in: path
 *         name: port
 *         required: true
 *         schema:
 *           type: integer
 *         description: Server port
 *         example: 27015
 *     responses:
 *       200:
 *         description: Successful response with server details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Server'
 *       400:
 *         description: Invalid IP address or port format
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Invalid IP address format"
 *       404:
 *         description: Server not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Server not found"
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Server fetch error"
 */
router.get("/:ip/:port", async (req, res) => {
  try {
    const { ip, port } = req.params;

    if (!isValidIP(ip)) {
      return res.status(400).json({ error: "Invalid IP address format" });
    }

    const portNum = parseInt(port, 10);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      return res.status(400).json({ error: "Invalid port number" });
    }

    const [rows] = await pool.query(
      "SELECT * FROM servers WHERE ip = ? AND port = ?",
      [ip, portNum]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Server not found" });
    }

    const server = rows[0];
    let playersList = [];
    
    if (server.players_list) {
      try {
        playersList =
          typeof server.players_list === "string"
            ? JSON.parse(server.players_list)
            : server.players_list;

        // Remove IP addresses from player data for privacy
        playersList = playersList.map((player) => {
          const { ip, ...playerWithoutIp } = player;
          return playerWithoutIp;
        });
      } catch (e) {
        logger.error(
          `Failed to parse players_list for ${server.ip}:${server.port}`,
          { error: e.message },
        );
        playersList = [];
      }
    }

    const response = {
      ip: server.ip,
      port: server.port,
      game: server.game,
      hostname: server.hostname,
      version: server.version,
      os: server.os,
      secure: server.secure,
      status: server.status,
      map: server.map,
      player_count: server.player_count,
      maxplayers: server.maxplayers,
      bot_count: server.bot_count,
      players_list: playersList,
      region: server.region,
      domain: server.domain,
      api_id: server.api_id,
      kzt_id: server.kzt_id,
      tickrate: server.tickrate,
      last_update: server.last_update,
      created_at: server.created_at,
    };

    res.json(response);
  } catch (e) {
    logger.error(`Server fetch error for ${req.params.ip}:${req.params.port}: ${e.message}`);
    res.status(500).json({ error: "Server fetch error" });
  }
});

module.exports = router;
