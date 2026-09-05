/**
 * SQL filter fragments for the local timer routes.
 *
 * Each route needs the same WHERE clauses on both its rows query and its count query.
 * Building them once here is what stops the two drifting apart.
 *
 * gokz and cs2kz differ in column names and in how a player is keyed (SteamID32 vs SteamID64), so callers pass those in.
 */

const {
  isValidSteamID,
  convertToSteamID64,
  steamid64To32,
  sanitizeString,
} = require("../../utils/validators");

/** ` AND <column> LIKE ?` matching anywhere in the value. */
function like(column, value) {
  if (!value) return null;
  return {
    sql: ` AND ${column} LIKE ?`,
    params: [`%${sanitizeString(value)}%`],
  };
}

/** ` AND <column> = ?` with the value as an exact string. */
function equals(column, value) {
  if (!value) return null;
  return { sql: ` AND ${column} = ?`, params: [sanitizeString(value)] };
}

/** ` AND <column> = ?` with the value coerced to an integer. */
function intEquals(column, value) {
  if (value === undefined) return null;
  return { sql: ` AND ${column} = ?`, params: [parseInt(value, 10)] };
}

/**
 * Filter by player, accepting either a SteamID or a partial name.
 *
 * A SteamID that fails to convert produces no clause at all,
 * rather than falling back to a name match on the raw id.
 */
function player(value, { idColumn, aliasColumn, toId }) {
  if (!value) return null;

  if (isValidSteamID(value)) {
    const steamid64 = convertToSteamID64(value);
    if (!steamid64) return null;
    return { sql: ` AND ${idColumn} = ?`, params: [toId(steamid64)] };
  }

  return like(aliasColumn, value);
}

/** ` AND <column> = ?` as 1 or 0, treating "true" and "1" as true. */
function boolEquals(column, value) {
  if (value === undefined) return null;
  const on = value === "true" || value === "1";
  return { sql: ` AND ${column} = ?`, params: [on ? 1 : 0] };
}

/** ` AND <column> >= ?`, parsed as a float and multiplied by scale. */
function atLeast(column, value, scale = 1) {
  if (!value) return null;
  return { sql: ` AND ${column} >= ?`, params: [parseFloat(value) * scale] };
}

/**
 * ` AND <column> = 1`, but only when the value is on - an absent or false value adds no clause at all.
 * Distinct from boolEquals, which also filters on false.
 */
function flagTrue(column, value) {
  if (value === "true" || value === "1") {
    return { sql: ` AND ${column} = 1`, params: [] };
  }
  return null;
}

/** "pro" means no teleports, "tp" means at least one. Anything else: no filter. */
function teleports(column, value) {
  if (value === "pro") return { sql: ` AND ${column} = 0`, params: [] };
  if (value === "tp") return { sql: ` AND ${column} > 0`, params: [] };
  return null;
}

/**
 * Combines filter fragments, skipping the null ones.
 * @returns {{sql: string, params: Array}} appended to both queries by the caller
 */
function build(specs) {
  let sql = "";
  const params = [];
  for (const spec of specs) {
    if (!spec) continue;
    sql += spec.sql;
    params.push(...spec.params);
  }
  return { sql, params };
}

/** Player keyed by SteamID64, as cs2kz stores it. */
const asSteamID64 = (steamid64) => steamid64;

/** Player keyed by SteamID32, as gokz stores it. */
const asSteamID32 = (steamid64) => steamid64To32(steamid64);

module.exports = {
  build,
  like,
  equals,
  intEquals,
  boolEquals,
  flagTrue,
  atLeast,
  player,
  teleports,
  asSteamID32,
  asSteamID64,
};
