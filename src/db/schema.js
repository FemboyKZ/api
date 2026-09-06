/**
 * Cached information_schema probes.
 *
 * These lookups are slow and sit on request paths, so answers are remembered.
 * A negative answer is re-probed periodically, so applying a migration takes effect without a restart.
 *
 * Answers are cached per connection, because the same table name can exist in one database and not another.
 */

const RECHECK_MS = 60_000;

let caches = new WeakMap();

function cacheFor(runner) {
  let cache = caches.get(runner);
  if (!cache) {
    cache = new Map();
    caches.set(runner, cache);
  }
  return cache;
}

/**
 * @param {{query: Function}} runner - pool or connection
 * @returns {Promise<boolean>} false if the probe itself fails, uncached
 */
async function probe(runner, key, sql, params) {
  const cache = cacheFor(runner);
  const cached = cache.get(key);
  if (cached && (cached.exists || Date.now() - cached.checkedAt < RECHECK_MS)) {
    return cached.exists;
  }

  try {
    const [rows] = await runner.query(sql, params);
    const exists = rows[0].count > 0;
    cache.set(key, { exists, checkedAt: Date.now() });
    return exists;
  } catch {
    // Deliberately not cached: the next call should retry.
    return false;
  }
}

/** Does the table exist in the runner's current database? */
function tableExists(runner, table) {
  return probe(
    runner,
    table,
    `SELECT COUNT(*) as count FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = ?`,
    [table],
  );
}

/** Does the column exist on that table? */
function columnExists(runner, table, column) {
  return probe(
    runner,
    `${table}.${column}`,
    `SELECT COUNT(*) as count FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    [table, column],
  );
}

/** Drops every cached answer. For tests, and after applying a migration. */
function resetSchemaCache() {
  caches = new WeakMap();
}

module.exports = { tableExists, columnExists, resetSchemaCache, RECHECK_MS };
