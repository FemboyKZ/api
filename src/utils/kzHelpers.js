/**
 * KZ Helpers - Shared utilities for KZ-related API endpoints
 *
 * Contains common formatting, conversion, and query helper functions
 * used across kzLocal, kzLocalCS2, kzRecords, kzPlayers, kzMaps, etc.
 */

// Import shared utilities from validators to avoid duplication
const {
  STEAM_BASE_ID,
  steamid32To64,
  steamid64To32,
  validateSortField,
  validateSortOrder,
} = require("./validators");

// ==================== CONSTANTS ====================

/**
 * KZ modes for CS:GO (GOKZ plugin)
 */
const KZ_MODES = {
  0: "vanilla",
  1: "simplekz",
  2: "kztimer",
};

/**
 * CS2KZ Modes
 */
const CS2_MODES = {
  1: "classic",
  2: "vanilla",
};

/**
 * Jump types (shared between CS:GO and CS2)
 */
const JUMP_TYPES = {
  0: "longjump",
  1: "bhop",
  2: "multibhop",
  3: "weirdjump",
  4: "ladderjump",
  5: "ladderhop",
  6: "jumpbug",
  7: "lowprebhop",
  8: "lowpreweirdjump",
};

/**
 * AirStats AirType enum from more-stats plugin
 * See: https://github.com/zer0k-z/more-stats/blob/main/addons/sourcemod/scripting/include/more-stats.inc
 */
const AIR_TYPES = {
  0: "air_time",
  1: "strafes",
  2: "overlap",
  3: "dead_air",
  4: "bad_angles",
  5: "air_accel_time",
  6: "air_vel_change_time",
};

/**
 * BhopStats StatType1 enum from more-stats plugin
 */
const BHOP_STAT_TYPES = {
  0: "bhop_ticks",
  1: "perf_streaks",
  2: "scroll_efficiency",
  3: "strafe_count",
  4: "gokz_perf_count",
};

/**
 * ScrollEff sub-types for StatType1=2
 */
const SCROLL_EFF_TYPES = {
  0: "registered_scrolls",
  1: "fast_scrolls",
  2: "slow_scrolls",
  3: "timing_total",
  4: "timing_samples",
};

// ==================== FORMAT FUNCTIONS ====================

/**
 * Format runtime from milliseconds to seconds
 * Used by CS:GO KZ local (stores runtime as MS * 1000)
 * @param {number} runtime - Runtime in MS (1000 = 1 second)
 * @returns {number} Runtime in seconds
 */
function formatRuntimeMs(runtime) {
  return runtime / 1000;
}

/**
 * Format runtime (pass-through for CS2 which already stores in seconds)
 * @param {number} runtime - Runtime in seconds
 * @returns {number} Runtime in seconds
 */
function formatRuntimeSeconds(runtime) {
  return runtime;
}

/**
 * Format distance from raw units to readable value
 * Both CS:GO and CS2 store distance as value * 10000
 * @param {number} distance - Distance in units (10000 = 1.0)
 * @returns {number} Distance value
 */
function formatDistance(distance) {
  return distance / 10000;
}

/**
 * Format jumpstat values (sync, pre, max)
 * Both CS:GO and CS2 store these as value * 100
 * @param {number} value - Raw stat value
 * @returns {number} Formatted stat value
 */
function formatStat(value) {
  return value / 100;
}

/**
 * Format airtime from ticks to seconds
 * @param {number} airtime - Airtime in ticks
 * @param {number} tickrate - Server tickrate (default 64 for CS2)
 * @returns {number} Airtime in seconds
 */
function formatAirtime(airtime, tickrate = 64) {
  return airtime / tickrate;
}

// ==================== QUERY HELPERS ====================
// Note: validateSortField and validateSortOrder are imported from validators.js

/**
 * Generate partition hint for yearly partitioned tables
 * Partitions: p_old (before 2018), p2018-p2027, pfuture
 *
 * @param {object} options - Configuration options
 * @param {string} [options.dateFrom] - Start date filter
 * @param {string} [options.dateTo] - End date filter
 * @param {string} [options.sortField] - Sort field (for optimization)
 * @param {string} [options.sortOrder] - Sort order (for optimization)
 * @param {boolean} [options.recentOnly] - Only include recent partitions (current year + prev year)
 * @returns {string} Partition hint clause or empty string
 */
function getYearlyPartitionHint(options = {}) {
  const { dateFrom, dateTo, sortField, sortOrder, recentOnly } = options;
  const currentYear = new Date().getFullYear();
  const partitions = [];

  // For queries without date filter
  if (!dateFrom && !dateTo) {
    // For recent/sorted queries, optimize by scanning recent partitions only
    if (recentOnly || (sortField === "created_on" && sortOrder === "DESC")) {
      partitions.push(`p${currentYear}`);
      partitions.push(`p${currentYear - 1}`);
      partitions.push("pfuture");
      return `PARTITION (${partitions.join(",")})`;
    }
    // No date filter and not optimizable - let MySQL optimize
    return "";
  }

  // Build partition list based on date range
  const fromYear = dateFrom ? new Date(dateFrom).getFullYear() : 2014;
  const toYear = dateTo ? new Date(dateTo).getFullYear() : currentYear;

  if (fromYear < 2018) {
    partitions.push("p_old");
  }

  for (
    let year = Math.max(fromYear, 2018);
    year <= Math.min(toYear, 2027);
    year++
  ) {
    partitions.push(`p${year}`);
  }

  if (toYear >= currentYear) {
    partitions.push("pfuture");
  }

  if (partitions.length === 0) return "";

  return `PARTITION (${partitions.join(",")})`;
}

/**
 * Generate partition hint for player queries with optional year filter
 * @param {number|string} [yearFilter] - Optional year to filter by
 * @returns {string} Partition hint clause or empty string
 */
function getPlayerPartitionHint(yearFilter) {
  if (!yearFilter) {
    return "";
  }

  const currentYear = new Date().getFullYear();
  const year = parseInt(yearFilter, 10);
  const partitions = [];

  if (year < 2018) {
    partitions.push("p_old");
  } else if (year >= 2018 && year <= currentYear + 1) {
    partitions.push(`p${year}`);
  }

  if (year >= currentYear) {
    partitions.push("pfuture");
  }

  return partitions.length > 0 ? `PARTITION (${partitions.join(",")})` : "";
}

module.exports = {
  // Constants
  KZ_MODES,
  CS2_MODES,
  JUMP_TYPES,
  AIR_TYPES,
  BHOP_STAT_TYPES,
  SCROLL_EFF_TYPES,
  STEAM_BASE_ID,
  // SteamID conversion
  steamid32To64,
  steamid64To32,
  // Formatting
  formatRuntimeMs,
  formatRuntimeSeconds,
  formatDistance,
  formatStat,
  formatAirtime,
  // Query helpers
  validateSortField,
  validateSortOrder,
  getYearlyPartitionHint,
  getPlayerPartitionHint,
};
