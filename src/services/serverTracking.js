/**
 * Server Tracking
 *
 * Player-session and map-history bookkeeping:
 *   - services/updater.js   polls servers we have no live data for
 *   - api/serverStatus.js   ingests live data pushed by the in-game plugin
 *
 * Both paths write the same player_sessions / map_history rows, and a server moves between them at runtime
 * (the updater skips servers reporting live, and resumes when the plugin hibernates or goes stale).
 */

const pool = require("../db");
const logger = require("../utils/logger");
const { sanitizePlayerName } = require("../utils/validators");

// "ip:port" -> Set of steamids seen on the last observation
const previousServerStates = new Map();
// "ip:port" -> { name, playerCount } of the map running at the last observation
const currentMapStates = new Map();

function serverKeyOf(ip, port) {
  return `${ip}:${port}`;
}

/**
 * Open sessions for players who just joined, close sessions for players who left, and remember the current roster.
 *
 * @param {string} ip
 * @param {number} port
 * @param {Array<{steamid: string, name: string}>} players - players connected right now. 
 *    Callers filter this list (e.g. to those with a SteamID).
 */
async function trackPlayerSessions(ip, port, players) {
  const serverKey = serverKeyOf(ip, port);
  const previousPlayers = previousServerStates.get(serverKey) || new Set();
  const currentPlayerIds = new Set();

  for (const player of players) {
    if (!player.steamid) continue;
    currentPlayerIds.add(player.steamid);

    if (previousPlayers.has(player.steamid)) continue;

    try {
      const cleanName = sanitizePlayerName(player.name) || "Unknown";
      await pool.query(
        `INSERT INTO player_sessions (steamid, name, server_ip, server_port, joined_at)
         VALUES (?, ?, ?, ?, NOW())`,
        [player.steamid, cleanName, ip, port],
      );
      logger.debug("Player joined", {
        steamid: player.steamid,
        server: serverKey,
      });
    } catch (error) {
      logger.error("Failed to track player join", {
        error: error.message,
        steamid: player.steamid,
      });
    }
  }

  for (const playerId of previousPlayers) {
    if (currentPlayerIds.has(playerId)) continue;
    await closeSession(playerId, ip, port, serverKey);
  }

  previousServerStates.set(serverKey, currentPlayerIds);
}

/**
 * Close every session still open on a server, e.g. when it goes offline.
 * No-op when we are not tracking anyone there, so it is safe to call on every poll of a server that stays down.
 *
 * @returns {Promise<number>} how many tracked players were closed out
 */
async function closeServerSessions(ip, port) {
  const serverKey = serverKeyOf(ip, port);
  const previousPlayers = previousServerStates.get(serverKey);
  if (!previousPlayers || previousPlayers.size === 0) {
    previousServerStates.set(serverKey, new Set());
    return 0;
  }

  for (const playerId of previousPlayers) {
    await closeSession(playerId, ip, port, serverKey);
  }

  const closed = previousPlayers.size;
  previousServerStates.set(serverKey, new Set());
  logger.debug(`Closed ${closed} open session(s) on ${serverKey}`);
  return closed;
}

async function closeSession(steamid, ip, port, serverKey) {
  try {
    await pool.query(
      `UPDATE player_sessions 
       SET left_at = NOW(), 
           duration = TIMESTAMPDIFF(SECOND, joined_at, NOW())
       WHERE steamid = ? 
         AND server_ip = ? 
         AND server_port = ? 
         AND left_at IS NULL`,
      [steamid, ip, port],
    );
    logger.debug("Player left", { steamid, server: serverKey });
  } catch (error) {
    logger.error("Failed to track player leave", {
      error: error.message,
      steamid,
    });
  }
}

/**
 * Record map rotation: close the previous map_history row and open a new one when the map changed,
 * otherwise keep the running player counts up to date.
 *
 * @param {string} ip
 * @param {number} port
 * @param {string} newMap - sanitized map name
 * @param {number} playerCount
 */
async function trackMapChange(ip, port, newMap, playerCount) {
  const serverKey = serverKeyOf(ip, port);
  const currentMap = currentMapStates.get(serverKey);

  if (currentMap && currentMap.name !== newMap) {
    try {
      await pool.query(
        `UPDATE map_history 
         SET ended_at = NOW(), 
             duration = TIMESTAMPDIFF(SECOND, started_at, NOW())
         WHERE server_ip = ? 
           AND server_port = ? 
           AND ended_at IS NULL`,
        [ip, port],
      );

      await pool.query(
        `INSERT INTO map_history 
         (server_ip, server_port, map_name, started_at, player_count_avg, player_count_peak)
         VALUES (?, ?, ?, NOW(), ?, ?)`,
        [ip, port, newMap, playerCount, playerCount],
      );

      logger.debug("Map changed", {
        server: serverKey,
        from: currentMap.name,
        to: newMap,
      });
    } catch (error) {
      logger.error("Failed to track map change", { error: error.message });
    }
  } else if (!currentMap && newMap) {
    try {
      await pool.query(
        `INSERT INTO map_history 
         (server_ip, server_port, map_name, started_at, player_count_avg, player_count_peak)
         VALUES (?, ?, ?, NOW(), ?, ?)`,
        [ip, port, newMap, playerCount, playerCount],
      );
    } catch (error) {
      logger.error("Failed to initialize map tracking", {
        error: error.message,
      });
    }
  } else if (currentMap && currentMap.name === newMap) {
    try {
      await pool.query(
        `UPDATE map_history 
         SET player_count_peak = GREATEST(player_count_peak, ?),
             player_count_avg = (player_count_avg + ?) / 2
         WHERE server_ip = ? 
           AND server_port = ? 
           AND ended_at IS NULL`,
        [playerCount, playerCount, ip, port],
      );
    } catch (error) {
      logger.error("Failed to update map player counts", {
        error: error.message,
      });
    }
  }

  currentMapStates.set(serverKey, { name: newMap, playerCount });
}

module.exports = {
  trackPlayerSessions,
  closeServerSessions,
  trackMapChange,
};
