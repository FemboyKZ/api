/**
 * Ko-fi Webhook Service
 *
 * Processes Ko-fi webhook events (Tip, Subscription, Commission, Shop Order),
 * converts the amount to EUR, resolves the buyer's SteamID (message, then verified-email fallback),
 * and records the payment as UNCLAIMED.
 *
 * Grants are NOT applied here. The buyer later claims each payment on the site.
 * claiming credits the chosen recipient's lifetime EUR total, which drives their VIP tier.
 * See src/api/kofi.js (claim flow) and src/services/entitlements.js.
 *
 * Ko-fi posts data as application/x-www-form-urlencoded with a single `data`
 * field containing a JSON string.
 *
 * Config (env):
 *   KOFI_WEBHOOK_ENABLED    - "true" to accept webhooks (default: true if token set)
 *   KOFI_VERIFICATION_TOKEN - Ko-fi verification token; rejects mismatched payloads
 *   KOFI_DISCORD_WEBHOOK    - optional Discord webhook URL for notifications
 */

const axios = require("axios");
const pool = require("../db");
const logger = require("../utils/logger");
const { isValidSteamID, convertToSteamID64 } = require("../utils/validators");
const { findSteamIDByEmail } = require("./playerContacts");
const { convertToEUR } = require("./currency");
const { creditSpend } = require("./entitlements");

const VERIFICATION_TOKEN = process.env.KOFI_VERIFICATION_TOKEN || "";
const WEBHOOK_ENABLED =
  process.env.KOFI_WEBHOOK_ENABLED === "true" ||
  (process.env.KOFI_WEBHOOK_ENABLED === undefined && !!VERIFICATION_TOKEN);
const DISCORD_WEBHOOK = process.env.KOFI_DISCORD_WEBHOOK || "";

/**
 * Extract a SteamID64 from free-form text (the Ko-fi checkout message).
 * Supports SteamID64, SteamID2 (STEAM_X:Y:Z), SteamID3 ([U:1:N]) and
 * steamcommunity.com/profiles/<id64> URLs.
 * @param {string} text
 * @returns {string|null} SteamID64 or null
 */
function extractSteamID(text) {
  if (!text || typeof text !== "string") return null;

  // steamcommunity.com/profiles/<id64>
  const profileMatch = text.match(/profiles\/(7656[0-9]{13})/);
  if (profileMatch) return profileMatch[1];

  // Try each known token in the text
  const candidates = [
    ...(text.match(/7656[0-9]{13}/g) || []),
    ...(text.match(/STEAM_[0-5]:[01]:[0-9]+/g) || []),
    ...(text.match(/\[U:1:[0-9]+\]/g) || []),
  ];

  for (const candidate of candidates) {
    if (isValidSteamID(candidate)) {
      const id64 = convertToSteamID64(candidate);
      if (id64) return id64;
    }
  }
  return null;
}

/**
 * Send a Discord notification for a transaction (best-effort, never throws).
 */
async function notifyDiscord(row) {
  if (!DISCORD_WEBHOOK) return;
  try {
    const lines = [
      `**Type:** ${row.type}`,
      `**Amount:** ${row.amount} ${row.currency || ""} (≈ €${row.amount_eur})`.trim(),
      `**From:** ${row.from_name || "Anonymous"}`,
      `**Buyer SteamID:** ${row.steamid || "_unmatched_"}`,
      `**Status:** ${row.claim_status || "unclaimed"}`,
    ];
    await axios.post(DISCORD_WEBHOOK, {
      embeds: [
        {
          title: "New Ko-fi transaction",
          description: lines.join("\n"),
          color: 0x3498db,
          timestamp: new Date().toISOString(),
        },
      ],
    });
  } catch (error) {
    logger.warn("Ko-fi: Discord notification failed", { error: error.message });
  }
}

/**
 * Normalize a raw Ko-fi JSON payload into our column shape.
 */
function normalizePayload(raw) {
  return {
    message_id: raw.message_id,
    kofi_transaction_id: raw.kofi_transaction_id || null,
    type: raw.type || "Unknown",
    from_name: raw.from_name || null,
    email: raw.email || null,
    message: raw.message || null,
    is_public: !!raw.is_public,
    amount: parseFloat(raw.amount || "0") || 0,
    currency: raw.currency || null,
    is_subscription_payment: !!raw.is_subscription_payment,
    is_first_subscription_payment: !!raw.is_first_subscription_payment,
    tier_name: raw.tier_name || null,
    shop_items: Array.isArray(raw.shop_items) ? raw.shop_items : null,
    url: raw.url || null,
    timestamp: raw.timestamp || null,
  };
}

/**
 * Process a Ko-fi webhook payload.
 * @param {object} raw - parsed JSON from the `data` field
 * @returns {Promise<{ status: number, body: object }>}
 */
async function processKofiWebhook(raw) {
  if (!WEBHOOK_ENABLED) {
    return { status: 503, body: { error: "Ko-fi webhook disabled" } };
  }

  // Verify token
  if (!VERIFICATION_TOKEN || raw.verification_token !== VERIFICATION_TOKEN) {
    logger.warn("Ko-fi: rejected webhook with invalid verification token");
    return { status: 401, body: { error: "Invalid verification token" } };
  }

  if (!raw.message_id) {
    return { status: 400, body: { error: "Missing message_id" } };
  }

  const p = normalizePayload(raw);

  // Idempotency: if we've already seen this message_id, ack without reprocessing.
  const [existing] = await pool.query(
    "SELECT id FROM kofi_transactions WHERE message_id = ? LIMIT 1",
    [p.message_id],
  );
  if (existing.length) {
    logger.debug(`Ko-fi: duplicate message_id ${p.message_id}, acking`);
    return { status: 200, body: { success: true, duplicate: true } };
  }

  const amountEur = await convertToEUR(p.amount, p.currency);

  // Resolve the buyer's SteamID: first from the order message, then fall back
  // to matching the Ko-fi email against a player's verified linked email.
  let steamid = extractSteamID(p.message);
  let matchMethod = steamid ? "message" : null;
  if (!steamid && p.email) {
    const byEmail = await findSteamIDByEmail(p.email);
    if (byEmail && byEmail.steamid) {
      steamid = byEmail.steamid;
      matchMethod = "email";
    } else if (byEmail && byEmail.ambiguous) {
      logger.warn("Ko-fi: email matched multiple accounts, leaving unmatched", {
        messageId: p.message_id,
      });
    }
  }

  // Resolution status only (claim_status handles the grant lifecycle).
  const status = steamid ? "matched" : "pending";

  // Subscription payments auto-claim to the resolved buyer: the buyer already
  // established intent by subscribing, so each renewal credits them directly.
  // Requires a resolved SteamID, otherwise stays unclaimed.
  const isSubscription = p.type === "Subscription" || p.is_subscription_payment;
  const autoClaim = isSubscription && !!steamid;
  const claimStatus = autoClaim ? "claimed" : "unclaimed";

  const kofiTs =
    p.timestamp && !isNaN(new Date(p.timestamp).getTime())
      ? new Date(p.timestamp).toISOString().slice(0, 19).replace("T", " ")
      : null;

  const insertSql = `INSERT INTO kofi_transactions
       (message_id, kofi_transaction_id, type, from_name, email, message,
        is_public, amount, amount_eur, currency, is_subscription_payment,
        is_first_subscription_payment, tier_name, shop_items, url,
        steamid, status, claim_status, beneficiary_steamid, claimed_at, kofi_timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  const insertParams = [
    p.message_id,
    p.kofi_transaction_id,
    p.type,
    p.from_name,
    p.email,
    p.message,
    p.is_public,
    p.amount,
    amountEur,
    p.currency,
    p.is_subscription_payment,
    p.is_first_subscription_payment,
    p.tier_name,
    p.shop_items ? JSON.stringify(p.shop_items) : null,
    p.url,
    steamid,
    status,
    claimStatus,
    autoClaim ? steamid : null,
    autoClaim ? new Date().toISOString().slice(0, 19).replace("T", " ") : null,
    kofiTs,
  ];

  let insertId;
  if (autoClaim) {
    // Insert + credit in one transaction so the renewal and the tier bump are atomic.
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [result] = await conn.query(insertSql, insertParams);
      insertId = result.insertId;
      await creditSpend(conn, steamid, amountEur);
      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  } else {
    const [result] = await pool.query(insertSql, insertParams);
    insertId = result.insertId;
  }

  logger.info(`Ko-fi: ${p.type} recorded (${claimStatus})`, {
    id: insertId,
    steamid: steamid || null,
    matchMethod,
    amountEur,
    autoClaim,
  });

  // Best-effort notification (don't block the 200 ack on it)
  notifyDiscord({
    ...p,
    steamid,
    amount_eur: amountEur,
    claim_status: claimStatus,
  });

  return {
    status: 200,
    body: {
      success: true,
      id: insertId,
      steamid,
      amountEur,
      claim_status: claimStatus,
    },
  };
}

module.exports = {
  processKofiWebhook,
  extractSteamID,
  WEBHOOK_ENABLED,
};
