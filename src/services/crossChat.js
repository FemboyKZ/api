/**
 * Cross-server chat relay.
 *
 * In-game plugins POST every chat line to /chat/messages. This module:
 *   - resolves the origin server (ip:port) to its alias/game/region from
 *     config/servers.json,
 *   - assigns a monotonic relay cursor id and keeps the last N messages in a
 *     ring buffer,
 *   - persists each message to the chat_messages table (best effort),
 *   - wakes any parked long-poll readers (GET /chat/stream) so other servers
 *     receive the message near-instantly,
 *   - mirrors the message to Socket.IO subscribers (web).
 *
 * The cursor is in-memory only and resets when the API restarts;
 * plugins re-sync via the `after=-1` handshake, so a restart just drops backlog,
 * never breaks the stream.
 */

const fs = require("fs");
const path = require("path");
const pool = require("../db");
const logger = require("../utils/logger");
const {
  sanitizePlayerName,
  convertToSteamID64,
} = require("../utils/validators");
const { emitChatMessage } = require("./websocket");

const RING_CAPACITY = 300; // messages kept in memory for late readers
const MAX_MESSAGE_LEN = 512;
const MAX_NAME_LEN = 64;

// ip:port -> { alias, game, region }
let serverLookup = new Map();

// Ring buffer of recent messages; each entry is the full internal record.
const ring = [];
let nextId = 1;

// Parked long-poll readers: Set of { after, excludeKey, resolve, timer }.
const waiters = new Set();

/**
 * (Re)load the ip:port -> metadata map from config/servers.json.
 * Mirrors the path used by services/updater.js (relative to the process cwd).
 */
function loadServerLookup() {
  try {
    const file = path.join(process.cwd(), "config", "servers.json");
    const servers = JSON.parse(fs.readFileSync(file, "utf8"));
    const map = new Map();
    for (const s of servers) {
      if (!s.ip || !s.port || !s.alias) continue;
      map.set(`${s.ip}:${s.port}`, {
        alias: s.alias,
        game: s.game || "unknown",
        region: s.region || null,
      });
    }
    serverLookup = map;
    logger.info(`Cross-chat: loaded ${map.size} server aliases`);
  } catch (e) {
    logger.error(`Cross-chat: failed to load server aliases: ${e.message}`);
  }
}

/**
 * Strip in-game color/control codes, collapse whitespace, cap length.
 * Keeps visible Unicode (emoji, hearts, non-latin text).
 */
function sanitizeMessage(text) {
  if (!text || typeof text !== "string") return "";
  let cleaned = text.replace(/[\x00-\x1F\x7F]/g, ""); // color codes / control
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  return cleaned.substring(0, MAX_MESSAGE_LEN);
}

function headId() {
  return nextId - 1;
}

/**
 * Messages newer than `after`, excluding those originating from `excludeKey`
 * (the caller's own server already showed them locally).
 */
function getSince(after, excludeKey) {
  const out = [];
  for (const m of ring) {
    if (m.id > after && m.serverKey !== excludeKey) out.push(toWire(m));
  }
  return out;
}

// Lean shape sent to the game servers.
function toWire(m) {
  return {
    id: m.id,
    alias: m.alias,
    game: m.game,
    name: m.name,
    message: m.message,
    team: m.team,
  };
}

function removeWaiter(w) {
  if (waiters.has(w)) {
    clearTimeout(w.timer);
    waiters.delete(w);
  }
}

/**
 * Ingest a chat line. Returns the stored record, or null when the message is
 * unusable, or { error } when the origin server is unknown.
 */
function addMessage({ ip, port, steamid, name, message, team }) {
  const serverKey = `${ip}:${port}`;
  const cfg = serverLookup.get(serverKey);
  if (!cfg) return { error: "Server not registered" };

  const cleanName = (sanitizePlayerName(name) || "Unknown").substring(
    0,
    MAX_NAME_LEN,
  );
  const cleanMsg = sanitizeMessage(message);
  if (!cleanMsg) return null; // empty after sanitization, nothing to relay

  const record = {
    id: nextId++,
    serverKey,
    ip,
    port,
    alias: cfg.alias,
    game: cfg.game,
    region: cfg.region,
    steamid: convertToSteamID64(steamid) || null,
    name: cleanName,
    message: cleanMsg,
    team: team ? 1 : 0,
    ts: Date.now(),
  };

  ring.push(record);
  if (ring.length > RING_CAPACITY) ring.shift();

  persist(record);
  wakeWaiters();

  emitChatMessage({
    alias: record.alias,
    game: record.game,
    region: record.region,
    name: record.name,
    message: record.message,
    team: record.team,
  });

  return record;
}

function persist(record) {
  pool
    .query(
      `INSERT INTO chat_messages
       (server_ip, server_port, alias, game, region, steamid, name, message, team)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.ip,
        record.port,
        record.alias,
        record.game,
        record.region,
        record.steamid,
        record.name,
        record.message,
        record.team,
      ],
    )
    .catch((e) => logger.error(`Cross-chat persist failed: ${e.message}`));
}

function wakeWaiters() {
  for (const w of [...waiters]) {
    const msgs = getSince(w.after, w.excludeKey);
    if (msgs.length > 0) {
      removeWaiter(w);
      w.resolve({ cursor: headId(), messages: msgs, aborted: false });
    }
  }
}

/**
 * Long-poll read. Resolves immediately if backlog exists, otherwise parks until
 * a new message arrives or timeoutMs elapses.
 *
 * Returns { promise, cancel }. The router awaits `promise` and must call
 * `cancel()` if the client disconnects first (so the waiter/timer is freed).
 * Resolved value: { cursor, messages, aborted } `aborted` true means the
 * client went away and no response should be written.
 */
function wait(after, excludeKey, timeoutMs) {
  // Handshake: a fresh reader (after < 0) just syncs to the current cursor with no backlog,
  // so a server joining mid-session never replays old chat.
  if (after < 0) {
    return {
      promise: Promise.resolve({
        cursor: headId(),
        messages: [],
        aborted: false,
      }),
      cancel: () => {},
    };
  }

  const backlog = getSince(after, excludeKey);
  if (backlog.length > 0) {
    return {
      promise: Promise.resolve({
        cursor: headId(),
        messages: backlog,
        aborted: false,
      }),
      cancel: () => {},
    };
  }

  let waiter;
  const promise = new Promise((resolve) => {
    waiter = { after, excludeKey, resolve };
    waiter.timer = setTimeout(() => {
      removeWaiter(waiter);
      resolve({ cursor: headId(), messages: [], aborted: false });
    }, timeoutMs);
    waiters.add(waiter);
  });

  const cancel = () => {
    if (waiters.has(waiter)) {
      removeWaiter(waiter);
      waiter.resolve({ cursor: headId(), messages: [], aborted: true });
    }
  };

  return { promise, cancel };
}

module.exports = {
  loadServerLookup,
  addMessage,
  wait,
  headId,
  // exposed for tests
  _ring: ring,
};
