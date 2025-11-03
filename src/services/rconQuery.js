const Rcon = require("rcon-srcds").default;
const logger = require("../utils/logger");
const { sanitizePlayerName } = require("../utils/validators");

/**
 * RCON Query Service for CS:GO and CS2 Servers
 *
 * Provides extended server information and player data including Steam IDs.
 *
 * CS:GO Servers:
 * - Uses 'status' command for complete player data
 * - Player format: # userid1 userid2 "name" STEAM_1:0:123 H:MM:SS ping loss state rate address
 * - Steam IDs in SteamID2 format (STEAM_X:Y:Z) - converted to SteamID64
 *
 * CS2 Servers:
 * - Uses 'status' command for server metadata and player connection times
 * - Uses 'css_status' command (custom CounterStrike Sharp plugin) for Steam IDs and player details
 * - css_status format: slot playername steamid64 ip ping
 * - Players matched between commands using normalized names for time correlation
 *
 * Returns:
 * - players: Array with steamid (SteamID64), name, ping, time, ip, bot flag, etc.
 * - serverInfo: hostname, os, secure status, bot count
 */

/**
 * Query server via RCON to get player details including Steam IDs
 *
 * @param {string} ip - Server IP address
 * @param {number} port - RCON port
 * @param {string} password - RCON password
 * @param {string} game - Game type ('csgo' or 'counterstrike2') determines command execution
 * @returns {Object|null} { players: [], serverInfo: {} } or null on error
 */
async function queryRcon(ip, port, password, game) {
  if (!password) {
    logger.debug(`No RCON password configured for ${ip}:${port}`);
    return null;
  }

  logger.debug(`Attempting RCON connection to ${ip}:${port} for game: ${game}`);

  const rcon = new Rcon({
    host: ip,
    port: port,
    timeout: 5000,
    maximumPacketSize: 0,
    encoding: "utf8",
  });

  try {
    await rcon.authenticate(password);
    logger.debug(`RCON authenticated to ${ip}:${port}`);

    const isCS2 = game === "counterstrike2";
    let response;

    if (isCS2) {
      // CS2: Execute both commands and combine responses
      // 'status' provides server metadata and player connection times
      // 'css_status' (custom plugin) provides Steam IDs and player details
      logger.debug(`Executing CS2 commands: status + css_status`);
      const statusResponse = await rcon.execute("status");
      const cssStatusResponse = await rcon.execute("css_status");
      response = statusResponse + "\n" + cssStatusResponse;

      logger.debug(
        `Status: ${statusResponse.length} chars, css_status: ${cssStatusResponse.length} chars`,
      );
    } else {
      // CS:GO: Standard status command contains all necessary data
      logger.debug(`Executing CS:GO command: status`);
      response = await rcon.execute("status");
    }

    logger.debug(`RCON response from ${ip}:${port}: ${response.length} chars`);

    if (!response || response.length === 0) {
      logger.warn(`Empty RCON response from ${ip}:${port}`);
      await rcon.disconnect();
      return null;
    }

    const result = parseStatusResponse(response, isCS2);
    await rcon.disconnect();

    logger.debug(
      `RCON parsed ${result.players.length} players from ${ip}:${port}`,
      {
        hostname: result.serverInfo.hostname,
        secure: result.serverInfo.secure,
        bots: result.serverInfo.botCount,
      },
    );

    return result;
  } catch (error) {
    const errorInfo = {
      message: error.message,
      code: error.code,
    };

    // Log at appropriate level based on error type
    if (error.code === "ECONNREFUSED") {
      logger.debug(
        `RCON connection refused ${ip}:${port} - check RCON port in config`,
        errorInfo,
      );
    } else if (error.code === "ETIMEDOUT") {
      logger.debug(
        `RCON timeout ${ip}:${port} - firewall or server not responding`,
        errorInfo,
      );
    } else if (error.message?.includes("Authentication failed")) {
      logger.warn(
        `RCON auth failed ${ip}:${port} - incorrect password`,
        errorInfo,
      );
    } else {
      logger.warn(`RCON error ${ip}:${port}`, errorInfo);
    }

    try {
      await rcon.disconnect();
    } catch (e) {
      // Ignore disconnect errors
    }

    return null;
  }
}

/**
 * Parse RCON status output to extract player and server information
 *
 * CS2: Merges 'status' (times) with 'css_status' (Steam IDs) using normalized name matching
 * CS:GO: Parses standard 'status' output containing all player data
 *
 * @param {string} statusText - Combined RCON command output
 * @param {boolean} isCS2 - True if CS2 server (uses custom plugin)
 * @returns {Object} { players: [], serverInfo: { hostname, os, secure, botCount } }
 */
function parseStatusResponse(statusText, isCS2 = false) {
  const players = [];
  const serverInfo = {
    hostname: null,
    os: null,
    secure: null,
    botCount: 0,
  };

  const lines = statusText.split("\n");

  // CS2: Build time lookup map from 'status' output before parsing 'css_status'
  const playerTimeMap = new Map();

  // Normalize names for reliable matching (removes control chars, trims, lowercases)
  const normalizeName = (name) => {
    if (!name) return "";
    return name
      .replace(/[\x00-\x1F\x7F]/g, "")
      .trim()
      .toLowerCase();
  };

  for (const line of lines) {
    // Extract server metadata (works for both CS:GO and CS2)
    const hostnameMatch = line.match(/hostname\s*:\s*(.+)/i);
    if (hostnameMatch) {
      serverInfo.hostname = hostnameMatch[1].trim();
    }

    const osMatch = line.match(/os(?:\/type)?\s*:\s*(.+)/i);
    if (osMatch) {
      serverInfo.os = osMatch[1].trim();
    }

    const versionMatch = line.match(/version\s*:\s*.+\s+(secure|insecure)\s+/i);
    if (versionMatch) {
      serverInfo.secure = versionMatch[1].toLowerCase() === "secure";
    }

    const trimmedLine = line.trim();

    // CS2: First pass - extract connection times from 'status' output
    if (isCS2 && trimmedLine.match(/^\d+\s+\d+:\d+/)) {
      // Format: id time ping loss state rate address 'name'
      const statusMatch = trimmedLine.match(
        /^\d+\s+(\d+:\d+(?::\d+)?)\s+\d+\s+\d+\s+\w+\s+\d+\s+\S+\s+'([^']+)'/,
      );
      if (statusMatch) {
        const [, time, name] = statusMatch;
        const cleanName = name.trim();
        const normalizedName = normalizeName(cleanName);
        if (cleanName && normalizedName) {
          playerTimeMap.set(normalizedName, { time, originalName: cleanName });
          logger.debug(`Captured time ${time} for "${cleanName}"`);
        }
      }
    }

    // Parse player data
    if (isCS2) {
      // CS2: Parse 'css_status' plugin output
      // Skip headers, separators, metadata lines
      if (trimmedLine.includes("Slot") && trimmedLine.includes("Player Name"))
        continue;
      if (
        trimmedLine.includes("----") ||
        trimmedLine.includes("#end") ||
        !trimmedLine
      )
        continue;
      if (
        trimmedLine.startsWith("Total players:") ||
        trimmedLine.includes("hostname:") ||
        trimmedLine.includes("os      :")
      )
        continue;

      // Format: slot playername steamid64 ip ping
      const match = trimmedLine.match(
        /^(\d+)\s+(.+?)\s+(76561\d{12})\s+(\S+)\s+(\d+)\s*$/,
      );

      if (match) {
        const [, slot, name, steamid, ipAddress, ping] = match;
        const cleanName = sanitizePlayerName(name);
        const isBot = cleanName?.toLowerCase().includes("bot");

        if (isBot) {
          serverInfo.botCount++;
        }

        // Match time from 'status' output using normalized name
        let playerTime = null;
        if (cleanName) {
          const normalizedName = normalizeName(cleanName);
          const timeData = playerTimeMap.get(normalizedName);
          playerTime = timeData?.time || null;

          if (timeData) {
            logger.debug(`Matched time ${timeData.time} for "${cleanName}"`);
          } else {
            logger.debug(`No time match for "${cleanName}"`);
          }
        }

        players.push({
          userid: parseInt(slot, 10),
          name: cleanName,
          steamid: steamid, // Already SteamID64
          ip: ipAddress !== "N/A" ? ipAddress : null,
          time: playerTime,
          ping: parseInt(ping, 10),
          loss: 0,
          state: "active",
          bot: isBot,
        });
      }
    } else if (trimmedLine.startsWith("#") && !trimmedLine.includes("#end")) {
      // CS:GO: Parse 'status' output
      if (trimmedLine.includes("userid") && trimmedLine.includes("name"))
        continue;

      // Format: # userid1 userid2 "name" steamid  time ping loss state rate address
      // Example: #  2 1 "player" STEAM_1:1:12345  1:07:59 188 0 active 196608 1.2.3.4:27005
      const match = trimmedLine.match(
        /#\s+(\d+)\s+\d+\s+"([^"]+)"\s+(STEAM_[0-9]:[0-9]:\d+|\[U:[0-9]:\d+\]|BOT)\s+(\d+:\d+(?::\d+)?)\s+(\d+)\s+(\d+)\s+(\w+)(?:\s+\d+\s+(\S+))?/,
      );

      if (match) {
        const [, userid, name, steamid, time, ping, loss, state, , address] =
          match;
        const playerIP = address ? address.split(":")[0] : null;
        const cleanName = sanitizePlayerName(name);
        const isBot = steamid === "BOT";

        if (isBot) {
          serverInfo.botCount++;
        }

        players.push({
          userid: parseInt(userid, 10),
          name: cleanName,
          steamid: isBot ? null : steamid,
          ip: playerIP,
          time: time,
          ping: parseInt(ping, 10),
          loss: parseInt(loss, 10),
          state: state,
          bot: isBot,
        });
      }
    }
  }

  logger.debug(
    `Parsed ${players.length} players (${serverInfo.botCount} bots)`,
  );
  return { players, serverInfo };
}

/**
 * Convert Steam ID from SteamID2 or SteamID3 format to SteamID64
 *
 * Supported formats:
 * - 76561198... (SteamID64) - returned as-is
 * - STEAM_X:Y:Z (SteamID2) - converted to SteamID64
 * - [U:1:Z] (SteamID3) - converted to SteamID64
 *
 * @param {string} steamid - Steam ID in any format
 * @returns {string|null} SteamID64 (17-digit string) or null if invalid
 */
function convertToSteamID64(steamid) {
  if (!steamid) return null;

  const trimmedId = steamid.trim();

  // Already SteamID64
  if (/^\d{17}$/.test(trimmedId)) {
    return trimmedId;
  }

  // SteamID2: STEAM_X:Y:Z -> 76561197960265728 + (Z * 2) + Y
  const steamID2Match = trimmedId.match(/STEAM_[0-9]:([0-9]):(\d+)/);
  if (steamID2Match) {
    const [, y, z] = steamID2Match;
    const accountId = parseInt(z, 10) * 2 + parseInt(y, 10);
    const steamId64 = (
      BigInt(76561197960265728) + BigInt(accountId)
    ).toString();
    logger.debug(`Converted ${trimmedId} -> ${steamId64}`);
    return steamId64;
  }

  // SteamID3: [U:1:Z] -> 76561197960265728 + Z
  const steamID3Match = trimmedId.match(/\[U:1:(\d+)\]/);
  if (steamID3Match) {
    const accountId = parseInt(steamID3Match[1], 10);
    const steamId64 = (
      BigInt(76561197960265728) + BigInt(accountId)
    ).toString();
    logger.debug(`Converted ${trimmedId} -> ${steamId64}`);
    return steamId64;
  }

  logger.warn(`Unknown Steam ID format: ${trimmedId}`);
  return null;
}

module.exports = { queryRcon, convertToSteamID64 };
