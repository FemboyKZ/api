// Validation utilities for API input

function isValidIP(ip) {
  // IPv4 validation
  const ipv4Regex =
    /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  // IPv6 validation (basic)
  const ipv6Regex =
    /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;

  return ipv4Regex.test(ip) || ipv6Regex.test(ip);
}

function isValidPort(port) {
  const portNum = parseInt(port, 10);
  return !isNaN(portNum) && portNum >= 1 && portNum <= 65535;
}

function isValidSteamID(steamid) {
  // SteamID64 format (17 digits starting with 7)
  const steamid64Regex = /^7656119[0-9]{10}$/;
  // SteamID3 format [U:1:XXXXXXXXX]
  const steamid3Regex = /^\[U:1:[0-9]+\]$/;
  // SteamID2 format STEAM_X:Y:Z
  const steamid2Regex = /^STEAM_[0-5]:[01]:[0-9]+$/;

  return (
    steamid64Regex.test(steamid) ||
    steamid3Regex.test(steamid) ||
    steamid2Regex.test(steamid)
  );
}

function sanitizeString(str, maxLength = 255) {
  if (typeof str !== "string") return "";
  return str.trim().substring(0, maxLength);
}

function validatePagination(page, limit, maxLimit = 100) {
  const validPage = Math.max(1, parseInt(page, 10) || 1);
  const validLimit = Math.min(maxLimit, Math.max(1, parseInt(limit, 10) || 10));
  const offset = (validPage - 1) * validLimit;

  return { page: validPage, limit: validLimit, offset };
}

/**
 * Sanitize map name by removing workshop paths and URL encoding
 * Examples:
 *   "workshop/793414645/kz_2seasons_winter_final" -> "kz_2seasons_winter_final"
 *   "workshop%2F793414645%2Fkz_synergy_x" -> "kz_synergy_x"
 *   "maps/kz_grotto" -> "kz_grotto"
 *   "kz_grotto" -> "kz_grotto"
 * 
 * @param {string} mapName - Raw map name from server
 * @returns {string} Sanitized map name
 */
function sanitizeMapName(mapName) {
  if (!mapName || typeof mapName !== 'string') return '';
  
  // First, decode any URL encoding
  let decoded = mapName;
  try {
    decoded = decodeURIComponent(mapName);
  } catch (e) {
    // If decoding fails, use original
    decoded = mapName;
  }
  
  // Common map prefixes in Source engine games
  const validPrefixes = [
    'kz_', 'kzpro_', 'xc_', 'bkz_',  // KZ/Climb maps
    'de_', 'cs_',                      // Defuse/Hostage maps
    'aim_', 'awp_', 'fy_',             // Aim/AWP/Fun maps
    'surf_', 'bhop_',                  // Movement maps
    'mg_', 'hns_', 'jail_',            // Minigames/HNS/Jail
    'gg_', 'ar_', 'dm_',               // Gungame/Arms Race/Deathmatch
  ];
  
  // Split by slashes (both forward and backslash)
  const parts = decoded.split(/[\/\\]/);
  
  // Find the first part that starts with a valid map prefix
  for (const part of parts) {
    const lowerPart = part.toLowerCase();
    for (const prefix of validPrefixes) {
      if (lowerPart.startsWith(prefix)) {
        return part.trim();
      }
    }
  }
  
  // If no valid prefix found, return the last part (likely the actual map name)
  // This handles cases like "maps/custom_map" or just "custom_map"
  return parts[parts.length - 1].trim();
}

module.exports = {
  isValidIP,
  isValidPort,
  isValidSteamID,
  sanitizeString,
  validatePagination,
  sanitizeMapName,
};
