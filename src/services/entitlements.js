/**
 * Entitlements Service
 *
 * Derives a player's VIP standing from their lifetime EUR spend and keeps player_meta in sync:
 * tier role (vip/vip+/vip++), gift-token balance, and the redemption of gifts
 * that were waiting on an email/SteamID to register.
 *
 * Spend is cumulative and never expires.
 * Tier roles are recomputed idempotently so re-running is safe.
 * Custom Discord role / in-game tag are NOT auto-applied here,
 * the player configures those on the site once eligible (see vip route).
 *
 * Every exported mutator takes a live connection so callers run them inside a single transaction.
 */

const logger = require("../utils/logger");
const {
  TIER_ROLES,
  tierForTotal,
  giftTokensForTotal,
} = require("../config/tiers");

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
  const targets = [steamid];
  const params = ["steamid", steamid];
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
  void targets;

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

module.exports = {
  parsePermissions,
  ensureRow,
  recomputeEntitlements,
  creditSpend,
  grantBaseVip,
  redeemPendingGifts,
};
