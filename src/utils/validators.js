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
  // SteamID64 format (17-18 digits starting with 765611)
  const steamid64Regex = /^765611[0-9]{11,12}$/;
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

/**
 * Convert any SteamID format to SteamID64
 * 
 * Supports:
 * - SteamID64: "76561198000000000" (returns as-is)
 * - SteamID2: "STEAM_0:1:12345" or "STEAM_1:0:12345"
 * - SteamID3: "[U:1:24691]"
 * 
 * Algorithm:
 * SteamID64 = 76561197960265728 + (Z * 2) + Y
 * Where STEAM_X:Y:Z -> Y and Z are extracted
 * 
 * @param {string} steamid - Any valid SteamID format
 * @returns {string|null} SteamID64 format or null if invalid
 */
function convertToSteamID64(steamid) {
  if (!steamid || typeof steamid !== 'string') return null;
  
  // Already SteamID64 format (17-18 digits starting with 765611)
  if (/^765611[0-9]{11,12}$/.test(steamid)) {
    return steamid;
  }
  
  // SteamID2 format: STEAM_X:Y:Z
  const steamid2Match = steamid.match(/^STEAM_[0-5]:([01]):([0-9]+)$/);
  if (steamid2Match) {
    const Y = parseInt(steamid2Match[1], 10);
    const Z = parseInt(steamid2Match[2], 10);
    const accountID = (Z * 2) + Y;
    const steamID64 = BigInt('76561197960265728') + BigInt(accountID);
    return steamID64.toString();
  }
  
  // SteamID3 format: [U:1:XXXXXXXXX]
  const steamid3Match = steamid.match(/^\[U:1:([0-9]+)\]$/);
  if (steamid3Match) {
    const accountID = parseInt(steamid3Match[1], 10);
    const steamID64 = BigInt('76561197960265728') + BigInt(accountID);
    return steamID64.toString();
  }
  
  return null;
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
 * Sanitize player name by removing control characters and invisible formatting
 * while preserving visible Unicode symbols (hearts, emojis, etc.)
 * 
 * CS:GO/CS2 player names can contain:
 * - Color codes (\x01-\x1F control characters) - REMOVE
 * - Unicode invisible formatting (U+2067, zero-width, etc.) - REMOVE
 * - Unicode visible symbols (♥, ★, emojis, etc.) - KEEP
 * - Non-ASCII text (Cyrillic, Chinese, etc.) - KEEP
 * 
 * Examples:
 *   "ily⁧⁧♥" -> "ily♥" (removes U+2067, keeps heart)
 *   "Player\x07Name" -> "PlayerName" (removes color code)
 *   "Test★Name" -> "Test★Name" (keeps star)
 * 
 * @param {string} playerName - Raw player name from RCON
 * @returns {string|null} Sanitized player name or null if empty/invalid
 */
function sanitizePlayerName(playerName) {
  if (!playerName || typeof playerName !== 'string') return null;
  
  // Step 1: Remove ASCII control characters (0x00-0x1F and 0x7F)
  // These are CS:GO/CS2 color codes and formatting
  let cleaned = playerName.replace(/[\x00-\x1F\x7F]/g, '');
  
  // Step 2: Remove Unicode invisible/formatting characters but KEEP visible symbols
  // Remove: Zero-width spaces, joiners, directional marks, etc.
  // Keep: Hearts (♥), stars (★), emojis, and other visible Unicode
  cleaned = cleaned.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '');
  
  // Step 3: Normalize whitespace (replace multiple spaces/newlines with single space)
  cleaned = cleaned.replace(/\s+/g, ' ');
  
  // Step 4: Trim and check if anything remains
  cleaned = cleaned.trim();
  
  // Return null if the name is empty after sanitization
  return cleaned.length > 0 ? cleaned : null;
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
  convertToSteamID64,
  sanitizeString,
  validatePagination,
  sanitizePlayerName,
  sanitizeMapName,
};
