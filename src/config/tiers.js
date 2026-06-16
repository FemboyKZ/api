/**
 * VIP tier configuration (all thresholds in EUR, lifetime / cumulative spend).
 *
 * Purchases and donations are one-time and never expire; a player's tier is
 * derived from their lifetime EUR total (claimed + gifted-in).
 * Tiers are additive for gift tokens: crossing both VIP+ (20) and VIP++ (25) grants 1 + 1 = 2 tokens.
 * Adjust `giftTokens` below to change that.
 */

// Ordered low -> high.
const TIERS = [
  { role: "vip", minEur: 10, giftTokens: 0 },
  { role: "vip+", minEur: 20, giftTokens: 1 },
  { role: "vip++", minEur: 25, giftTokens: 1 },
];

// Every role that is awarded purely by spend
// (used to prune stale tier roles without touching manually-assigned roles like admin/mod/og).
const TIER_ROLES = TIERS.map((t) => t.role);

// Custom perks the player configures themselves on the site once eligible.
const CUSTOM_ROLE_MIN_EUR = 40; // custom Discord role (color + name)
const CUSTOM_TAG_MIN_EUR = 50; // custom in-game rank/tag (color + name)

/**
 * Highest tier role earned at a given EUR total, or null if below VIP.
 */
function tierForTotal(totalEur) {
  let role = null;
  for (const t of TIERS) {
    if (totalEur >= t.minEur) role = t.role;
  }
  return role;
}

/**
 * Lifetime gift tokens earned at a given EUR total (cumulative across tiers).
 */
function giftTokensForTotal(totalEur) {
  return TIERS.reduce(
    (sum, t) => (totalEur >= t.minEur ? sum + t.giftTokens : sum),
    0,
  );
}

/**
 * Convenience: eligibility flags for the self-serve custom perks.
 */
function eligibility(totalEur) {
  return {
    customRole: totalEur >= CUSTOM_ROLE_MIN_EUR,
    customTag: totalEur >= CUSTOM_TAG_MIN_EUR,
  };
}

module.exports = {
  TIERS,
  TIER_ROLES,
  CUSTOM_ROLE_MIN_EUR,
  CUSTOM_TAG_MIN_EUR,
  tierForTotal,
  giftTokensForTotal,
  eligibility,
};
