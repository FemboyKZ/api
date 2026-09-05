/**
 * Runs first in server.js startup so a missing required variable fails before any connection is attempted.
 */

const logger = require("./logger");

/**
 * Validates required environment variables on startup
 * @throws {Error} If required variables are missing
 */
function validateEnvironment() {
  const required = ["DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME"];

  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    const error = `Missing required environment variables: ${missing.join(", ")}`;
    logger.error(error);
    throw new Error(error);
  }

  // Validate optional numeric values
  if (process.env.PORT && isNaN(parseInt(process.env.PORT, 10))) {
    throw new Error("PORT must be a valid number");
  }

  if (
    process.env.RATE_LIMIT_MAX &&
    isNaN(parseInt(process.env.RATE_LIMIT_MAX, 10))
  ) {
    throw new Error("RATE_LIMIT_MAX must be a valid number");
  }

  if (process.env.REDIS_PORT && isNaN(parseInt(process.env.REDIS_PORT, 10))) {
    throw new Error("REDIS_PORT must be a valid number");
  }

  if (process.env.REDIS_DB && isNaN(parseInt(process.env.REDIS_DB, 10))) {
    throw new Error("REDIS_DB must be a valid number");
  }

  // Case-sensitive on purpose: consumers test `=== "true"`,
  // so "TRUE" would pass here and then silently run with caching off.
  if (
    process.env.REDIS_ENABLED &&
    !["true", "false"].includes(process.env.REDIS_ENABLED)
  ) {
    throw new Error("REDIS_ENABLED must be exactly 'true' or 'false'");
  }

  // Validate API URLs if provided
  if (process.env.GOKZ_API_URL && !isValidURL(process.env.GOKZ_API_URL)) {
    throw new Error("GOKZ_API_URL must be a valid URL");
  }

  if (process.env.CS2KZ_API_URL && !isValidURL(process.env.CS2KZ_API_URL)) {
    throw new Error("CS2KZ_API_URL must be a valid URL");
  }

  // Warn if optional API keys are missing
  if (!process.env.STEAM_API_KEY) {
    logger.warn(
      "STEAM_API_KEY not set - Steam player lookups and Steam Master Server queries will not work",
    );
  }

  // Both fall back to the public endpoints, so unset is normal.
  if (!process.env.GOKZ_API_URL) {
    logger.debug("GOKZ_API_URL not set - using the default GlobalKZ endpoint");
  }

  if (!process.env.CS2KZ_API_URL) {
    logger.debug("CS2KZ_API_URL not set - using the default CS2KZ endpoint");
  }

  logger.info("Environment validation passed");

  // Log configuration (without sensitive data)
  logger.info(
    `Configuration: PORT=${process.env.PORT || 3000}, DB_HOST=${process.env.DB_HOST}, REDIS_ENABLED=${process.env.REDIS_ENABLED || "false"}`,
  );
  logger.info(
    `Steam API: ${process.env.STEAM_API_KEY ? "Configured" : "Missing"}, GOKZ API: ${process.env.GOKZ_API_URL || "default"}, CS2KZ API: ${process.env.CS2KZ_API_URL || "default"}`,
  );
}

/**
 * Simple URL validation
 * @param {string} url - URL to validate
 * @returns {boolean} True if valid URL
 */
function isValidURL(url) {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

module.exports = { validateEnvironment };
