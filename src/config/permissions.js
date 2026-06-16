/**
 * Shared permission vocabulary.
 *
 * Single source of truth for valid roles and custom-tag colors, used by the
 * admin API, the VIP/entitlement routes, and the Ko-fi tier logic so they
 * cannot drift apart.
 */

const VALID_ROLES = [
  "owner",
  "admin",
  "mod",
  "dev",
  "vip",
  "vip+",
  "vip++", // prev: "contributor"
  "og",
  "gmc",
];

const VALID_TAG_COLORS = [
  "default",
  "darkred",
  "purple",
  "green",
  "olive",
  "lime",
  "red",
  "grey",
  "yellow",
  "bluegrey",
  "blue",
  "darkblue",
  "orchid",
  "lightred",
  "gold",
];

module.exports = { VALID_ROLES, VALID_TAG_COLORS };
