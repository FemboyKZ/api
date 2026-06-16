const express = require("express");
const router = express.Router();
const pool = require("../db");
const logger = require("../utils/logger");
const { adminAuth } = require("../utils/auth");
const {
  isValidSteamID,
  convertToSteamID64,
  validatePagination,
} = require("../utils/validators");
const { processKofiWebhook } = require("../services/kofi");
const { isValidEmail, normalizeEmail } = require("../services/playerContacts");
const { creditSpend } = require("../services/entitlements");

/**
 * POST /kofi/webhook
 * Public endpoint that receives Ko-fi webhook events.
 * Ko-fi sends application/x-www-form-urlencoded with a single `data` field containing a JSON string.
 * Authentication is via the verification_token inside that JSON (checked in the service),
 * so this route is unauthenticated.
 *
 * Records the payment as UNCLAIMED, grants happen later at claim time.
 * Returns 200 on successful processing so Ko-fi does not retry,
 * returns 5xx only on transient errors (so Ko-fi retries the same message_id).
 */
router.post(
  "/webhook",
  express.urlencoded({ extended: true, limit: "256kb" }),
  async (req, res) => {
    let payload;
    try {
      if (!req.body || typeof req.body.data !== "string") {
        return res.status(400).json({ error: "Missing 'data' field" });
      }
      payload = JSON.parse(req.body.data);
    } catch (error) {
      logger.warn("Ko-fi: malformed webhook payload", { error: error.message });
      return res.status(400).json({ error: "Malformed data JSON" });
    }

    try {
      const result = await processKofiWebhook(payload);
      return res.status(result.status).json(result.body);
    } catch (error) {
      // Transient/server error -> 500 so Ko-fi retries the same message_id
      logger.error("Ko-fi: webhook processing failed", {
        error: error.message,
      });
      return res.status(500).json({ error: "Processing failed" });
    }
  },
);

/**
 * GET /kofi/transactions
 * Admin: list transactions with filters + pagination.
 * Query: status, claim_status, type, steamid, page, limit
 */
router.get("/transactions", adminAuth, async (req, res) => {
  try {
    const { page, limit, offset } = validatePagination(
      req.query.page,
      req.query.limit,
      100,
    );

    const where = [];
    const params = [];
    if (req.query.status) {
      where.push("status = ?");
      params.push(req.query.status);
    }
    if (req.query.claim_status) {
      where.push("claim_status = ?");
      params.push(req.query.claim_status);
    }
    if (req.query.type) {
      where.push("type = ?");
      params.push(req.query.type);
    }
    if (req.query.steamid) {
      const id64 = convertToSteamID64(req.query.steamid);
      where.push("(steamid = ? OR beneficiary_steamid = ?)");
      params.push(id64 || req.query.steamid, id64 || req.query.steamid);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM kofi_transactions ${whereSql}`,
      params,
    );
    const [rows] = await pool.query(
      `SELECT * FROM kofi_transactions ${whereSql}
       ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

    res.json({
      success: true,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      transactions: rows,
    });
  } catch (error) {
    logger.error("Ko-fi: failed to list transactions", {
      error: error.message,
    });
    res.status(500).json({ error: "Failed to list transactions" });
  }
});

/**
 * GET /kofi/claims?steamid=&email=
 * Admin (site2-mediated): unclaimed transactions belonging to a buyer,
 * by resolved SteamID and/or Ko-fi email.
 * The site shows these so the logged-in player can claim for self or gift each one.
 */
router.get("/claims", adminAuth, async (req, res) => {
  try {
    const { steamid, email } = req.query;
    if (!steamid && !email) {
      return res.status(400).json({ error: "steamid or email required" });
    }
    const clauses = [];
    const params = [];
    if (steamid) {
      const id64 = convertToSteamID64(steamid) || steamid;
      clauses.push("steamid = ?");
      params.push(id64);
    }
    if (email && isValidEmail(email)) {
      clauses.push("email = ?");
      params.push(normalizeEmail(email));
    }
    const [rows] = await pool.query(
      `SELECT id, type, from_name, message, amount, amount_eur, currency,
              is_public, steamid, email, kofi_timestamp, created_at
       FROM kofi_transactions
       WHERE claim_status = 'unclaimed' AND (${clauses.join(" OR ")})
       ORDER BY created_at DESC`,
      params,
    );
    res.json({ success: true, count: rows.length, claims: rows });
  } catch (error) {
    logger.error("Ko-fi: failed to list claims", { error: error.message });
    res.status(500).json({ error: "Failed to list claims" });
  }
});

/**
 * GET /kofi/summary
 * Admin: EUR totals + counts by status/type/claim_status.
 */
router.get("/summary", adminAuth, async (req, res) => {
  try {
    const [[{ total_eur, count }]] = await pool.query(
      "SELECT COALESCE(SUM(amount_eur),0) AS total_eur, COUNT(*) AS count FROM kofi_transactions",
    );
    const [byCurrency] = await pool.query(
      `SELECT currency, COUNT(*) AS count, SUM(amount) AS total_raw, SUM(amount_eur) AS total_eur
       FROM kofi_transactions GROUP BY currency`,
    );
    const [byClaim] = await pool.query(
      "SELECT claim_status, COUNT(*) AS count FROM kofi_transactions GROUP BY claim_status",
    );
    const [byType] = await pool.query(
      "SELECT type, COUNT(*) AS count FROM kofi_transactions GROUP BY type",
    );
    res.json({
      success: true,
      totalEur: Number(total_eur),
      count,
      byCurrency,
      byClaim,
      byType,
    });
  } catch (error) {
    logger.error("Ko-fi: failed to build summary", { error: error.message });
    res.status(500).json({ error: "Failed to build summary" });
  }
});

/**
 * POST /kofi/transactions/:id/claim
 * Admin (site2-mediated, after Steam OpenID). Claim an unclaimed payment.
 * Body:
 *   { decision: "self", steamid }                         -> credit the claimer
 *   { decision: "gift", steamid, targetSteamid }          -> credit a member
 *   { decision: "gift", steamid, targetEmail }            -> pending gift (unregistered)
 * `steamid` is the acting/claiming player (recorded as gifter for gifts).
 */
router.post("/transactions/:id/claim", adminAuth, async (req, res) => {
  const { id } = req.params;
  const { decision, steamid, targetSteamid, targetEmail } = req.body || {};

  if (decision !== "self" && decision !== "gift") {
    return res.status(400).json({ error: "decision must be 'self' or 'gift'" });
  }
  const actor = isValidSteamID(steamid) ? convertToSteamID64(steamid) : null;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      "SELECT id, amount_eur, claim_status, steamid FROM kofi_transactions WHERE id = ? FOR UPDATE",
      [id],
    );
    if (!rows.length) {
      await conn.rollback();
      return res.status(404).json({ error: "Transaction not found" });
    }
    const tx = rows[0];
    if (tx.claim_status !== "unclaimed") {
      await conn.rollback();
      return res.status(409).json({ error: `Already ${tx.claim_status}` });
    }

    let claimStatus;
    let beneficiary = null;
    let pendingGiftId = null;

    if (decision === "self") {
      if (!actor) {
        await conn.rollback();
        return res
          .status(400)
          .json({ error: "Valid steamid required for self-claim" });
      }
      beneficiary = actor;
      await creditSpend(conn, beneficiary, tx.amount_eur);
      claimStatus = "claimed";
    } else {
      // gift
      const giftTo = isValidSteamID(targetSteamid)
        ? convertToSteamID64(targetSteamid)
        : null;
      if (giftTo) {
        beneficiary = giftTo;
        await creditSpend(conn, beneficiary, tx.amount_eur);
      } else if (isValidEmail(targetEmail)) {
        const [pg] = await conn.query(
          `INSERT INTO pending_gifts
             (kind, target_type, target_value, amount_eur, source_steamid, source_transaction_id)
           VALUES ('credit', 'email', ?, ?, ?, ?)`,
          [
            normalizeEmail(targetEmail),
            tx.amount_eur,
            actor || tx.steamid,
            tx.id,
          ],
        );
        pendingGiftId = pg.insertId;
      } else {
        await conn.rollback();
        return res
          .status(400)
          .json({ error: "gift requires targetSteamid or targetEmail" });
      }
      claimStatus = "gifted";
    }

    await conn.query(
      `UPDATE kofi_transactions
       SET claim_status = ?, beneficiary_steamid = ?,
           steamid = COALESCE(steamid, ?), claimed_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [claimStatus, beneficiary, actor, id],
    );

    await conn.commit();
    logger.info(`Ko-fi: transaction ${id} ${claimStatus}`, {
      beneficiary,
      pendingGiftId,
    });
    res.json({
      success: true,
      id: Number(id),
      claim_status: claimStatus,
      beneficiary,
      pendingGiftId,
    });
  } catch (error) {
    await conn.rollback();
    logger.error("Ko-fi: failed to claim transaction", {
      error: error.message,
    });
    res.status(500).json({ error: "Failed to claim transaction" });
  } finally {
    conn.release();
  }
});

module.exports = router;
