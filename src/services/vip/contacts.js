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
const pool = require("../../db");
const logger = require("../../utils/logger");
const { redeemPendingGifts } = require("./entitlements");

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

/**
 * Redeem an email verification token and link the address to the player.
 *
 * Owns its transaction:
 * the verification row stays locked from the validity checks through to being consumed, so a token cannot be redeemed twice.
 *
 * Note the "email_taken" refusal still commits -
 * it records the attempt and burns the token deliberately, so a rejected address cannot be retried.
 *
 * @param {string} token - the clear token; only its hash is ever queried
 * @returns {Promise<{steamid: string, email: string, redeemed: *}
 *   | {refused: "invalid_token"|"already_used"|"expired"}
 *   | {refused: "email_taken", existing: string}>}
 *   Throws on any database failure, having rolled back.
 */
async function verifyEmailToken(token) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT id, steamid, email, expires_at, consumed_at
       FROM player_email_verifications WHERE token_hash = ? FOR UPDATE`,
      [hashToken(token)],
    );
    if (!rows.length) {
      await conn.rollback();
      return { refused: "invalid_token" };
    }
    const v = rows[0];
    if (v.consumed_at) {
      await conn.rollback();
      return { refused: "already_used" };
    }
    if (new Date(v.expires_at).getTime() < Date.now()) {
      await conn.rollback();
      return { refused: "expired" };
    }

    // One email maps to one SteamID. If it is already spoken for,
    // record the attempt and consume the token so it cannot be retried, then commit.
    const [taken] = await conn.query(
      "SELECT steamid FROM player_meta WHERE email = ? AND steamid <> ? LIMIT 1",
      [v.email, v.steamid],
    );
    if (taken.length) {
      await logContact(
        v.steamid,
        "email",
        v.email,
        "blocked",
        `already linked to ${taken[0].steamid}`,
        conn,
      );
      await conn.query(
        "UPDATE player_email_verifications SET consumed_at = CURRENT_TIMESTAMP WHERE id = ?",
        [v.id],
      );
      await conn.commit();
      return { refused: "email_taken", existing: taken[0].steamid };
    }

    const [metaRows] = await conn.query(
      "SELECT email FROM player_meta WHERE steamid = ? FOR UPDATE",
      [v.steamid],
    );
    const oldEmail = metaRows.length ? metaRows[0].email : null;
    if (oldEmail && oldEmail !== v.email) {
      await logContact(v.steamid, "email", oldEmail, "replaced", null, conn);
    }

    await conn.query(
      `INSERT INTO player_meta (steamid, email, email_verified_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON DUPLICATE KEY UPDATE email = VALUES(email),
                               email_verified_at = CURRENT_TIMESTAMP,
                               updated_at = CURRENT_TIMESTAMP`,
      [v.steamid, v.email],
    );
    await logContact(v.steamid, "email", v.email, "linked", null, conn);

    await conn.query(
      "UPDATE player_email_verifications SET consumed_at = CURRENT_TIMESTAMP WHERE id = ?",
      [v.id],
    );

    // Gifts that were waiting on this email (or this SteamID) land now.
    const redeemed = await redeemPendingGifts(conn, v.steamid, v.email);

    await conn.commit();
    return { steamid: v.steamid, email: v.email, redeemed };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

module.exports = {
  isValidEmail,
  normalizeEmail,
  hashToken,
  generateToken,
  logContact,
  verifyEmailToken,
  findSteamIDByEmail,
};
