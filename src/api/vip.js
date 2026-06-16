const express = require("express");
const router = express.Router();
const pool = require("../db");
const logger = require("../utils/logger");
const { adminAuth } = require("../utils/auth");
const { isValidSteamID, convertToSteamID64 } = require("../utils/validators");
const { VALID_TAG_COLORS } = require("../config/permissions");
const {
  tierForTotal,
  eligibility,
  CUSTOM_ROLE_MIN_EUR,
  CUSTOM_TAG_MIN_EUR,
} = require("../config/tiers");
const { parsePermissions, grantBaseVip } = require("../services/entitlements");
const { isValidEmail, normalizeEmail } = require("../services/playerContacts");

// site2-mediated; all VIP/self-serve routes require admin auth.
router.use(adminAuth);

const HEX_COLOR_RE = /^#?[0-9a-fA-F]{6}$/;

function resolveSteamID(input) {
  return isValidSteamID(input) ? convertToSteamID64(input) : null;
}

/**
 * GET /vip/:steamid
 * Current VIP standing: lifetime EUR, tier, roles, gift tokens,
 * custom-perk eligibility, and any configured custom role/tag.
 */
router.get("/:steamid", async (req, res) => {
  try {
    const steamid = resolveSteamID(req.params.steamid);
    if (!steamid) return res.status(400).json({ error: "Invalid SteamID" });

    const [rows] = await pool.query(
      `SELECT total_spent_eur, gift_tokens, permissions
       FROM player_meta WHERE steamid = ?`,
      [steamid],
    );
    const total = rows.length ? parseFloat(rows[0].total_spent_eur) || 0 : 0;
    const perms = parsePermissions(rows.length ? rows[0].permissions : null);

    res.json({
      success: true,
      steamid,
      totalSpentEur: total,
      tier: tierForTotal(total),
      roles: perms.roles,
      giftTokens: rows.length ? rows[0].gift_tokens : 0,
      eligibility: eligibility(total),
      thresholds: {
        customRoleEur: CUSTOM_ROLE_MIN_EUR,
        customTagEur: CUSTOM_TAG_MIN_EUR,
      },
      customRole: perms.customRole,
      customTag: perms.customTag,
    });
  } catch (error) {
    logger.error("VIP: failed to get status", { error: error.message });
    res.status(500).json({ error: "Failed to get VIP status" });
  }
});

/**
 * POST /vip/gift-token/redeem
 * Spend one of the holder's gift tokens to grant base VIP to another member.
 * Body: { fromSteamid, targetSteamid } or { fromSteamid, targetEmail }
 * Unregistered email -> stored as a pending gift, redeemed when they link.
 */
router.post("/gift-token/redeem", async (req, res) => {
  const { fromSteamid, targetSteamid, targetEmail } = req.body || {};
  const from = resolveSteamID(fromSteamid);
  if (!from) return res.status(400).json({ error: "Invalid fromSteamid" });

  const giftTo = resolveSteamID(targetSteamid);
  const emailTarget = isValidEmail(targetEmail)
    ? normalizeEmail(targetEmail)
    : null;
  if (!giftTo && !emailTarget) {
    return res
      .status(400)
      .json({ error: "targetSteamid or targetEmail required" });
  }
  if (giftTo && giftTo === from) {
    return res.status(400).json({ error: "Cannot gift to self" });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      "SELECT gift_tokens FROM player_meta WHERE steamid = ? FOR UPDATE",
      [from],
    );
    const balance = rows.length ? rows[0].gift_tokens : 0;
    if (balance < 1) {
      await conn.rollback();
      return res.status(400).json({ error: "No gift tokens available" });
    }

    await conn.query(
      "UPDATE player_meta SET gift_tokens = gift_tokens - 1, updated_at = CURRENT_TIMESTAMP WHERE steamid = ?",
      [from],
    );

    let pendingGiftId = null;
    if (giftTo) {
      await grantBaseVip(conn, giftTo);
    } else {
      const [pg] = await conn.query(
        `INSERT INTO pending_gifts
           (kind, target_type, target_value, source_steamid)
         VALUES ('vip', 'email', ?, ?)`,
        [emailTarget, from],
      );
      pendingGiftId = pg.insertId;
    }

    await conn.commit();
    logger.info(`VIP: gift token redeemed by ${from}`, {
      giftTo,
      emailTarget,
      pendingGiftId,
    });
    res.json({
      success: true,
      from,
      grantedTo: giftTo || null,
      pendingGiftId,
      remainingTokens: balance - 1,
    });
  } catch (error) {
    await conn.rollback();
    logger.error("VIP: gift token redeem failed", { error: error.message });
    res.status(500).json({ error: "Failed to redeem gift token" });
  } finally {
    conn.release();
  }
});

/**
 * Shared helper: read meta + check eligibility, then mutate one permissions field.
 * `min` is the EUR threshold required.
 */
async function setCustomField(steamid, min, mutate) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      "SELECT total_spent_eur, permissions FROM player_meta WHERE steamid = ? FOR UPDATE",
      [steamid],
    );
    const total = rows.length ? parseFloat(rows[0].total_spent_eur) || 0 : 0;
    if (total < min) {
      await conn.rollback();
      return {
        error: 403,
        message: `Requires €${min}+ lifetime (have €${total})`,
      };
    }
    const perms = parsePermissions(rows.length ? rows[0].permissions : null);
    mutate(perms);
    await conn.query(
      `INSERT INTO player_meta (steamid, permissions) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE permissions = VALUES(permissions), updated_at = CURRENT_TIMESTAMP`,
      [steamid, JSON.stringify(perms)],
    );
    await conn.commit();
    return { perms };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

/**
 * PUT /vip/:steamid/custom-role   (Discord custom role; €40+)
 * Stores the player's chosen color + name. Discord role creation/application
 * is handled later by the Discord side; `id` stays null until then.
 * Body: { color, name }
 */
router.put("/:steamid/custom-role", async (req, res) => {
  try {
    const steamid = resolveSteamID(req.params.steamid);
    if (!steamid) return res.status(400).json({ error: "Invalid SteamID" });
    const { color, name } = req.body || {};
    if (!HEX_COLOR_RE.test(String(color || ""))) {
      return res
        .status(400)
        .json({ error: "color must be a hex color (#RRGGBB)" });
    }
    if (typeof name !== "string" || !name.trim() || name.length > 32) {
      return res.status(400).json({ error: "name required (1-32 chars)" });
    }
    const result = await setCustomField(
      steamid,
      CUSTOM_ROLE_MIN_EUR,
      (perms) => {
        const existingId = perms.customRole?.id ?? null;
        perms.customRole = {
          id: existingId,
          color: String(color),
          name: name.trim(),
        };
      },
    );
    if (result.error) {
      return res.status(result.error).json({ error: result.message });
    }
    logger.info(`VIP: custom role set for ${steamid}`);
    res.json({ success: true, steamid, customRole: result.perms.customRole });
  } catch (error) {
    logger.error("VIP: set custom role failed", { error: error.message });
    res.status(500).json({ error: "Failed to set custom role" });
  }
});

/**
 * DELETE /vip/:steamid/custom-role
 */
router.delete("/:steamid/custom-role", async (req, res) => {
  try {
    const steamid = resolveSteamID(req.params.steamid);
    if (!steamid) return res.status(400).json({ error: "Invalid SteamID" });
    // No eligibility gate to remove (min 0).
    const result = await setCustomField(steamid, 0, (perms) => {
      perms.customRole = null;
    });
    res.json({ success: true, steamid, customRole: result.perms.customRole });
  } catch (error) {
    logger.error("VIP: delete custom role failed", { error: error.message });
    res.status(500).json({ error: "Failed to delete custom role" });
  }
});

/**
 * PUT /vip/:steamid/custom-tag   (in-game custom rank/tag; €50+)
 * Stores chosen color (from the fixed palette) + name.
 * In-game application handled later. Body: { color, name }
 */
router.put("/:steamid/custom-tag", async (req, res) => {
  try {
    const steamid = resolveSteamID(req.params.steamid);
    if (!steamid) return res.status(400).json({ error: "Invalid SteamID" });
    const { color, name } = req.body || {};
    if (!VALID_TAG_COLORS.includes(color)) {
      return res.status(400).json({
        error: `color must be one of: ${VALID_TAG_COLORS.join(", ")}`,
      });
    }
    if (typeof name !== "string" || !name.trim() || name.length > 32) {
      return res.status(400).json({ error: "name required (1-32 chars)" });
    }
    const result = await setCustomField(
      steamid,
      CUSTOM_TAG_MIN_EUR,
      (perms) => {
        perms.customTag = { color: String(color), name: name.trim() };
      },
    );
    if (result.error) {
      return res.status(result.error).json({ error: result.message });
    }
    logger.info(`VIP: custom tag set for ${steamid}`);
    res.json({ success: true, steamid, customTag: result.perms.customTag });
  } catch (error) {
    logger.error("VIP: set custom tag failed", { error: error.message });
    res.status(500).json({ error: "Failed to set custom tag" });
  }
});

/**
 * DELETE /vip/:steamid/custom-tag
 */
router.delete("/:steamid/custom-tag", async (req, res) => {
  try {
    const steamid = resolveSteamID(req.params.steamid);
    if (!steamid) return res.status(400).json({ error: "Invalid SteamID" });
    const result = await setCustomField(steamid, 0, (perms) => {
      perms.customTag = null;
    });
    res.json({ success: true, steamid, customTag: result.perms.customTag });
  } catch (error) {
    logger.error("VIP: delete custom tag failed", { error: error.message });
    res.status(500).json({ error: "Failed to delete custom tag" });
  }
});

module.exports = router;
