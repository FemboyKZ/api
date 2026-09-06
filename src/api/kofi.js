/**
 * Auth is per-route, not at mount time: /kofi/webhook stays public for Ko-fi to reach
 * and is verified against its verification_token in services/vip/kofi.js before any write.
 * Everything else is adminAuth'd.
 */

const express = require("express");
const router = express.Router();
const pool = require("../db");
const logger = require("../utils/logger");
const { adminAuth } = require("../utils/auth");
const { resolveSteamID, validatePagination } = require("../utils/validators");
const {
  processKofiWebhook,
  claimTransaction,
} = require("../services/vip/kofi");
const { isValidEmail, normalizeEmail } = require("../services/vip/contacts");

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
/**
 * @swagger
 * /kofi/webhook:
 *   post:
 *     summary: Ko-fi donation callback
 *     description: >
 *       Public endpoint called by Ko-fi. Not adminAuth'd; the payload is instead
 *       verified against KOFI_VERIFICATION_TOKEN before any write. Ko-fi posts
 *       form-encoded with a single `data` field holding a JSON string. A 500 is
 *       returned on transient failure so Ko-fi retries the same message_id.
 *     tags: [Ko-fi]
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             required: [data]
 *             properties:
 *               data:
 *                 type: string
 *                 description: JSON-encoded Ko-fi payload
 *     responses:
 *       200:
 *         description: Payload accepted, or already seen (idempotent by message_id)
 *       400:
 *         description: Missing data field, or malformed JSON
 *       401:
 *         description: Invalid verification token
 *       503:
 *         description: Ko-fi webhook disabled
 *       500:
 *         description: Processing failed
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
/**
 * @swagger
 * /kofi/transactions:
 *   get:
 *     summary: List recorded donations
 *     tags: [Ko-fi]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyHeader: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *         description: Resolution status (matched or pending)
 *       - in: query
 *         name: claim_status
 *         schema:
 *           type: string
 *         description: claimed or unclaimed
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *         description: Ko-fi transaction type
 *       - in: query
 *         name: steamid
 *         schema:
 *           type: string
 *         description: Buyer or beneficiary SteamID
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Paginated transactions
 *       401:
 *         description: Missing or invalid API key
 *       500:
 *         description: Server error
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
      const id64 = resolveSteamID(req.query.steamid);
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
/**
 * @swagger
 * /kofi/claims:
 *   get:
 *     summary: Claimed and unclaimed donation state
 *     tags: [Ko-fi]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyHeader: []
 *     parameters:
 *       - in: query
 *         name: steamid
 *         schema:
 *           type: string
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Claim rows
 *       401:
 *         description: Missing or invalid API key
 *       500:
 *         description: Server error
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
      const id64 = resolveSteamID(steamid) || steamid;
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
/**
 * @swagger
 * /kofi/summary:
 *   get:
 *     summary: Donation totals
 *     tags: [Ko-fi]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyHeader: []
 *     responses:
 *       200:
 *         description: Aggregate donation totals
 *       401:
 *         description: Missing or invalid API key
 *       500:
 *         description: Server error
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
/**
 * @swagger
 * /kofi/transactions/{id}/claim:
 *   post:
 *     summary: Attach a donation to a player
 *     description: >
 *       decision "self" credits the buyer, "gift" credits another player named by
 *       targetSteamid or targetEmail. Claiming credits the recipient's lifetime
 *       EUR total, which drives their VIP tier.
 *     tags: [Ko-fi]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyHeader: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Transaction id
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [decision]
 *             properties:
 *               decision:
 *                 type: string
 *                 enum: [self, gift]
 *               steamid:
 *                 type: string
 *                 description: Claiming buyer
 *               targetSteamid:
 *                 type: string
 *                 description: Gift recipient, when decision is gift
 *               targetEmail:
 *                 type: string
 *                 description: Gift recipient by verified email, when decision is gift
 *     responses:
 *       200:
 *         description: Transaction claimed
 *       400:
 *         description: decision must be self or gift
 *       401:
 *         description: Missing or invalid API key
 *       404:
 *         description: Transaction not found
 *       409:
 *         description: Transaction already claimed or refunded
 *       500:
 *         description: Server error
 */
router.post("/transactions/:id/claim", adminAuth, async (req, res) => {
  const { id } = req.params;
  const { decision, steamid, targetSteamid, targetEmail } = req.body || {};

  if (decision !== "self" && decision !== "gift") {
    return res.status(400).json({ error: "decision must be 'self' or 'gift'" });
  }
  const actor = resolveSteamID(steamid);

  try {
    const result = await claimTransaction(id, {
      decision,
      actor,
      targetSteamid,
      targetEmail,
    });

    if (result.refused) {
      const refusals = {
        not_found: [404, "Transaction not found"],
        already_claimed: [409, `Already ${result.claimStatus}`],
        actor_required: [400, "Valid steamid required for self-claim"],
        target_required: [400, "gift requires targetSteamid or targetEmail"],
      };
      const [status, error] = refusals[result.refused];
      return res.status(status).json({ error });
    }

    const { claimStatus, beneficiary, pendingGiftId } = result;
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
    logger.error("Ko-fi: failed to claim transaction", {
      error: error.message,
    });
    res.status(500).json({ error: "Failed to claim transaction" });
  }
});

module.exports = router;
