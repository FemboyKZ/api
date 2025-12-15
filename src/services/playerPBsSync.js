const { getKzPool } = require("../db/kzRecords");
const logger = require("../utils/logger");

/**
 * Player PBs Sync Service
 *
 * Manages the kz_player_map_pbs cache table for fast profile loading
 * and map completion status queries.
 */

const PB_SYNC_BATCH_SIZE = 50; // Players per batch
const PB_SYNC_STALE_HOURS = 24; // Consider PBs stale after 24 hours

/**
 * Refresh PBs for a specific player using optimized queries
 * @param {number} playerId - Internal player ID
 * @returns {Promise<number>} Number of PB rows updated
 */
async function refreshPlayerPBs(playerId) {
  const pool = getKzPool();
  if (!pool) {
    logger.error("KZ database pool not initialized");
    return 0;
  }

  try {
    // Get player info
    const [players] = await pool.query(
      "SELECT steamid64, is_banned FROM kz_players WHERE id = ?",
      [playerId],
    );

    if (players.length === 0 || players[0].is_banned) {
      return 0;
    }

    const steamid64 = players[0].steamid64;

    // Delete existing PBs for this player
    await pool.query("DELETE FROM kz_player_map_pbs WHERE player_id = ?", [
      playerId,
    ]);

    // Insert new PBs using optimized query
    const [result] = await pool.query(
      `
      INSERT INTO kz_player_map_pbs (
        player_id, steamid64, map_id, map_name, mode, stage,
        pro_time, pro_teleports, pro_points, pro_record_id, pro_created_on,
        tp_time, tp_teleports, tp_points, tp_record_id, tp_created_on,
        map_difficulty, map_validated
      )
      SELECT 
        ? as player_id,
        ? as steamid64,
        combos.map_id,
        m.map_name,
        combos.mode,
        combos.stage,
        pro.time as pro_time,
        COALESCE(pro.teleports, 0) as pro_teleports,
        COALESCE(pro.points, 0) as pro_points,
        pro.id as pro_record_id,
        pro.created_on as pro_created_on,
        tp.time as tp_time,
        COALESCE(tp.teleports, 0) as tp_teleports,
        COALESCE(tp.points, 0) as tp_points,
        tp.id as tp_record_id,
        tp.created_on as tp_created_on,
        m.difficulty as map_difficulty,
        m.validated as map_validated
      FROM (
        SELECT DISTINCT map_id, mode, stage
        FROM kz_records_partitioned
        WHERE player_id = ?
      ) combos
      INNER JOIN kz_maps m ON combos.map_id = m.id
      LEFT JOIN LATERAL (
        SELECT id, time, teleports, points, created_on
        FROM kz_records_partitioned
        WHERE player_id = ? AND map_id = combos.map_id AND mode = combos.mode AND stage = combos.stage AND teleports = 0
        ORDER BY time ASC
        LIMIT 1
      ) pro ON TRUE
      LEFT JOIN LATERAL (
        SELECT id, time, teleports, points, created_on
        FROM kz_records_partitioned
        WHERE player_id = ? AND map_id = combos.map_id AND mode = combos.mode AND stage = combos.stage AND teleports > 0
        ORDER BY time ASC
        LIMIT 1
      ) tp ON TRUE
      WHERE pro.time IS NOT NULL OR tp.time IS NOT NULL
    `,
      [playerId, steamid64, playerId, playerId, playerId],
    );

    logger.debug(
      `Refreshed ${result.affectedRows} PB rows for player ${playerId}`,
    );
    return result.affectedRows;
  } catch (error) {
    // LATERAL joins not supported in older MySQL/MariaDB, use alternative approach
    if (error.code === "ER_PARSE_ERROR" || error.message.includes("LATERAL")) {
      return await refreshPlayerPBsFallback(playerId);
    }
    logger.error(
      `Failed to refresh PBs for player ${playerId}: ${error.message}`,
    );
    return 0;
  }
}

/**
 * Fallback method for databases without LATERAL join support
 */
async function refreshPlayerPBsFallback(playerId) {
  const pool = getKzPool();
  if (!pool) return 0;

  try {
    const [players] = await pool.query(
      "SELECT steamid64, is_banned FROM kz_players WHERE id = ?",
      [playerId],
    );

    if (players.length === 0 || players[0].is_banned) {
      return 0;
    }

    const steamid64 = players[0].steamid64;

    // Get all unique map/mode/stage combinations for this player
    const [combos] = await pool.query(
      `
      SELECT DISTINCT r.map_id, r.mode, r.stage, m.map_name, m.difficulty, m.validated
      FROM kz_records_partitioned r
      INNER JOIN kz_maps m ON r.map_id = m.id
      WHERE r.player_id = ?
    `,
      [playerId],
    );

    if (combos.length === 0) return 0;

    // Delete existing PBs
    await pool.query("DELETE FROM kz_player_map_pbs WHERE player_id = ?", [
      playerId,
    ]);

    // Get best pro times
    const [proTimes] = await pool.query(
      `
      SELECT 
        r.map_id, r.mode, r.stage, r.id, r.time, r.points, r.created_on
      FROM kz_records_partitioned r
      INNER JOIN (
        SELECT map_id, mode, stage, MIN(time) as min_time
        FROM kz_records_partitioned
        WHERE player_id = ? AND teleports = 0
        GROUP BY map_id, mode, stage
      ) best ON r.map_id = best.map_id AND r.mode = best.mode AND r.stage = best.stage AND r.time = best.min_time
      WHERE r.player_id = ? AND r.teleports = 0
    `,
      [playerId, playerId],
    );

    // Get best TP times
    const [tpTimes] = await pool.query(
      `
      SELECT 
        r.map_id, r.mode, r.stage, r.id, r.time, r.teleports, r.points, r.created_on
      FROM kz_records_partitioned r
      INNER JOIN (
        SELECT map_id, mode, stage, MIN(time) as min_time
        FROM kz_records_partitioned
        WHERE player_id = ? AND teleports > 0
        GROUP BY map_id, mode, stage
      ) best ON r.map_id = best.map_id AND r.mode = best.mode AND r.stage = best.stage AND r.time = best.min_time
      WHERE r.player_id = ? AND r.teleports > 0
    `,
      [playerId, playerId],
    );

    // Create lookup maps
    const proMap = new Map();
    for (const p of proTimes) {
      proMap.set(`${p.map_id}:${p.mode}:${p.stage}`, p);
    }

    const tpMap = new Map();
    for (const t of tpTimes) {
      tpMap.set(`${t.map_id}:${t.mode}:${t.stage}`, t);
    }

    // Insert PBs
    const insertValues = [];
    for (const combo of combos) {
      const key = `${combo.map_id}:${combo.mode}:${combo.stage}`;
      const pro = proMap.get(key);
      const tp = tpMap.get(key);

      if (!pro && !tp) continue;

      insertValues.push([
        playerId,
        steamid64,
        combo.map_id,
        combo.map_name,
        combo.mode,
        combo.stage,
        pro?.time || null,
        0,
        pro?.points || 0,
        pro?.id || null,
        pro?.created_on || null,
        tp?.time || null,
        tp?.teleports || 0,
        tp?.points || 0,
        tp?.id || null,
        tp?.created_on || null,
        combo.difficulty,
        combo.validated,
      ]);
    }

    if (insertValues.length === 0) return 0;

    const [result] = await pool.query(
      `
      INSERT INTO kz_player_map_pbs (
        player_id, steamid64, map_id, map_name, mode, stage,
        pro_time, pro_teleports, pro_points, pro_record_id, pro_created_on,
        tp_time, tp_teleports, tp_points, tp_record_id, tp_created_on,
        map_difficulty, map_validated
      ) VALUES ?
    `,
      [insertValues],
    );

    logger.debug(
      `Refreshed ${result.affectedRows} PB rows for player ${playerId} (fallback)`,
    );
    return result.affectedRows;
  } catch (error) {
    logger.error(
      `Failed to refresh PBs for player ${playerId} (fallback): ${error.message}`,
    );
    return 0;
  }
}

/**
 * Get players that need PB refresh (new records since last sync)
 * @param {number} limit - Max players to return
 * @returns {Promise<Array>} Players needing refresh
 */
async function getPlayersNeedingPBRefresh(limit = PB_SYNC_BATCH_SIZE) {
  const pool = getKzPool();
  if (!pool) return [];

  try {
    // Find players with records newer than their PB cache
    const [rows] = await pool.query(
      `
      SELECT DISTINCT p.id as player_id, p.steamid64, p.player_name,
        MAX(r.created_on) as last_record,
        MAX(pb.updated_at) as pb_updated
      FROM kz_players p
      INNER JOIN kz_records_partitioned r ON p.id = r.player_id
      LEFT JOIN kz_player_map_pbs pb ON p.id = pb.player_id
      WHERE (p.is_banned IS NULL OR p.is_banned = FALSE)
      GROUP BY p.id
      HAVING pb_updated IS NULL 
         OR last_record > pb_updated
         OR pb_updated < DATE_SUB(NOW(), INTERVAL ? HOUR)
      ORDER BY 
        CASE WHEN pb_updated IS NULL THEN 0 ELSE 1 END,
        last_record DESC
      LIMIT ?
    `,
      [PB_SYNC_STALE_HOURS, limit],
    );

    return rows;
  } catch (error) {
    logger.error(`Failed to get players needing PB refresh: ${error.message}`);
    return [];
  }
}

/**
 * Sync PBs for players with recent activity
 */
async function syncPlayerPBs() {
  logger.info("Starting player PBs sync cycle...");

  const pool = getKzPool();
  if (!pool) {
    logger.warn("KZ database not available, skipping PB sync");
    return;
  }

  try {
    const playersNeedingSync =
      await getPlayersNeedingPBRefresh(PB_SYNC_BATCH_SIZE);

    if (playersNeedingSync.length === 0) {
      logger.info("No players need PB sync");
      return;
    }

    logger.info(`Syncing PBs for ${playersNeedingSync.length} players...`);

    let successCount = 0;
    let totalPBs = 0;

    for (const player of playersNeedingSync) {
      try {
        const pbCount = await refreshPlayerPBs(player.player_id);
        if (pbCount > 0) {
          successCount++;
          totalPBs += pbCount;
        }
      } catch (error) {
        logger.error(
          `Failed to sync PBs for player ${player.player_id}: ${error.message}`,
        );
      }
    }

    logger.info(
      `PB sync complete: ${successCount} players, ${totalPBs} total PB rows`,
    );
  } catch (error) {
    logger.error(`Failed to sync player PBs: ${error.message}`);
  }
}

/**
 * Get player PBs for a specific steamid64
 * @param {string} steamid64 - Player's SteamID64
 * @param {Object} options - Query options
 * @returns {Promise<Array>} Player's PBs
 */
async function getPlayerPBs(steamid64, options = {}) {
  const pool = getKzPool();
  if (!pool) return [];

  try {
    const { mode = "kz_timer", stage = 0, validated = null } = options;

    let query = `
      SELECT 
        pb.map_id,
        pb.map_name,
        pb.mode,
        pb.stage,
        pb.pro_time,
        pb.pro_points,
        pb.pro_record_id,
        pb.pro_created_on,
        pb.tp_time,
        pb.tp_teleports,
        pb.tp_points,
        pb.tp_record_id,
        pb.tp_created_on,
        pb.map_difficulty,
        pb.map_validated
      FROM kz_player_map_pbs pb
      WHERE pb.steamid64 = ?
        AND pb.mode = ?
        AND pb.stage = ?
    `;
    const params = [steamid64, mode, stage];

    if (validated !== null) {
      query += " AND pb.map_validated = ?";
      params.push(validated);
    }

    query += " ORDER BY pb.map_name ASC";

    const [rows] = await pool.query(query, params);
    return rows;
  } catch (error) {
    logger.error(`Failed to get PBs for player ${steamid64}: ${error.message}`);
    return [];
  }
}

/**
 * Get maps with completion status for a player
 * @param {string} steamid64 - Player's SteamID64
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Maps with completion status
 */
async function getPlayerMapCompletions(steamid64, options = {}) {
  const pool = getKzPool();
  if (!pool) return { data: [], stats: {} };

  try {
    const {
      mode = "kz_timer",
      stage = 0,
      validated = true,
      difficulty = null,
      completed = null, // 'pro', 'tp', 'any', 'none'
      filterByMode = false, // Apply mode-specific map filters
    } = options;

    // Get all validated maps
    let mapQuery = `
      SELECT 
        m.id as map_id,
        m.map_name,
        m.difficulty,
        m.validated,
        pb.pro_time,
        pb.pro_points,
        pb.tp_time,
        pb.tp_teleports,
        pb.tp_points,
        CASE 
          WHEN pb.pro_time IS NOT NULL THEN 'pro'
          WHEN pb.tp_time IS NOT NULL THEN 'tp'
          ELSE 'none'
        END as completion_status
      FROM kz_maps m
      LEFT JOIN kz_player_map_pbs pb ON m.id = pb.map_id 
        AND pb.steamid64 = ?
        AND pb.mode = ?
        AND pb.stage = ?
      WHERE 1=1
    `;
    const params = [steamid64, mode, stage];

    // Only apply mode filter if explicitly requested
    if (filterByMode) {
      mapQuery += `
        AND (
          NOT EXISTS (SELECT 1 FROM kz_map_mode_filters mmf WHERE mmf.map_id = m.id)
          OR EXISTS (SELECT 1 FROM kz_map_mode_filters mmf WHERE mmf.map_id = m.id AND mmf.mode = ?)
        )
      `;
      params.push(mode);
    }

    if (validated !== null) {
      mapQuery += " AND m.validated = ?";
      params.push(validated);
    }

    if (difficulty !== null) {
      mapQuery += " AND m.difficulty = ?";
      params.push(difficulty);
    }

    if (completed === "pro") {
      mapQuery += " AND pb.pro_time IS NOT NULL";
    } else if (completed === "tp") {
      mapQuery += " AND pb.tp_time IS NOT NULL AND pb.pro_time IS NULL";
    } else if (completed === "any") {
      mapQuery += " AND (pb.pro_time IS NOT NULL OR pb.tp_time IS NOT NULL)";
    } else if (completed === "none") {
      mapQuery += " AND pb.pro_time IS NULL AND pb.tp_time IS NULL";
    }

    mapQuery += " ORDER BY m.map_name ASC";

    const [maps] = await pool.query(mapQuery, params);

    // Calculate stats
    const stats = {
      total_maps: 0,
      completed_pro: 0,
      completed_tp_only: 0,
      not_completed: 0,
      by_difficulty: {},
    };

    for (const map of maps) {
      stats.total_maps++;
      if (map.pro_time !== null) {
        stats.completed_pro++;
      } else if (map.tp_time !== null) {
        stats.completed_tp_only++;
      } else {
        stats.not_completed++;
      }

      const tier = map.difficulty || 0;
      if (!stats.by_difficulty[tier]) {
        stats.by_difficulty[tier] = {
          total: 0,
          completed_pro: 0,
          completed_tp: 0,
          completed_any: 0,
        };
      }
      stats.by_difficulty[tier].total++;
      if (map.pro_time !== null) {
        stats.by_difficulty[tier].completed_pro++;
      }
      if (map.tp_time !== null) {
        stats.by_difficulty[tier].completed_tp++;
      }
      if (map.pro_time !== null || map.tp_time !== null) {
        stats.by_difficulty[tier].completed_any++;
      }
    }

    return { data: maps, stats };
  } catch (error) {
    logger.error(
      `Failed to get map completions for ${steamid64}: ${error.message}`,
    );
    return { data: [], stats: {} };
  }
}

/**
 * Initial population of player PBs for players who have never been synced.
 * This runs once on startup to populate the cache for existing players.
 * After initial population, PBs are updated incrementally by the KZ records scraper
 * when new records are inserted.
 */
async function initialPopulatePlayerPBs() {
  const pool = getKzPool();
  if (!pool) {
    logger.warn("KZ database not available, skipping initial PB population");
    return;
  }

  try {
    // Find players who have records but no PB cache entries at all
    const [playersNeedingInit] = await pool.query(`
      SELECT DISTINCT p.id as player_id, p.steamid64, p.player_name
      FROM kz_players p
      INNER JOIN kz_records_partitioned r ON p.id = r.player_id
      WHERE (p.is_banned IS NULL OR p.is_banned = FALSE)
        AND NOT EXISTS (
          SELECT 1 FROM kz_player_map_pbs pb WHERE pb.player_id = p.id
        )
      ORDER BY p.id
      LIMIT 200
    `);

    if (playersNeedingInit.length === 0) {
      logger.info(
        "Initial player PB population complete - all players have PB cache entries",
      );
      return;
    }

    logger.info(
      `Initial PB population: ${playersNeedingInit.length} players need PB cache...`,
    );

    let successCount = 0;
    let totalPBs = 0;

    for (const player of playersNeedingInit) {
      try {
        const pbCount = await refreshPlayerPBs(player.player_id);
        if (pbCount > 0) {
          successCount++;
          totalPBs += pbCount;
        }
      } catch (error) {
        logger.error(
          `Failed to populate PBs for player ${player.player_id}: ${error.message}`,
        );
      }

      // Small delay between players to avoid overwhelming the API
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    logger.info(
      `Initial PB population: ${successCount} players, ${totalPBs} total PB rows populated`,
    );

    // If there are more players needing init, schedule another run
    if (playersNeedingInit.length === 200) {
      logger.info(
        "More players need initial PB population, scheduling next batch in 5 minutes...",
      );
      setTimeout(initialPopulatePlayerPBs, 5 * 60 * 1000);
    }
  } catch (error) {
    logger.error(`Failed to run initial PB population: ${error.message}`);
  }
}

/**
 * Start the player PBs initial population job.
 * This runs once on startup to populate PBs for players who have never been synced.
 * After initial population, PBs are updated incrementally by the KZ records scraper.
 */
function startPlayerPBsSyncJob() {
  logger.info(
    "Starting player PBs initial population (one-time, then updated by scraper)",
  );

  // Run initial population after a delay on startup
  setTimeout(() => {
    initialPopulatePlayerPBs();
  }, 45000); // 45 seconds after startup (after WR sync starts)
}

module.exports = {
  refreshPlayerPBs,
  refreshPlayerPBsFallback,
  getPlayersNeedingPBRefresh,
  syncPlayerPBs,
  getPlayerPBs,
  getPlayerMapCompletions,
  startPlayerPBsSyncJob,
  initialPopulatePlayerPBs,
};
