/**
 * Admin Authentication Middleware
 *
 * Provides multiple authentication methods for admin endpoints:
 * 1. API Key (Bearer token) - For automated scripts and services
 * 2. IP Whitelist - For internal services and localhost access
 *
 * Configuration via environment variables:
 * - ADMIN_API_KEY: Required API key for admin access
 * - ADMIN_IP_WHITELIST: Comma-separated list of allowed IPs (optional)
 * - ADMIN_LOCALHOST_ALLOWED: Allow localhost access without API key (default: true in dev)
 */

const logger = require("./logger");

// Configuration
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;
const ADMIN_IP_WHITELIST = process.env.ADMIN_IP_WHITELIST
  ? process.env.ADMIN_IP_WHITELIST.split(",").map((ip) => ip.trim())
  : [];
const ADMIN_LOCALHOST_ALLOWED =
  process.env.ADMIN_LOCALHOST_ALLOWED !== "false" &&
  process.env.NODE_ENV !== "production";

// Localhost IP patterns
const LOCALHOST_IPS = ["127.0.0.1", "::1", "::ffff:127.0.0.1", "localhost"];

/**
 * Get client IP from request
 * Handles both direct connections and proxy forwarding
 */
function getClientIP(req) {
  // Check X-Forwarded-For header (for reverse proxy setups)
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    // Take the first IP in the chain (original client)
    return forwarded.split(",")[0].trim();
  }

  // Check X-Real-IP header (nginx)
  if (req.headers["x-real-ip"]) {
    return req.headers["x-real-ip"];
  }

  // Fall back to socket remote address
  return req.socket?.remoteAddress || req.ip;
}

/**
 * Check if IP is localhost
 */
function isLocalhost(ip) {
  return LOCALHOST_IPS.some(
    (localIp) => ip === localIp || ip.endsWith(localIp),
  );
}

/**
 * Check if IP is in whitelist
 */
function isWhitelisted(ip) {
  if (ADMIN_IP_WHITELIST.length === 0) {
    return false;
  }

  return ADMIN_IP_WHITELIST.some((allowedIp) => {
    // Support CIDR notation (basic /24 and /16 support)
    if (allowedIp.includes("/")) {
      return matchCIDR(ip, allowedIp);
    }
    // Exact match or wildcard
    if (allowedIp.endsWith(".*")) {
      const prefix = allowedIp.slice(0, -1);
      return ip.startsWith(prefix);
    }
    return ip === allowedIp;
  });
}

/**
 * Basic CIDR matching for /24 and /16 subnets
 */
function matchCIDR(ip, cidr) {
  const [network, bits] = cidr.split("/");
  const maskBits = parseInt(bits, 10);

  // Only support IPv4 for CIDR matching
  if (!ip.includes(".") || !network.includes(".")) {
    return false;
  }

  const ipParts = ip.split(".").map(Number);
  const networkParts = network.split(".").map(Number);

  // Calculate how many octets to compare
  const octetsToCompare = Math.floor(maskBits / 8);

  for (let i = 0; i < octetsToCompare; i++) {
    if (ipParts[i] !== networkParts[i]) {
      return false;
    }
  }

  return true;
}

/**
 * Extract API key from request
 * Supports: Authorization: Bearer <key>, X-API-Key header, or ?api_key query param
 */
function extractAPIKey(req) {
  // Check Authorization header (Bearer token)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }

  // Check X-API-Key header
  if (req.headers["x-api-key"]) {
    return req.headers["x-api-key"];
  }

  // Check query parameter (less secure, but useful for testing)
  if (req.query.api_key) {
    return req.query.api_key;
  }

  return null;
}

/**
 * Validate API key
 * Uses timing-safe comparison to prevent timing attacks
 */
function validateAPIKey(providedKey) {
  if (!ADMIN_API_KEY || !providedKey) {
    return false;
  }

  // Simple constant-time comparison
  if (providedKey.length !== ADMIN_API_KEY.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < providedKey.length; i++) {
    result |= providedKey.charCodeAt(i) ^ ADMIN_API_KEY.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Admin authentication middleware
 *
 * Checks authentication in order:
 * 1. API Key validation (if provided)
 * 2. IP whitelist check
 * 3. Localhost access (in development mode)
 */
function adminAuth(req, res, next) {
  const clientIP = getClientIP(req);
  const apiKey = extractAPIKey(req);

  // Method 1: API Key authentication
  if (apiKey) {
    if (validateAPIKey(apiKey)) {
      logger.debug(`Admin auth: API key accepted from ${clientIP}`);
      req.adminAuth = { method: "api_key", ip: clientIP };
      return next();
    } else {
      logger.warn(`Admin auth: Invalid API key from ${clientIP}`, {
        path: req.path,
        method: req.method,
      });
      return res.status(401).json({
        error: "Invalid API key",
        code: "INVALID_API_KEY",
      });
    }
  }

  // Method 2: IP whitelist
  if (isWhitelisted(clientIP)) {
    logger.debug(`Admin auth: IP whitelist accepted for ${clientIP}`);
    req.adminAuth = { method: "ip_whitelist", ip: clientIP };
    return next();
  }

  // Method 3: Localhost access (development only)
  if (ADMIN_LOCALHOST_ALLOWED && isLocalhost(clientIP)) {
    logger.debug(`Admin auth: Localhost access allowed for ${clientIP}`);
    req.adminAuth = { method: "localhost", ip: clientIP };
    return next();
  }

  // No valid authentication
  logger.warn(`Admin auth: Access denied for ${clientIP}`, {
    path: req.path,
    method: req.method,
    hasApiKey: !!apiKey,
  });

  // Different message based on whether API key is configured
  if (!ADMIN_API_KEY) {
    return res.status(403).json({
      error:
        "Admin access not configured. Set ADMIN_API_KEY environment variable.",
      code: "ADMIN_NOT_CONFIGURED",
    });
  }

  return res.status(401).json({
    error:
      "Authentication required. Provide API key via Authorization header or X-API-Key.",
    code: "AUTH_REQUIRED",
  });
}

/**
 * Optional admin auth - doesn't block, but sets req.isAdmin if authenticated
 * Useful for endpoints that have different behavior for admins
 */
function optionalAdminAuth(req, res, next) {
  const clientIP = getClientIP(req);
  const apiKey = extractAPIKey(req);

  req.isAdmin = false;

  if (apiKey && validateAPIKey(apiKey)) {
    req.isAdmin = true;
    req.adminAuth = { method: "api_key", ip: clientIP };
  } else if (isWhitelisted(clientIP)) {
    req.isAdmin = true;
    req.adminAuth = { method: "ip_whitelist", ip: clientIP };
  } else if (ADMIN_LOCALHOST_ALLOWED && isLocalhost(clientIP)) {
    req.isAdmin = true;
    req.adminAuth = { method: "localhost", ip: clientIP };
  }

  next();
}

/**
 * Generate a secure random API key
 * Can be used to generate keys for .env file
 */
function generateAPIKey(length = 32) {
  const crypto = require("crypto");
  return crypto.randomBytes(length).toString("hex");
}

module.exports = {
  adminAuth,
  optionalAdminAuth,
  generateAPIKey,
  getClientIP,
  isLocalhost,
  isWhitelisted,
};
