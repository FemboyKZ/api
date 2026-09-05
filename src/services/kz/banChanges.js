/**
 * KZ Ban Change Tracking
 *
 * Shared upsert path for kz_bans, used by both the in-process scraper
 * (services/kz/recordsScraper.js) and the standalone script (scripts/bans-scraper.js).
 *
 * Why this exists:
 *   GlobalAPI has no usable "what changed" query. `updated_since` is accepted by
 *   /bans but always returns an empty array, and there is no sort by update time.
 *   The only way to see unbans and edits is to re-fetch bans and diff them against
 *   what we already stored.
 *
 * What it does per batch:
 *   1. Reads the current rows for the incoming ban ids.
 *   2. Diffs tracked fields and writes one kz_ban_changes row per changed field.
 *   3. Upserts, bumping updated_at only when a tracked field really changed,
 *      and always bumping last_seen_at.
 */

const logger = require("../../utils/logger");

// Fields diffed into kz_ban_changes. ip, player_name and steam_id are identity
// fields rather than ban state, so churn in them is not worth logging.
const TRACKED_FIELDS = [
  "ban_type",
  "expires_on",
  "notes",
  "stats",
  "server_id",
  "updated_by_id",
];

// Fields whose change bumps updated_at. Wider than TRACKED_FIELDS: any upstream
// edit counts as a change even if we do not keep a per-field audit row for it.
const CHANGE_FIELDS = [
  "ban_type",
  "expires_on",
  "ip",
  "steamid64",
  "player_name",
  "steam_id",
  "notes",
  "stats",
  "server_id",
  "updated_by_id",
  "updated_on",
];

const INSERT_COLUMNS = [
  "id",
  "ban_type",
  "expires_on",
  "ip",
  "steamid64",
  "player_name",
  "steam_id",
  "notes",
  "stats",
  "server_id",
  "updated_by_id",
  "created_on",
  "updated_on",
];

// Long free text columns get truncated before they go into the audit log
const MAX_AUDIT_VALUE_LENGTH = 2000;

/**
 * Convert an ISO 8601 datetime string to MySQL DATETIME format
 *
 * GlobalKZ sends most timestamps without a zone ("2026-08-22T13:00:12"). Passing
 * those through `new Date()` would read them as local time and shift the value by
 * the host offset, which both writes wrong data and makes every diff on a non-UTC
 * host look like a change. A zoneless timestamp is kept as the literal it is.
 */
function formatDateTime(value) {
  if (!value) return null;

  const str = String(value).trim();
  const naive = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/.exec(str);
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(str);

  if (naive && !hasZone) {
    return `${naive[1]} ${naive[2]}`;
  }

  const date = new Date(str);
  if (isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 19).replace("T", " ");
}

/**
 * Normalize an API ban payload into the row shape we store
 */
function normalizeBan(ban) {
  return {
    id: ban.id,
    ban_type: ban.ban_type || "none",
    expires_on: formatDateTime(ban.expires_on),
    ip: ban.ip || null,
    steamid64: ban.steamid64 ? String(ban.steamid64) : null,
    player_name: ban.player_name || null,
    steam_id: ban.steam_id || null,
    notes: ban.notes || null,
    stats: ban.stats || null,
    server_id: ban.server_id || null,
    updated_by_id: ban.updated_by_id ? String(ban.updated_by_id) : null,
    created_on: formatDateTime(ban.created_on),
    updated_on: formatDateTime(ban.updated_on),
  };
}

/**
 * Normalize a value read back from MySQL so it compares against normalizeBan output.
 * DATETIME columns arrive as Date objects, numeric columns as numbers.
 *
 * The Date is rebuilt from its local components, not toISOString(). mysql2 parses
 * a DATETIME literal using the local timezone, so the local getters are what give
 * back the literal the column actually holds.
 */
function normalizeStored(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    const pad = (n) => String(n).padStart(2, "0");
    return (
      `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}` +
      ` ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`
    );
  }
  return typeof value === "string" ? value : String(value);
}

function normalizeIncoming(value) {
  if (value === null || value === undefined) return null;
  return typeof value === "string" ? value : String(value);
}

function truncate(value) {
  if (value === null) return null;
  const str = String(value);
  return str.length > MAX_AUDIT_VALUE_LENGTH
    ? `${str.slice(0, MAX_AUDIT_VALUE_LENGTH)}…`
    : str;
}

/**
 * Is a ban with this expires_on currently in force?
 * NULL expiry means permanent, matching how the read API reports is_active.
 */
function isActiveExpiry(expiresOn, now = new Date()) {
  if (!expiresOn) return true;
  const expires = new Date(`${String(expiresOn).replace(" ", "T")}Z`);
  if (isNaN(expires.getTime())) return true;
  return expires.getTime() > now.getTime();
}

/**
 * Classify an expires_on change. Everything else is a plain edit.
 */
function classifyExpiryChange(oldValue, newValue, now = new Date()) {
  const wasActive = isActiveExpiry(oldValue, now);
  const isActive = isActiveExpiry(newValue, now);

  if (wasActive && !isActive) return "unban";
  if (!wasActive && isActive) return "reban";
  return "expiry_change";
}

/**
 * Diff stored rows against incoming API bans
 *
 * @param {Array<Object>} storedRows - Rows read from kz_bans
 * @param {Array<Object>} incomingBans - Normalized bans (normalizeBan output)
 * @returns {Array<Object>} Change rows ready for kz_ban_changes
 */
function diffBans(storedRows, incomingBans, now = new Date()) {
  const storedById = new Map(storedRows.map((row) => [Number(row.id), row]));
  const changes = [];

  for (const ban of incomingBans) {
    const stored = storedById.get(Number(ban.id));
    if (!stored) continue; // New ban, nothing to diff against

    for (const field of TRACKED_FIELDS) {
      const oldValue = normalizeStored(stored[field]);
      const newValue = normalizeIncoming(ban[field]);
      if (oldValue === newValue) continue;

      changes.push({
        ban_id: ban.id,
        steamid64: ban.steamid64 || normalizeStored(stored.steamid64),
        player_name: ban.player_name || normalizeStored(stored.player_name),
        change_type:
          field === "expires_on"
            ? classifyExpiryChange(oldValue, newValue, now)
            : "edit",
        field,
        old_value: truncate(oldValue),
        new_value: truncate(newValue),
        api_updated_on: ban.updated_on,
      });
    }
  }

  return changes;
}

/**
 * Build the ON DUPLICATE KEY UPDATE clause
 *
 * updated_at is assigned first on purpose. MySQL evaluates ON DUPLICATE KEY
 * assignments left to right, and an unqualified column reads the value it holds
 * at that point, so the comparison has to run before the columns are overwritten.
 */
function buildUpsertQuery() {
  const changedCondition = CHANGE_FIELDS.map(
    (field) => `NOT (${field} <=> VALUES(${field}))`,
  ).join("\n          OR ");

  const assignments = INSERT_COLUMNS.filter(
    (column) => column !== "id" && column !== "created_on",
  )
    .map((column) => `${column} = VALUES(${column})`)
    .join(",\n        ");

  return `
    INSERT INTO kz_bans (${INSERT_COLUMNS.join(", ")})
    VALUES ?
    ON DUPLICATE KEY UPDATE
      updated_at = IF(
          ${changedCondition},
        CURRENT_TIMESTAMP, updated_at),
      ${assignments},
      last_seen_at = CURRENT_TIMESTAMP
  `;
}

const UPSERT_QUERY = buildUpsertQuery();

/**
 * Insert change rows into kz_ban_changes
 */
async function recordBanChanges(connection, changes) {
  if (changes.length === 0) return 0;

  const values = changes.map((change) => [
    change.ban_id,
    change.steamid64,
    change.player_name,
    change.change_type,
    change.field,
    change.old_value,
    change.new_value,
    change.api_updated_on,
  ]);

  try {
    const [result] = await connection.query(
      `INSERT INTO kz_ban_changes (
         ban_id, steamid64, player_name, change_type, field,
         old_value, new_value, api_updated_on
       ) VALUES ?`,
      [values],
    );
    return result.affectedRows;
  } catch (error) {
    // Missing table must not take the scrape down with it
    if (error.code === "ER_NO_SUCH_TABLE") {
      logger.warn(
        "[KZ Ban Changes] kz_ban_changes table not found. Run the migration: db/migrations/add_ban_change_tracking.sql",
      );
      return 0;
    }
    throw error;
  }
}

/**
 * Upsert a batch of bans, recording what changed
 *
 * @param {Object} connection - mysql2 connection or pool
 * @param {Array<Object>} bans - Raw ban objects from the GlobalAPI
 * @returns {Promise<Object>} { inserted, seen, changed, changes, unbans }
 */
async function upsertBansWithChangeTracking(connection, bans) {
  if (!bans || bans.length === 0) {
    return { inserted: 0, seen: 0, changed: 0, changes: 0, unbans: 0 };
  }

  const normalized = bans.map(normalizeBan);
  const ids = normalized.map((ban) => ban.id);

  // Read current state before overwriting it
  const [storedRows] = await connection.query(
    `SELECT id, ${TRACKED_FIELDS.join(", ")}, steamid64, player_name
     FROM kz_bans
     WHERE id IN (${ids.map(() => "?").join(",")})`,
    ids,
  );

  const changes = diffBans(storedRows, normalized);

  const values = normalized.map((ban) =>
    INSERT_COLUMNS.map((column) => ban[column]),
  );
  const [result] = await connection.query(UPSERT_QUERY, [values]);

  // last_seen_at always changes, so every existing row reports 2 affected rows
  // and this split is exact rather than an estimate
  const inserted = Math.max(0, 2 * normalized.length - result.affectedRows);

  await recordBanChanges(connection, changes);

  const changedBanIds = new Set(changes.map((change) => change.ban_id));
  const unbans = changes.filter(
    (change) => change.change_type === "unban",
  ).length;

  return {
    inserted,
    seen: normalized.length,
    changed: changedBanIds.size,
    changes: changes.length,
    unbans,
  };
}

module.exports = {
  TRACKED_FIELDS,
  CHANGE_FIELDS,
  formatDateTime,
  normalizeBan,
  isActiveExpiry,
  classifyExpiryChange,
  diffBans,
  recordBanChanges,
  upsertBansWithChangeTracking,
};
