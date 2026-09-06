/**
 * Entitlements Service
 *
 * Derives a player's VIP standing from their lifetime EUR spend and keeps player_meta in sync:
 * tier role (vip/vip+/vip++), gift-token balance, and the redemption of gifts that were waiting on an email/SteamID to register.
 *
 * Spend is cumulative and never expires.
 * Tier roles are recomputed idempotently so re-running is safe.
 * Custom Discord role / in-game tag are NOT auto-applied here,
 * the player configures those on the site once eligible (see vip route).
 *
 * Every exported mutator takes a live connection so callers run them inside a single transaction.
 */

const logger = require("../../utils/logger");
const pool = require("../../db");
const {
  TIER_ROLES,
  tierForTotal,
  giftTokensForTotal,
} = require("../../config/tiers");

const EMPTY_PERMS = { roles: [], customRole: null, customTag: null };

function parsePermissions(raw) {
  if (!raw) return { ...EMPTY_PERMS };
  const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
  return {
    roles: Array.isArray(obj.roles) ? obj.roles : [],
    customRole: obj.customRole ?? null,
    customTag: obj.customTag ?? null,
  };
}

/** Ensure a player_meta row exists (no-op if present). */
async function ensureRow(conn, steamid) {
  await conn.query("INSERT IGNORE INTO player_meta (steamid) VALUES (?)", [
    steamid,
  ]);
}

/**
 * Recompute tier role + gift-token grants from the current total_spent_eur.
 * Assumes the player_meta row exists. Idempotent.
 */
async function recomputeEntitlements(conn, steamid) {
  const [rows] = await conn.query(
    `SELECT total_spent_eur, gift_tokens, gift_tokens_granted, permissions
     FROM player_meta WHERE steamid = ? FOR UPDATE`,
    [steamid],
  );
  if (!rows.length) return;
  const row = rows[0];
  const total = parseFloat(row.total_spent_eur) || 0;

  // Tier role: prune all spend-based roles, then add the current one (if any).
  const perms = parsePermissions(row.permissions);
  perms.roles = perms.roles.filter((r) => !TIER_ROLES.includes(r));
  const tierRole = tierForTotal(total);
  if (tierRole) perms.roles.push(tierRole);

  // Gift tokens: grant only the not-yet-granted delta.
  const targetGranted = giftTokensForTotal(total);
  const alreadyGranted = row.gift_tokens_granted || 0;
  const delta = Math.max(0, targetGranted - alreadyGranted);
  const newAvailable = (row.gift_tokens || 0) + delta;

  await conn.query(
    `UPDATE player_meta
     SET permissions = ?, gift_tokens = ?, gift_tokens_granted = ?, updated_at = CURRENT_TIMESTAMP
     WHERE steamid = ?`,
    [JSON.stringify(perms), newAvailable, targetGranted, steamid],
  );

  if (delta > 0) {
    logger.info(`Entitlements: granted ${delta} gift token(s) to ${steamid}`);
  }
  return { total, tierRole, giftTokens: newAvailable };
}

/**
 * Add EUR to a player's lifetime total and recompute entitlements.
 */
async function creditSpend(conn, steamid, amountEur) {
  const amount = Math.round((parseFloat(amountEur) || 0) * 100) / 100;
  if (amount <= 0) return;
  await conn.query(
    `INSERT INTO player_meta (steamid, total_spent_eur)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE total_spent_eur = total_spent_eur + VALUES(total_spent_eur),
                             updated_at = CURRENT_TIMESTAMP`,
    [steamid, amount],
  );
  return recomputeEntitlements(conn, steamid);
}

/**
 * Grant the base "vip" role without crediting spend (gift-token redemption).
 */
async function grantBaseVip(conn, steamid) {
  await ensureRow(conn, steamid);
  const [rows] = await conn.query(
    "SELECT permissions FROM player_meta WHERE steamid = ? FOR UPDATE",
    [steamid],
  );
  const perms = parsePermissions(rows[0]?.permissions);
  if (!perms.roles.includes("vip")) perms.roles.push("vip");
  await conn.query(
    "UPDATE player_meta SET permissions = ?, updated_at = CURRENT_TIMESTAMP WHERE steamid = ?",
    [JSON.stringify(perms), steamid],
  );
}

/**
 * Redeem any pending gifts addressed to this email or SteamID, crediting the given SteamID.
 * Call inside the same transaction that links the email.
 * @returns {Promise<{ redeemed: number, creditedEur: number }>}
 */
async function redeemPendingGifts(conn, steamid, email) {
  const params = [steamid];
  let emailClause = "";
  if (email) {
    emailClause = " OR (target_type = 'email' AND target_value = ?)";
    params.push(email.toLowerCase());
  }

  const [gifts] = await conn.query(
    `SELECT id, kind, amount_eur FROM pending_gifts
     WHERE redeemed_at IS NULL
       AND ((target_type = 'steamid' AND target_value = ?)${emailClause})
     FOR UPDATE`,
    params,
  );

  let creditedEur = 0;
  for (const g of gifts) {
    if (g.kind === "credit") {
      await creditSpend(conn, steamid, g.amount_eur);
      creditedEur += parseFloat(g.amount_eur) || 0;
    } else if (g.kind === "vip") {
      await grantBaseVip(conn, steamid);
    }
    await conn.query(
      "UPDATE pending_gifts SET redeemed_steamid = ?, redeemed_at = CURRENT_TIMESTAMP WHERE id = ?",
      [steamid, g.id],
    );
  }

  if (gifts.length) {
    logger.info(`Entitlements: redeemed ${gifts.length} pending gift(s)`, {
      steamid,
      creditedEur,
    });
  }
  return { redeemed: gifts.length, creditedEur };
}

/**
 * Set a custom permission field behind a lifetime-spend gate.
 *
 * Unlike the helpers above this owns its transaction.
 *
 * @param {string} steamid
 * @param {number} requiredEur - lifetime spend the player must have reached
 * @param {(perms: object) => void} mutate - edits the parsed permissions in place
 * @returns {Promise<{perms: object} | {insufficientSpend: {required: number, total: number}}>}
 *   Throws on any database failure, having rolled back.
 */
async function setCustomPermission(steamid, requiredEur, mutate) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      "SELECT total_spent_eur, permissions FROM player_meta WHERE steamid = ? FOR UPDATE",
      [steamid],
    );
    const total = rows.length ? parseFloat(rows[0].total_spent_eur) || 0 : 0;
    if (total < requiredEur) {
      await conn.rollback();
      return { insufficientSpend: { required: requiredEur, total } };
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
 * Spend one of a player's gift tokens, either granting VIP to a known player or recording a pending gift against an email address.
 *
 * Owns its transaction for the same reason as setCustomPermission:
 * the balance must stay locked from the check through the decrement.
 *
 * @param {string} from - sender's steamid64
 * @param {{giftTo: string|null, emailTarget: string|null}} target
 * @returns {Promise<{pendingGiftId: number|null, remainingTokens: number} | {noTokens: true}>}
 *   Throws on any database failure, having rolled back.
 */
async function redeemGiftToken(from, { giftTo, emailTarget }) {
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
      return { noTokens: true };
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
    return { pendingGiftId, remainingTokens: balance - 1 };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

module.exports = {
  parsePermissions,
  setCustomPermission,
  redeemGiftToken,
  ensureRow,
  recomputeEntitlements,
  creditSpend,
  redeemPendingGifts,
};
