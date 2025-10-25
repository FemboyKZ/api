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

  // Validate boolean values
  if (
    process.env.REDIS_ENABLED &&
    !["true", "false"].includes(process.env.REDIS_ENABLED.toLowerCase())
  ) {
    throw new Error("REDIS_ENABLED must be 'true' or 'false'");
  }

  logger.info("Environment validation passed");

  // Log configuration (without sensitive data)
  logger.info(
    `Configuration: PORT=${process.env.PORT || 3000}, DB_HOST=${process.env.DB_HOST}, REDIS_ENABLED=${process.env.REDIS_ENABLED || "false"}`,
  );
}

module.exports = { validateEnvironment };
