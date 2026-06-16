/**
 * Player Contacts Service
 *
 * Shared helpers for linking/unlinking player email + discord, with a private
 * audit history retained for fraud detection.
 * Also provides the email-match backup used by the Ko-fi webhook when no SteamID is parseable from the order message.
 *
 * All contact data is PRIVATE and only surfaced through admin-authed routes.
 */

const crypto = require("crypto");
const pool = require("../db");
const logger = require("../utils/logger");

// Basic, deliberately strict-enough email check (not RFC-perfect on purpose).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(email) {
  return (
    typeof email === "string" && email.length <= 254 && EMAIL_RE.test(email)
  );
}

function normalizeEmail(email) {
  return String(email).trim().toLowerCase();
}

/** Hash a raw verification token for at-rest storage. */
function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** Generate a URL-safe random verification token. */
function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Append a contact-history audit row.
 * Accepts an optional connection so callers inside a transaction can include it,
 * defaults to the pool.
 */
async function logContact(
  steamid,
  type,
  value,
  action,
  note = null,
  conn = pool,
) {
  await conn.query(
    `INSERT INTO player_contact_history (steamid, type, value, action, note)
     VALUES (?, ?, ?, ?, ?)`,
    [steamid, type, value, action, note],
  );
}

/**
 * Resolve a SteamID from a verified email (Ko-fi backup path).
 * @param {string} email
 * @returns {Promise<{ steamid: string }|{ ambiguous: true, count: number }|null>}
 */
async function findSteamIDByEmail(email) {
  if (!isValidEmail(email)) return null;
  const normalized = normalizeEmail(email);
  const [rows] = await pool.query(
    "SELECT steamid FROM player_meta WHERE email = ? AND email IS NOT NULL",
    [normalized],
  );
  if (rows.length === 0) return null;
  if (rows.length > 1) {
    logger.warn("Ko-fi/contacts: email maps to multiple SteamIDs", {
      email: normalized,
      count: rows.length,
    });
    return { ambiguous: true, count: rows.length };
  }
  return { steamid: rows[0].steamid };
}

module.exports = {
  isValidEmail,
  normalizeEmail,
  hashToken,
  generateToken,
  logContact,
  findSteamIDByEmail,
};
