/**
 * Jumpstat Cleanup Service
 *
 * This service processes jumpstats from CS2 and CSGO databases,
 * identifies potentially bugged or cheated entries using configurable filters,
 * and moves them to quarantine tables for review.
 */

const fs = require("fs");
const path = require("path");
const {
  getKzLocalCS2Pool,
  getKzLocalCSGO128Pool,
  getKzLocalCSGO64Pool,
} = require("../db/kzLocal");
const logger = require("../utils/logger");

// Path to the filter configuration file
const FILTERS_CONFIG_PATH = path.join(
  __dirname,
  "../../config/jumpstat-filters.json",
);

// Valid operators for filter conditions
const VALID_OPERATORS = [
  ">",
  "<",
  ">=",
  "<=",
  "=",
  "!=",
  "LIKE",
  "NOT LIKE",
  "IN",
  "NOT IN",
  "IS NULL",
  "IS NOT NULL",
];

// CS2 field mapping (database column names)
const CS2_FIELD_MAP = {
  id: "ID",
  steamid64: "SteamID64",
  jump_type: "JumpType",
  mode: "Mode",
  distance: "Distance",
  is_block: "IsBlockJump",
  block: "Block",
  strafes: "Strafes",
  sync: "Sync",
  pre: "Pre",
  max: "Max",
  airtime: "Airtime",
  created: "Created",
};

// CSGO field mapping (PascalCase like CS2, uses SteamID32)
const CSGO_FIELD_MAP = {
  id: "JumpID",
  steamid32: "SteamID32",
  jump_type: "JumpType",
  mode: "Mode",
  distance: "Distance",
  is_block: "IsBlockJump",
  block: "Block",
  strafes: "Strafes",
  sync: "Sync",
  pre: "Pre",
  max: "Max",
  airtime: "Airtime",
  created: "Created",
};

/**
 * Load and validate filters from the JSON configuration file
 * @returns {Array} Array of filter objects
 */
function loadFilters() {
  try {
    if (!fs.existsSync(FILTERS_CONFIG_PATH)) {
      logger.warn(
        `Jumpstat filters config not found at ${FILTERS_CONFIG_PATH}`,
      );
      return [];
    }

    const configContent = fs.readFileSync(FILTERS_CONFIG_PATH, "utf8");
    const config = JSON.parse(configContent);

    if (!config.filters || !Array.isArray(config.filters)) {
      logger.error("Invalid filters config: missing or invalid filters array");
      return [];
    }

    // Validate each filter
    const validFilters = config.filters.filter((filter) => {
      if (!filter.id || !filter.name || !filter.conditions || !filter.enabled) {
        if (filter.enabled) {
          logger.warn(`Skipping invalid filter: ${JSON.stringify(filter)}`);
        }
        return false;
      }

      // Validate conditions
      for (const condition of filter.conditions) {
        if (!condition.field || !condition.operator) {
          logger.warn(
            `Invalid condition in filter ${filter.id}: ${JSON.stringify(condition)}`,
          );
          return false;
        }

        if (!VALID_OPERATORS.includes(condition.operator)) {
          logger.warn(
            `Invalid operator in filter ${filter.id}: ${condition.operator}`,
          );
          return false;
        }
      }

      return true;
    });

    logger.info(`Loaded ${validFilters.length} enabled jumpstat filters`);
    return validFilters;
  } catch (error) {
    logger.error(`Failed to load jumpstat filters: ${error.message}`);
    return [];
  }
}

/**
 * Build SQL WHERE clause from filter conditions
 * @param {Object} filter - Filter object with conditions
 * @param {Object} fieldMap - Mapping from config field names to DB column names
 * @returns {{ whereClause: string, params: Array }} SQL where clause and parameters
 */
function buildWhereClause(filter, fieldMap) {
  const conditions = [];
  const params = [];

  // Add jump_type filter if specified
  if (filter.jump_type !== undefined) {
    const jumpTypeField = fieldMap.jump_type || "jump_type";
    conditions.push(`${jumpTypeField} = ?`);
    params.push(filter.jump_type);
  }

  // Add mode filter if specified (0=vanilla, 1=simplekz, 2=kztimer for CSGO)
  if (filter.mode !== undefined) {
    const modeField = fieldMap.mode || "mode";
    conditions.push(`${modeField} = ?`);
    params.push(filter.mode);
  }

  // Add tickrate filter if specified (for CSGO which has tickrate column)
  if (filter.tickrate !== undefined && fieldMap.tickrate) {
    const tickrateField = fieldMap.tickrate;
    conditions.push(`${tickrateField} = ?`);
    params.push(filter.tickrate);
  }

  // Process each condition
  for (const condition of filter.conditions) {
    const dbField = fieldMap[condition.field] || condition.field;

    // Scale distance values - database stores distance * 10000
    // So 250 units in config = 2500000 in database
    let conditionValue = condition.value;
    if (condition.field === "distance" && typeof conditionValue === "number") {
      conditionValue = conditionValue * 10000;
    }

    // Scale other jumpstat values stored as value * 100 (sync, pre, max)
    if (
      ["sync", "pre", "max"].includes(condition.field) &&
      typeof conditionValue === "number"
    ) {
      conditionValue = conditionValue * 100;
    }

    switch (condition.operator) {
      case "IS NULL":
        conditions.push(`${dbField} IS NULL`);
        break;
      case "IS NOT NULL":
        conditions.push(`${dbField} IS NOT NULL`);
        break;
      case "IN":
        if (Array.isArray(condition.value)) {
          // Scale array values if needed
          let scaledValues = condition.value;
          if (condition.field === "distance") {
            scaledValues = condition.value.map((v) =>
              typeof v === "number" ? v * 10000 : v,
            );
          } else if (["sync", "pre", "max"].includes(condition.field)) {
            scaledValues = condition.value.map((v) =>
              typeof v === "number" ? v * 100 : v,
            );
          }
          const placeholders = scaledValues.map(() => "?").join(", ");
          conditions.push(`${dbField} IN (${placeholders})`);
          params.push(...scaledValues);
        }
        break;
      case "NOT IN":
        if (Array.isArray(condition.value)) {
          // Scale array values if needed
          let scaledValues = condition.value;
          if (condition.field === "distance") {
            scaledValues = condition.value.map((v) =>
              typeof v === "number" ? v * 10000 : v,
            );
          } else if (["sync", "pre", "max"].includes(condition.field)) {
            scaledValues = condition.value.map((v) =>
              typeof v === "number" ? v * 100 : v,
            );
          }
          const placeholders = scaledValues.map(() => "?").join(", ");
          conditions.push(`${dbField} NOT IN (${placeholders})`);
          params.push(...scaledValues);
        }
        break;
      case "LIKE":
      case "NOT LIKE":
        conditions.push(`${dbField} ${condition.operator} ?`);
        params.push(condition.value);
        break;
      default:
        // Standard comparison operators: >, <, >=, <=, =, !=
        conditions.push(`${dbField} ${condition.operator} ?`);
        params.push(conditionValue);
    }
  }

  return {
    whereClause: conditions.length > 0 ? conditions.join(" AND ") : "1=1",
    params,
  };
}

/**
 * Process a single filter for CS2 jumpstats
 * @param {Object} pool - Database pool
 * @param {Object} filter - Filter to apply
 * @param {Object} options - Processing options
 * @returns {Object} Result of the operation
 */
async function processCS2Filter(pool, filter, options = {}) {
  const { dryRun = true, executedBy = "system" } = options;

  const { whereClause, params } = buildWhereClause(filter, CS2_FIELD_MAP);

  try {
    // Count matching records
    const [countResult] = await pool.query(
      `SELECT COUNT(*) as count FROM Jumpstats WHERE ${whereClause}`,
      params,
    );
    const matchCount = countResult[0].count;

    if (matchCount === 0) {
      return {
        filter_id: filter.id,
        filter_name: filter.name,
        game: "cs2",
        matched: 0,
        quarantined: 0,
        dry_run: dryRun,
      };
    }

    if (dryRun) {
      // In dry run mode, just return the count without moving anything
      logger.info(
        `[DRY RUN] CS2 filter "${filter.name}" would match ${matchCount} records`,
      );
      return {
        filter_id: filter.id,
        filter_name: filter.name,
        game: "cs2",
        matched: matchCount,
        quarantined: 0,
        dry_run: true,
      };
    }

    // Begin transaction
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      // Insert matching records into quarantine table
      const insertQuery = `
        INSERT INTO Jumpstats_Quarantine (
          ID, SteamID64, JumpType, Mode, Distance, IsBlockJump, Block,
          Strafes, Sync, Pre, Max, Airtime, Created,
          filter_id, filter_name, filter_conditions, quarantined_by
        )
        SELECT 
          ID, SteamID64, JumpType, Mode, Distance, IsBlockJump, Block,
          Strafes, Sync, Pre, Max, Airtime, Created,
          ?, ?, ?, ?
        FROM Jumpstats
        WHERE ${whereClause}
      `;

      const insertParams = [
        filter.id,
        filter.name,
        JSON.stringify(filter.conditions),
        executedBy,
        ...params,
      ];

      const [insertResult] = await connection.query(insertQuery, insertParams);

      // Delete from original table
      const deleteQuery = `DELETE FROM Jumpstats WHERE ${whereClause}`;
      await connection.query(deleteQuery, params);

      await connection.commit();
      connection.release();

      logger.info(
        `CS2 filter "${filter.name}" quarantined ${insertResult.affectedRows} records`,
      );

      return {
        filter_id: filter.id,
        filter_name: filter.name,
        game: "cs2",
        matched: matchCount,
        quarantined: insertResult.affectedRows,
        dry_run: false,
      };
    } catch (error) {
      await connection.rollback();
      connection.release();
      throw error;
    }
  } catch (error) {
    logger.error(`CS2 filter "${filter.id}" failed: ${error.message}`);
    return {
      filter_id: filter.id,
      filter_name: filter.name,
      game: "cs2",
      matched: 0,
      quarantined: 0,
      dry_run: dryRun,
      error: error.message,
    };
  }
}

/**
 * Process a single filter for CSGO jumpstats
 * @param {Object} pool - Database pool
 * @param {Object} filter - Filter to apply
 * @param {Object} options - Processing options
 * @param {string} tickrate - Tickrate identifier (128 or 64)
 * @returns {Object} Result of the operation
 */
async function processCSGOFilter(pool, filter, options = {}, tickrate = "128") {
  const { dryRun = true, executedBy = "system" } = options;

  const { whereClause, params } = buildWhereClause(filter, CSGO_FIELD_MAP);

  try {
    // Count matching records
    const [countResult] = await pool.query(
      `SELECT COUNT(*) as count FROM Jumpstats WHERE ${whereClause}`,
      params,
    );
    const matchCount = countResult[0].count;

    if (matchCount === 0) {
      return {
        filter_id: filter.id,
        filter_name: filter.name,
        game: `csgo${tickrate}`,
        matched: 0,
        quarantined: 0,
        dry_run: dryRun,
      };
    }

    if (dryRun) {
      logger.info(
        `[DRY RUN] CSGO${tickrate} filter "${filter.name}" would match ${matchCount} records`,
      );
      return {
        filter_id: filter.id,
        filter_name: filter.name,
        game: `csgo${tickrate}`,
        matched: matchCount,
        quarantined: 0,
        dry_run: true,
      };
    }

    // Begin transaction
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      // Insert matching records into quarantine table
      const insertQuery = `
        INSERT INTO Jumpstats_Quarantine (
          JumpID, SteamID32, JumpType, Mode, Distance, IsBlockJump, Block,
          Strafes, Sync, Pre, Max, Airtime, Created,
          filter_id, filter_name, filter_conditions, quarantined_by
        )
        SELECT 
          JumpID, SteamID32, JumpType, Mode, Distance, IsBlockJump, Block,
          Strafes, Sync, Pre, Max, Airtime, Created,
          ?, ?, ?, ?
        FROM Jumpstats
        WHERE ${whereClause}
      `;

      const insertParams = [
        filter.id,
        filter.name,
        JSON.stringify(filter.conditions),
        executedBy,
        ...params,
      ];

      const [insertResult] = await connection.query(insertQuery, insertParams);

      // Delete from original table
      const deleteQuery = `DELETE FROM Jumpstats WHERE ${whereClause}`;
      await connection.query(deleteQuery, params);

      await connection.commit();
      connection.release();

      logger.info(
        `CSGO${tickrate} filter "${filter.name}" quarantined ${insertResult.affectedRows} records`,
      );

      return {
        filter_id: filter.id,
        filter_name: filter.name,
        game: `csgo${tickrate}`,
        matched: matchCount,
        quarantined: insertResult.affectedRows,
        dry_run: false,
      };
    } catch (error) {
      await connection.rollback();
      connection.release();
      throw error;
    }
  } catch (error) {
    logger.error(
      `CSGO${tickrate} filter "${filter.id}" failed: ${error.message}`,
    );
    return {
      filter_id: filter.id,
      filter_name: filter.name,
      game: `csgo${tickrate}`,
      matched: 0,
      quarantined: 0,
      dry_run: dryRun,
      error: error.message,
    };
  }
}

/**
 * Log cleanup operation to the database
 * @param {Object} pool - Database pool
 * @param {Object} result - Cleanup result
 */
async function logCleanupOperation(pool, result) {
  try {
    await pool.query(
      `INSERT INTO jumpstat_cleanup_log 
       (game, filter_id, filter_name, records_matched, records_quarantined, dry_run, executed_by, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        result.game.replace(/\d+/, ""), // Normalize to cs2 or csgo
        result.filter_id,
        result.filter_name,
        result.matched,
        result.quarantined,
        result.dry_run,
        result.executed_by || "system",
        result.error || null,
      ],
    );
  } catch (error) {
    logger.error(`Failed to log cleanup operation: ${error.message}`);
  }
}

/**
 * Run jumpstat cleanup with all enabled filters
 * @param {Object} options - Cleanup options
 * @param {boolean} options.dryRun - If true, only report what would be cleaned (default: true)
 * @param {string} options.game - Limit to specific game: 'cs2', 'csgo', or 'all' (default: 'all')
 * @param {string} options.filterId - Run only a specific filter by ID
 * @param {string} options.executedBy - Who initiated the cleanup
 * @returns {Object} Cleanup results
 */
async function runCleanup(options = {}) {
  const {
    dryRun = true,
    game = "all",
    filterId = null,
    executedBy = "system",
  } = options;

  logger.info(
    `Starting jumpstat cleanup (dryRun: ${dryRun}, game: ${game}, filter: ${filterId || "all"})`,
  );

  const filters = loadFilters();

  if (filters.length === 0) {
    return {
      success: false,
      message: "No valid filters found",
      results: [],
    };
  }

  // Filter by specific filter ID if provided
  const filtersToRun = filterId
    ? filters.filter((f) => f.id === filterId)
    : filters;

  if (filtersToRun.length === 0) {
    return {
      success: false,
      message: `Filter "${filterId}" not found or not enabled`,
      results: [],
    };
  }

  const results = [];
  const processOptions = { dryRun, executedBy };

  // Process CS2 filters
  if (game === "all" || game === "cs2") {
    const cs2Pool = getKzLocalCS2Pool();
    const cs2Filters = filtersToRun.filter(
      (f) => f.game === "cs2" || f.game === "all" || !f.game,
    );

    for (const filter of cs2Filters) {
      const result = await processCS2Filter(cs2Pool, filter, processOptions);
      results.push(result);

      // Log to database if not dry run
      if (!dryRun && cs2Pool) {
        await logCleanupOperation(cs2Pool, result);
      }
    }
  }

  // Process CSGO 128 tick filters
  if (game === "all" || game === "csgo" || game === "csgo128") {
    const csgo128Pool = getKzLocalCSGO128Pool();
    // Include filters for: csgo (generic), csgo128 (specific), all, or unspecified
    const csgo128Filters = filtersToRun.filter(
      (f) =>
        f.game === "csgo" ||
        f.game === "csgo128" ||
        f.game === "all" ||
        !f.game,
    );

    for (const filter of csgo128Filters) {
      const result = await processCSGOFilter(
        csgo128Pool,
        filter,
        processOptions,
        "128",
      );
      results.push(result);

      if (!dryRun && csgo128Pool) {
        await logCleanupOperation(csgo128Pool, result);
      }
    }
  }

  // Process CSGO 64 tick filters
  if (game === "all" || game === "csgo" || game === "csgo64") {
    const csgo64Pool = getKzLocalCSGO64Pool();
    // Include filters for: csgo (generic), csgo64 (specific), all, or unspecified
    const csgo64Filters = filtersToRun.filter(
      (f) =>
        f.game === "csgo" || f.game === "csgo64" || f.game === "all" || !f.game,
    );

    for (const filter of csgo64Filters) {
      const result = await processCSGOFilter(
        csgo64Pool,
        filter,
        processOptions,
        "64",
      );
      results.push(result);

      if (!dryRun && csgo64Pool) {
        await logCleanupOperation(csgo64Pool, result);
      }
    }
  }

  // Summarize results
  const totalMatched = results.reduce((sum, r) => sum + r.matched, 0);
  const totalQuarantined = results.reduce((sum, r) => sum + r.quarantined, 0);
  const errors = results.filter((r) => r.error);

  logger.info(
    `Jumpstat cleanup complete: ${totalMatched} matched, ${totalQuarantined} quarantined, ${errors.length} errors`,
  );

  return {
    success: errors.length === 0,
    dry_run: dryRun,
    summary: {
      total_matched: totalMatched,
      total_quarantined: totalQuarantined,
      filters_processed: results.length,
      errors: errors.length,
    },
    results,
  };
}

/**
 * Get quarantined jumpstats with pagination
 * @param {Object} options - Query options
 * @returns {Object} Paginated quarantined records
 */
async function getQuarantinedJumpstats(options = {}) {
  const {
    game = "cs2",
    page = 1,
    limit = 50,
    filterId = null,
    steamid64 = null,
  } = options;

  const offset = (page - 1) * limit;
  const params = [];
  const whereConditions = [];

  if (filterId) {
    whereConditions.push("filter_id = ?");
    params.push(filterId);
  }

  if (steamid64) {
    whereConditions.push(game === "cs2" ? "SteamID64 = ?" : "steamid64 = ?");
    params.push(steamid64);
  }

  const whereClause =
    whereConditions.length > 0 ? `WHERE ${whereConditions.join(" AND ")}` : "";

  try {
    let pool, query, countQuery;

    if (game === "cs2") {
      pool = getKzLocalCS2Pool();
      query = `
        SELECT 
          ID as id, SteamID64 as steamid64, JumpType as jump_type, 
          Mode as mode, Distance as distance, Strafes as strafes,
          Sync as sync, Pre as pre, Max as max, Created as created,
          filter_id, filter_name, quarantined_at, quarantined_by
        FROM Jumpstats_Quarantine
        ${whereClause}
        ORDER BY quarantined_at DESC
        LIMIT ? OFFSET ?
      `;
      countQuery = `SELECT COUNT(*) as total FROM Jumpstats_Quarantine ${whereClause}`;
    } else {
      pool =
        game === "csgo64" ? getKzLocalCSGO64Pool() : getKzLocalCSGO128Pool();
      query = `
        SELECT 
          JumpID as id, SteamID32 as steamid32, JumpType as jump_type,
          Mode as mode, Distance as distance, Strafes as strafes,
          Sync as sync, Pre as pre, Max as max, Created as created,
          filter_id, filter_name, quarantined_at, quarantined_by
        FROM Jumpstats_Quarantine
        ${whereClause}
        ORDER BY quarantined_at DESC
        LIMIT ? OFFSET ?
      `;
      countQuery = `SELECT COUNT(*) as total FROM Jumpstats_Quarantine ${whereClause}`;
    }

    const [rows] = await pool.query(query, [...params, limit, offset]);
    const [[{ total }]] = await pool.query(countQuery, params);

    return {
      data: rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  } catch (error) {
    logger.error(`Failed to get quarantined jumpstats: ${error.message}`);
    throw error;
  }
}

/**
 * Restore a quarantined jumpstat back to the main table
 * @param {string} id - Record ID to restore
 * @param {string} game - Game type (cs2, csgo128, csgo64)
 * @returns {Object} Restore result
 */
async function restoreJumpstat(id, game = "cs2") {
  let pool, insertQuery, deleteQuery;

  if (game === "cs2") {
    pool = getKzLocalCS2Pool();
    insertQuery = `
      INSERT INTO Jumpstats (
        ID, SteamID64, JumpType, Mode, Distance, IsBlockJump, Block,
        Strafes, Sync, Pre, Max, Airtime, Created
      )
      SELECT 
        ID, SteamID64, JumpType, Mode, Distance, IsBlockJump, Block,
        Strafes, Sync, Pre, Max, Airtime, Created
      FROM Jumpstats_Quarantine
      WHERE ID = ?
    `;
    deleteQuery = `DELETE FROM Jumpstats_Quarantine WHERE ID = ?`;
  } else {
    pool = game === "csgo64" ? getKzLocalCSGO64Pool() : getKzLocalCSGO128Pool();
    insertQuery = `
      INSERT INTO Jumpstats (
        JumpID, SteamID32, JumpType, Mode, Distance, IsBlockJump, Block,
        Strafes, Sync, Pre, Max, Airtime, Created
      )
      SELECT 
        JumpID, SteamID32, JumpType, Mode, Distance, IsBlockJump, Block,
        Strafes, Sync, Pre, Max, Airtime, Created
      FROM Jumpstats_Quarantine
      WHERE JumpID = ?
    `;
    deleteQuery = `DELETE FROM Jumpstats_Quarantine WHERE JumpID = ?`;
  }

  const connection = await pool.getConnection();
  await connection.beginTransaction();

  try {
    const [insertResult] = await connection.query(insertQuery, [id]);

    if (insertResult.affectedRows === 0) {
      await connection.rollback();
      connection.release();
      return { success: false, message: "Record not found in quarantine" };
    }

    await connection.query(deleteQuery, [id]);

    await connection.commit();
    connection.release();

    logger.info(`Restored jumpstat ${id} from quarantine (${game})`);

    return { success: true, message: "Record restored successfully" };
  } catch (error) {
    await connection.rollback();
    connection.release();
    logger.error(`Failed to restore jumpstat ${id}: ${error.message}`);
    throw error;
  }
}

/**
 * Get list of available filters
 * @returns {Array} List of filters with their configurations
 */
function getAvailableFilters() {
  const filters = loadFilters();
  return filters.map((f) => ({
    id: f.id,
    name: f.name,
    description: f.description,
    game: f.game || "all",
    jump_type: f.jump_type,
    conditions: f.conditions,
    enabled: f.enabled,
    priority: f.priority || 0,
  }));
}

/**
 * Restore all quarantined jumpstats back to the original table
 * @param {string} game - 'cs2', 'csgo128', or 'csgo64'
 * @param {Object} options - Optional filters for bulk restore
 * @param {string} [options.filterId] - Only restore records from this filter
 * @returns {Promise<Object>} Result with count of restored records
 */
async function restoreAllJumpstats(game, options = {}) {
  const { filterId } = options;

  let pool;
  let insertQuery;
  let deleteQuery;
  let whereClause = "1=1";
  const params = [];

  if (filterId) {
    whereClause = "filter_id = ?";
    params.push(filterId);
  }

  if (game === "cs2") {
    pool = getKzLocalCS2Pool();
    insertQuery = `
      INSERT INTO Jumpstats (
        ID, SteamID64, JumpType, Mode, Distance, IsBlockJump, Block,
        Strafes, Sync, Pre, Max, Airtime, Created
      )
      SELECT 
        ID, SteamID64, JumpType, Mode, Distance, IsBlockJump, Block,
        Strafes, Sync, Pre, Max, Airtime, Created
      FROM Jumpstats_Quarantine
      WHERE ${whereClause}
    `;
    deleteQuery = `DELETE FROM Jumpstats_Quarantine WHERE ${whereClause}`;
  } else {
    pool = game === "csgo64" ? getKzLocalCSGO64Pool() : getKzLocalCSGO128Pool();
    insertQuery = `
      INSERT INTO Jumpstats (
        JumpID, SteamID32, JumpType, Mode, Distance, IsBlockJump, Block,
        Strafes, Sync, Pre, Max, Airtime, Created
      )
      SELECT 
        JumpID, SteamID32, JumpType, Mode, Distance, IsBlockJump, Block,
        Strafes, Sync, Pre, Max, Airtime, Created
      FROM Jumpstats_Quarantine
      WHERE ${whereClause}
    `;
    deleteQuery = `DELETE FROM Jumpstats_Quarantine WHERE ${whereClause}`;
  }

  const connection = await pool.getConnection();
  await connection.beginTransaction();

  try {
    // Get count before restore
    const [countResult] = await connection.query(
      `SELECT COUNT(*) as count FROM Jumpstats_Quarantine WHERE ${whereClause}`,
      params,
    );
    const totalToRestore = countResult[0].count;

    if (totalToRestore === 0) {
      await connection.rollback();
      connection.release();
      return {
        success: true,
        restored: 0,
        message: "No records to restore",
      };
    }

    // Insert all back to original table
    const [insertResult] = await connection.query(insertQuery, params);

    // Delete from quarantine
    await connection.query(deleteQuery, params);

    await connection.commit();
    connection.release();

    logger.info(
      `Restored ${insertResult.affectedRows} jumpstats from quarantine (${game})${
        filterId ? ` for filter ${filterId}` : ""
      }`,
    );

    return {
      success: true,
      restored: insertResult.affectedRows,
      message: `Restored ${insertResult.affectedRows} records`,
    };
  } catch (error) {
    await connection.rollback();
    connection.release();
    logger.error(`Failed to restore all jumpstats (${game}): ${error.message}`);
    throw error;
  }
}

module.exports = {
  loadFilters,
  runCleanup,
  getQuarantinedJumpstats,
  restoreJumpstat,
  restoreAllJumpstats,
  getAvailableFilters,
  buildWhereClause,
  // Export for testing
  CS2_FIELD_MAP,
  CSGO_FIELD_MAP,
  VALID_OPERATORS,
};
