const express = require("express");
const router = express.Router();
const pool = require("../db");
const logger = require("../utils/logger");
const { adminAuth } = require("../utils/auth");
const { isValidSteamID, convertToSteamID64 } = require("../utils/validators");
const {
  isValidEmail,
  normalizeEmail,
  hashToken,
  generateToken,
  logContact,
} = require("../services/playerContacts");
const { redeemPendingGifts } = require("../services/entitlements");

// All contact-linking routes require admin auth
// (site2 calls them server-side after proving SteamID ownership via Steam OpenID).
// Contact data is private.
router.use(adminAuth);

const DISCORD_ID_RE = /^[0-9]{15,20}$/;
const DEFAULT_TOKEN_TTL_HOURS = 24;

function resolveSteamID(input) {
  if (!isValidSteamID(input)) return null;
  return convertToSteamID64(input);
}

/**
 * POST /links/email/request
 * Begin email verification. Stores a hashed token and returns the RAW token
 * once so the caller (site2) can email a verification link.
 * Linking is allowed regardless of VIP status.
 * Body: { steamid, email, expiresInHours? }
 * Returns: { token, expiresAt }
 */
router.post("/email/request", async (req, res) => {
  try {
    const { steamid, email, expiresInHours } = req.body || {};
    const steamid64 = resolveSteamID(steamid);
    if (!steamid64) {
      return res.status(400).json({ error: "Invalid SteamID format" });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "Invalid email format" });
    }

    const normalized = normalizeEmail(email);
    const token = generateToken();
    const ttlHours =
      Number.isFinite(expiresInHours) && expiresInHours > 0
        ? Math.min(expiresInHours, 168)
        : DEFAULT_TOKEN_TTL_HOURS;
    const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000);

    await pool.query(
      `INSERT INTO player_email_verifications (steamid, email, token_hash, expires_at)
       VALUES (?, ?, ?, ?)`,
      [
        steamid64,
        normalized,
        hashToken(token),
        expiresAt.toISOString().slice(0, 19).replace("T", " "),
      ],
    );

    logger.info(`Contacts: email verification requested for ${steamid64}`);
    res.json({
      success: true,
      steamid: steamid64,
      token, // raw token, returned exactly once
      expiresAt: expiresAt.toISOString(),
    });
  } catch (error) {
    logger.error("Contacts: email request failed", { error: error.message });
    res.status(500).json({ error: "Failed to create verification" });
  }
});

/**
 * POST /links/email/verify
 * Consume a verification token and link the email to the SteamID.
 * Body: { token }
 */
router.post("/email/verify", async (req, res) => {
  const { token } = req.body || {};
  if (!token || typeof token !== "string") {
    return res.status(400).json({ error: "Missing token" });
  }

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
      return res.status(404).json({ error: "Invalid token" });
    }
    const v = rows[0];
    if (v.consumed_at) {
      await conn.rollback();
      return res.status(409).json({ error: "Token already used" });
    }
    if (new Date(v.expires_at).getTime() < Date.now()) {
      await conn.rollback();
      return res.status(410).json({ error: "Token expired" });
    }

    // Enforce one email -> one SteamID.
    // If this email is already linked to a different account, reject.
    // Record the attempt + consume the token so it can't be retried.
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
      logger.warn("Contacts: email link blocked (already in use)", {
        steamid: v.steamid,
        existing: taken[0].steamid,
      });
      return res.status(409).json({
        error: "Email already linked to another account",
        code: "EMAIL_IN_USE",
      });
    }

    // Capture any existing email to log as replaced
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

    // Redeem any gifts that were waiting on this email (or this SteamID).
    const redeemed = await redeemPendingGifts(conn, v.steamid, v.email);

    await conn.commit();
    logger.info(`Contacts: email linked for ${v.steamid}`);
    res.json({ success: true, steamid: v.steamid, email: v.email, redeemed });
  } catch (error) {
    await conn.rollback();
    logger.error("Contacts: email verify failed", { error: error.message });
    res.status(500).json({ error: "Failed to verify email" });
  } finally {
    conn.release();
  }
});

/**
 * DELETE /links/email
 * Unlink a player's email (kept in history). Body: { steamid }
 */
router.delete("/email", async (req, res) => {
  try {
    const steamid64 = resolveSteamID((req.body || {}).steamid);
    if (!steamid64) {
      return res.status(400).json({ error: "Invalid SteamID format" });
    }
    const [rows] = await pool.query(
      "SELECT email FROM player_meta WHERE steamid = ?",
      [steamid64],
    );
    const old = rows.length ? rows[0].email : null;
    if (!old) {
      return res.status(404).json({ error: "No email linked" });
    }
    await pool.query(
      "UPDATE player_meta SET email = NULL, email_verified_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE steamid = ?",
      [steamid64],
    );
    await logContact(steamid64, "email", old, "unlinked");
    logger.info(`Contacts: email unlinked for ${steamid64}`);
    res.json({ success: true, steamid: steamid64 });
  } catch (error) {
    logger.error("Contacts: email unlink failed", { error: error.message });
    res.status(500).json({ error: "Failed to unlink email" });
  }
});

/**
 * PUT /links/discord
 * Link/replace a player's Discord ID (ownership assumed proven upstream).
 * Body: { steamid, discordId, discordUsername? }
 */
router.put("/discord", async (req, res) => {
  try {
    const { steamid, discordId, discordUsername } = req.body || {};
    const steamid64 = resolveSteamID(steamid);
    if (!steamid64) {
      return res.status(400).json({ error: "Invalid SteamID format" });
    }
    if (!DISCORD_ID_RE.test(String(discordId || ""))) {
      return res.status(400).json({ error: "Invalid Discord ID" });
    }
    const username =
      typeof discordUsername === "string" && discordUsername.trim()
        ? discordUsername.trim().slice(0, 64)
        : null;

    const [rows] = await pool.query(
      "SELECT discord_id FROM player_meta WHERE steamid = ?",
      [steamid64],
    );
    const old = rows.length ? rows[0].discord_id : null;
    if (old && old !== discordId) {
      await logContact(steamid64, "discord", old, "replaced");
    }
    await pool.query(
      `INSERT INTO player_meta (steamid, discord_id, discord_username)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE discord_id = VALUES(discord_id),
                               discord_username = VALUES(discord_username),
                               updated_at = CURRENT_TIMESTAMP`,
      [steamid64, discordId, username],
    );
    await logContact(steamid64, "discord", discordId, "linked");
    logger.info(`Contacts: discord linked for ${steamid64}`);
    res.json({
      success: true,
      steamid: steamid64,
      discordId,
      discordUsername: username,
    });
  } catch (error) {
    logger.error("Contacts: discord link failed", { error: error.message });
    res.status(500).json({ error: "Failed to link discord" });
  }
});

/**
 * DELETE /links/discord
 * Unlink a player's Discord ID (kept in history). Body: { steamid }
 */
router.delete("/discord", async (req, res) => {
  try {
    const steamid64 = resolveSteamID((req.body || {}).steamid);
    if (!steamid64) {
      return res.status(400).json({ error: "Invalid SteamID format" });
    }
    const [rows] = await pool.query(
      "SELECT discord_id FROM player_meta WHERE steamid = ?",
      [steamid64],
    );
    const old = rows.length ? rows[0].discord_id : null;
    if (!old) {
      return res.status(404).json({ error: "No discord linked" });
    }
    await pool.query(
      "UPDATE player_meta SET discord_id = NULL, discord_username = NULL, updated_at = CURRENT_TIMESTAMP WHERE steamid = ?",
      [steamid64],
    );
    await logContact(steamid64, "discord", old, "unlinked");
    logger.info(`Contacts: discord unlinked for ${steamid64}`);
    res.json({ success: true, steamid: steamid64 });
  } catch (error) {
    logger.error("Contacts: discord unlink failed", { error: error.message });
    res.status(500).json({ error: "Failed to unlink discord" });
  }
});

/**
 * GET /links/lookup?type=email|discord&value=...
 * Fraud lookup: every SteamID that ever linked this contact (current + history).
 */
router.get("/lookup", async (req, res) => {
  try {
    const { type } = req.query;
    let { value } = req.query;
    if (type !== "email" && type !== "discord") {
      return res.status(400).json({ error: "type must be email or discord" });
    }
    if (!value) {
      return res.status(400).json({ error: "value is required" });
    }
    if (type === "email") value = normalizeEmail(value);

    const column = type === "email" ? "email" : "discord_id";
    const [current] = await pool.query(
      `SELECT steamid FROM player_meta WHERE ${column} = ?`,
      [value],
    );
    const [history] = await pool.query(
      `SELECT steamid, action, note, created_at
       FROM player_contact_history
       WHERE type = ? AND value = ?
       ORDER BY created_at DESC`,
      [type, value],
    );

    const steamids = new Set([
      ...current.map((r) => r.steamid),
      ...history.map((r) => r.steamid),
    ]);

    res.json({
      success: true,
      type,
      value,
      distinctSteamids: steamids.size,
      currentlyLinked: current.map((r) => r.steamid),
      history,
      suspicious: steamids.size > 1,
    });
  } catch (error) {
    logger.error("Contacts: lookup failed", { error: error.message });
    res.status(500).json({ error: "Failed to look up contact" });
  }
});

/**
 * GET /links/:steamid
 * Current linked contacts + full history for one player (admin/private view).
 */
router.get("/:steamid", async (req, res) => {
  try {
    const steamid64 = resolveSteamID(req.params.steamid);
    if (!steamid64) {
      return res.status(400).json({ error: "Invalid SteamID format" });
    }
    const [meta] = await pool.query(
      `SELECT steamid, email, email_verified_at, discord_id, discord_username
       FROM player_meta WHERE steamid = ?`,
      [steamid64],
    );
    const [history] = await pool.query(
      `SELECT type, value, action, note, created_at
       FROM player_contact_history WHERE steamid = ?
       ORDER BY created_at DESC`,
      [steamid64],
    );
    res.json({
      success: true,
      steamid: steamid64,
      current: meta.length ? meta[0] : null,
      history,
    });
  } catch (error) {
    logger.error("Contacts: get failed", { error: error.message });
    res.status(500).json({ error: "Failed to get contacts" });
  }
});

/**
 * POST /links/cleanup?days=365
 * Purge expired/consumed verification tokens and contact history older than
 * `days` (PII retention bound). Defaults to 365 days.
 */
router.post("/cleanup", async (req, res) => {
  try {
    const days = Math.max(30, parseInt(req.query.days, 10) || 365);
    const [v] = await pool.query(
      "DELETE FROM player_email_verifications WHERE expires_at < NOW() OR consumed_at IS NOT NULL",
    );
    const [h] = await pool.query(
      "DELETE FROM player_contact_history WHERE created_at < (NOW() - INTERVAL ? DAY)",
      [days],
    );
    logger.info("Contacts: cleanup run", {
      verificationsDeleted: v.affectedRows,
      historyDeleted: h.affectedRows,
      days,
    });
    res.json({
      success: true,
      verificationsDeleted: v.affectedRows,
      historyDeleted: h.affectedRows,
      retentionDays: days,
    });
  } catch (error) {
    logger.error("Contacts: cleanup failed", { error: error.message });
    res.status(500).json({ error: "Failed to clean up" });
  }
});

module.exports = router;
