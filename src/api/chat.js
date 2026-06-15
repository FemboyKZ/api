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
const { isValidIP } = require("../utils/validators");
const { addMessage, wait } = require("../services/crossChat");

const STREAM_HOLD_MS = 25000; // keep < the plugins' 30s request timeout

function parsePort(value) {
  const port = parseInt(value, 10);
  return port >= 1 && port <= 65535 ? port : null;
}

/**
 * POST /chat/messages
 * Body: { ip, port, steamid?, name, message, team? }
 */
router.post("/messages", (req, res) => {
  const { ip, port, steamid, name, message, team } = req.body || {};
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
  });

  if (result && result.error) {
    return res.status(404).json({ error: result.error });
  }
  if (!result) {
    // Sanitized to nothing (e.g. message was only color codes), drop quietly.
    return res.json({ ok: true, dropped: true });
  }

  res.json({ ok: true, id: result.id });
});

/**
 * GET /chat/stream?after=<id>&ip=<ip>&port=<port>
 *
 * `after`     last cursor the caller has seen (-1 / omitted => handshake: get the current cursor with no backlog).
 * `ip`,`port` identify the caller so its own messages are excluded from the relay (it already printed them locally).
 *
 * Response: { cursor, messages: [{ id, alias, game, name, message, team }] }
 */
router.get("/stream", (req, res) => {
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
    .catch((e) => {
      logger.error(`Cross-chat stream error: ${e.message}`);
      if (!res.headersSent) res.status(500).json({ error: "Stream error" });
    });
});

/**
 * GET /chat/history?limit=<n>
 * Most recent messages from the DB, newest first.
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
  } catch (e) {
    logger.error(`Cross-chat history error: ${e.message}`);
    res.status(500).json({ error: "Failed to fetch chat history" });
  }
});

module.exports = router;
