/**
 * Cross-server chat endpoints.
 *
 * Mounted under adminAuth (same auth the plugins already use for /servers/status),
 * so every request carries the server's bearer key.
 *
 *   POST /chat/messages      ingest one chat line from a server
 *   GET  /chat/stream        long-poll for new messages (other servers)
 *   GET  /chat/history       recent messages from the DB (web / tooling)
 *
 * Live delivery uses long-poll: the request parks for up to STREAM_HOLD_MS and
 * returns the instant any server posts a message.
 */

const express = require("express");
const router = express.Router();
const pool = require("../db");
const logger = require("../utils/logger");
const { isValidIP, parsePort } = require("../utils/validators");
const { addMessage, wait } = require("../services/crossChat");

const STREAM_HOLD_MS = 25000; // keep < the plugins' 30s request timeout

/**
 * @swagger
 * /chat/messages:
 *   post:
 *     summary: Ingest one chat line from a server
 *     description: >
 *       A message that sanitizes to nothing (for example one made only of colour
 *       codes) is dropped quietly and still answers 200, with dropped set to true.
 *     tags: [Chat]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyHeader: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [ip, port, message]
 *             properties:
 *               ip:
 *                 type: string
 *               port:
 *                 type: integer
 *               steamid:
 *                 type: string
 *               name:
 *                 type: string
 *               message:
 *                 type: string
 *               team:
 *                 type: integer
 *               muted:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Message accepted, or dropped after sanitizing
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 id:
 *                   type: integer
 *                 dropped:
 *                   type: boolean
 *       400:
 *         description: Invalid server ip/port, or missing message
 *       401:
 *         description: Missing or invalid API key
 *       404:
 *         description: Server not registered for the chat relay
 */
router.post("/messages", (req, res) => {
  const { ip, port, steamid, name, message, team, muted } = req.body || {};
  const portNum = parsePort(port);

  if (!ip || !isValidIP(ip) || !portNum) {
    return res.status(400).json({ error: "Invalid server ip/port" });
  }
  if (typeof message !== "string" || message.trim() === "") {
    return res.status(400).json({ error: "Missing message" });
  }

  const result = addMessage({
    ip,
    port: portNum,
    steamid,
    name,
    message,
    team,
    muted,
  });

  if (result && result.error) {
    return res.status(404).json({ error: result.error });
  }
  if (!result) {
    // Sanitized to nothing (e.g. message was only color codes), drop quietly.
    return res.json({ success: true, dropped: true });
  }

  res.json({ success: true, id: result.id });
});

/**
 * @swagger
 * /chat/stream:
 *   get:
 *     summary: Long-poll for new chat messages
 *     description: >
 *       Parks the request for up to 25 seconds and returns as soon as any other
 *       server posts a message. This response shape is a fixed contract with the
 *       game-server plugins.
 *     tags: [Chat]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyHeader: []
 *     parameters:
 *       - in: query
 *         name: after
 *         schema:
 *           type: integer
 *           default: -1
 *         description: >
 *           Last cursor the caller has seen. Omitted or -1 is a handshake that
 *           returns the current cursor with no backlog.
 *       - in: query
 *         name: ip
 *         schema:
 *           type: string
 *         description: Caller's address, so its own messages are excluded from the relay
 *       - in: query
 *         name: port
 *         schema:
 *           type: integer
 *         description: Caller's port, paired with ip
 *     responses:
 *       200:
 *         description: Cursor and any messages since it
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 cursor:
 *                   type: integer
 *                 messages:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                       alias:
 *                         type: string
 *                       game:
 *                         type: string
 *                       name:
 *                         type: string
 *                       message:
 *                         type: string
 *                       team:
 *                         type: integer
 *                       muted:
 *                         type: boolean
 *       401:
 *         description: Missing or invalid API key
 *       500:
 *         description: Stream error
 */
router.get("/stream", (req, res) => {
  // Long-poll responses repeat (e.g. an empty {messages:[]} on timeout), so
  // Express' ETag would make the client's next request 304 Not Modified. Drop
  // the conditional request headers and disable caching so every poll gets a
  // fresh 200 the plugin can parse.
  delete req.headers["if-none-match"];
  delete req.headers["if-modified-since"];
  res.set("Cache-Control", "no-store");

  const after = parseInt(req.query.after, 10);
  const cursor = Number.isFinite(after) ? after : -1;

  let excludeKey = null;
  const portNum = parsePort(req.query.port);
  if (req.query.ip && isValidIP(req.query.ip) && portNum) {
    excludeKey = `${req.query.ip}:${portNum}`;
  }

  const { promise, cancel } = wait(cursor, excludeKey, STREAM_HOLD_MS);
  req.on("close", cancel);

  promise
    .then((result) => {
      if (result.aborted) return; // client went away, nothing to send
      res.json({ cursor: result.cursor, messages: result.messages });
    })
    .catch((error) => {
      logger.error(`Cross-chat stream error: ${error.message}`);
      if (!res.headersSent) res.status(500).json({ error: "Stream error" });
    });
});

/**
 * @swagger
 * /chat/history:
 *   get:
 *     summary: Recent chat messages from the database
 *     description: Newest first. Unlike /chat/stream this reads stored history rather than long-polling.
 *     tags: [Chat]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyHeader: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *           minimum: 1
 *           maximum: 200
 *     responses:
 *       200:
 *         description: Stored messages, newest first
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 total:
 *                   type: integer
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *       401:
 *         description: Missing or invalid API key
 *       500:
 *         description: Server error
 */
router.get("/history", async (req, res) => {
  try {
    const limit = Math.min(
      Math.max(parseInt(req.query.limit, 10) || 50, 1),
      200,
    );
    const [rows] = await pool.query(
      `SELECT id, alias, game, region, steamid, name, message, team, created_at
       FROM chat_messages ORDER BY id DESC LIMIT ?`,
      [limit],
    );
    res.json({ total: rows.length, data: rows });
  } catch (error) {
    logger.error(`Cross-chat history error: ${error.message}`);
    res.status(500).json({ error: "Failed to fetch chat history" });
  }
});

module.exports = router;
