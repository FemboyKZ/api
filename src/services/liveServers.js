/**
 * Live Server Tracker
 *
 * Tracks which servers are actively reporting via the extension.
 * When a server has recent live data, the updater skips external
 * queries (Steam Master, GameDig, RCON) for that server.
 */

const logger = require("../utils/logger");

// Map of "ip:port" -> { lastReport: timestamp }
const liveServers = new Map();

// Consider a server "live" if it reported within this threshold
const STALENESS_THRESHOLD_MS = 120_000; // 2 minutes

/**
 * Mark a server as having received live extension data
 * @param {string} ip
 * @param {number} port
 */
function markServerLive(ip, port) {
  const key = `${ip}:${port}`;
  liveServers.set(key, { lastReport: Date.now() });
}

/**
 * Check if a server has recent live data from the extension
 * @param {string} ip
 * @param {number} port
 * @returns {boolean}
 */
function isServerLive(ip, port) {
  const key = `${ip}:${port}`;
  const entry = liveServers.get(key);
  if (!entry) return false;

  const age = Date.now() - entry.lastReport;
  if (age > STALENESS_THRESHOLD_MS) {
    liveServers.delete(key);
    logger.debug(
      `Server ${key} live data stale (${Math.round(age / 1000)}s), will resume polling`,
    );
    return false;
  }

  return true;
}

/**
 * Get count of currently live servers
 * @returns {number}
 */
function getLiveServerCount() {
  // Clean stale entries
  const now = Date.now();
  for (const [key, entry] of liveServers) {
    if (now - entry.lastReport > STALENESS_THRESHOLD_MS) {
      liveServers.delete(key);
    }
  }
  return liveServers.size;
}

/**
 * Immediately clear live status for a server (e.g. entering hibernation)
 * @param {string} ip
 * @param {number} port
 * @returns {boolean} true if the server was previously live
 */
function clearServerLive(ip, port) {
  const key = `${ip}:${port}`;
  const existed = liveServers.delete(key);
  if (existed) {
    logger.info(`Server ${key} live status cleared (hibernate)`);
  }
  return existed;
}

module.exports = {
  markServerLive,
  isServerLive,
  getLiveServerCount,
  clearServerLive,
};
