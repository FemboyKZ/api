const Rcon = require("rcon-srcds").default;
const logger = require("../utils/logger");

/**
 * RCON Query Service for CS:GO and CS2 Servers
 * 
 * Provides extended server information and player data including Steam IDs.
 * 
 * CS:GO servers (version 1.38.x):
 * - Uses 'status' command for player list with STEAM_X:Y:Z format Steam IDs
 * - Player lines format: # userid1 userid2 "name" STEAM_1:0:123 H:MM:SS ping loss state rate address
 * 
 * CS2 servers (version 1.40.x+):
 * - Uses 'status' command for player names and basic info (no Steam IDs in status)
 * - Uses 'status_json' command to get Steam IDs from server.clients array
 * - Player lines format: userid H:MM:SS ping loss state rate address 'name'
 * - JSON format includes steamid, steamid64, bot flag, and name
 * 
 * Auto-detection:
 * - CS:GO vs CS2 is detected by parsing version number from status output
 * - Version 1.40+ = CS2, Version 1.38.x = CS:GO
 * 
 * Returns:
 * - players: Array of player objects with steamid, name, ping, time, etc.
 * - serverInfo: hostname, os, secure status, server owner steamid, bot count
 */

/**
 * Query server via RCON to get player details including Steam IDs
 * 
 * @param {string} ip - Server IP address
 * @param {number} port - RCON port
 * @param {string} password - RCON password
 * @returns {Object|null} { players: [], serverInfo: {} } or null on error
 */
async function queryRcon(ip, port, password) {
  if (!password) {
    logger.debug(`No RCON password configured for ${ip}:${port}`);
    return null;
  }

  logger.debug(`Attempting RCON connection to ${ip}:${port}`);
  
  const rcon = new Rcon({ host: ip, port: port, timeout: 5000 });

  try {
    await rcon.authenticate(password);
    logger.debug(`RCON connected and authenticated to ${ip}:${port}`);
    
    const response = await rcon.execute("status");
    logger.debug(`RCON response from ${ip}:${port}`, {
      responseLength: response ? response.length : 0,
      preview: response ? response.substring(0, 200) : "(empty)",
    });

    if (!response || response.length === 0) {
      logger.warn(`RCON returned empty response from ${ip}:${port}`);
      await rcon.disconnect();
      return null;
    }

    const result = parseStatusResponse(response);
    
    // For CS2, get Steam IDs using status_json command
    if (result.isCS2 && result.players.length > 0) {
      logger.debug(`CS2 detected, attempting to get Steam IDs for ${result.players.length} players using status_json`);
      try {
        const statusJsonResponse = await rcon.execute("status_json");
        if (statusJsonResponse) {
          enrichCS2PlayersWithSteamIDs(result.players, statusJsonResponse);
        }
      } catch (error) {
        logger.debug(`Failed to get status_json for CS2 server ${ip}:${port}: ${error.message}`);
      }
    }

    await rcon.disconnect();

    logger.debug(
      `RCON got ${result.players.length} players from ${ip}:${port}`,
      {
        hostname: result.serverInfo.hostname,
        os: result.serverInfo.os,
        secure: result.serverInfo.secure,
        steamid: result.serverInfo.steamid,
        botCount: result.serverInfo.botCount,
      },
    );

    return result;
  } catch (error) {
    // RCON connection failed - this is common if RCON isn't enabled or is on a different port
    const errorInfo = {
      error: error.message,
      code: error.code,
      type: error.constructor.name,
    };
    
    // Use debug level for connection issues (likely RCON not configured or wrong port)
    if (error.code === "ECONNREFUSED") {
      logger.debug(`RCON connection refused for ${ip}:${port} (server not listening on this port, try checking server config for actual RCON port)`, errorInfo);
    } else if (error.code === "ETIMEDOUT") {
      logger.debug(`RCON timeout for ${ip}:${port} (firewall or server not responding)`, errorInfo);
    } else if (error.message && error.message.includes("Authentication failed")) {
      logger.warn(`RCON authentication failed for ${ip}:${port} (wrong password)`, errorInfo);
    } else {
      // Other errors are more interesting
      logger.warn(`RCON failed for ${ip}:${port}:`, errorInfo);
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
 * Parse CS2/CS:GO 'status' command output to extract player info and server details
 * 
 * Format Detection:
 * - Checks version line: CS:GO = 1.38.x, CS2 = 1.40.x+
 * 
 * CS:GO Format:
 * - hostname: X, version : X, os: X, players: X
 * - Player line: # userid1 userid2 "name" STEAM_1:0:12345  H:MM:SS ping loss state rate address
 * - Steam IDs included directly in player lines (STEAM_X:Y:Z or [U:1:Z] format)
 * 
 * CS2 Format:
 * - hostname : X (may have timestamp prefix), version  : X, os/type  : X, steamid  : X
 * - Player line: userid H:MM:SS ping loss state rate address 'name' (NO # prefix)
 * - Steam IDs NOT in status output - must use status_json command instead
 * - Names enclosed in single quotes instead of double quotes
 * 
 * Time Format Support:
 * - Handles MM:SS, H:MM:SS, and HH:MM:SS formats
 * 
 * @param {string} statusText - Raw output from RCON status command
 * @returns {Object} { players: [], serverInfo: {}, isCS2: boolean }
 */
function parseStatusResponse(statusText) {
  const players = [];
  const serverInfo = {
    hostname: null,
    os: null,
    secure: null,
    botCount: 0,
  };

  const lines = statusText.split("\n");
  let isCS2 = false;

  // Detect format by checking version line
  // CS:GO always has version : 1.38.x.x format
  // CS2 has version  : 1.4x.x.x (note: double space and different version number)
  const versionMatch = statusText.match(/version\s+:\s+(\d+\.\d+)/);
  if (versionMatch) {
    const majorMinor = parseFloat(versionMatch[1]);
    // CS:GO is 1.38.x, CS2 is 1.40+ (as of late 2024/2025)
    isCS2 = majorMinor >= 1.40;
  }

  for (const line of lines) {
    // Extract hostname - works for both formats
    // CS:GO: "hostname: FemboyKZ | EU"
    // CS2:   "Oct 25 21:52:46:  hostname : FemboyKZ - CS2"
    const hostnameMatch = line.match(/hostname\s*:\s*(.+)/i);
    if (hostnameMatch) {
      serverInfo.hostname = hostnameMatch[1].trim();
    }

    // Extract OS/type
    // CS:GO: "os      :  Linux"
    // CS2:   "os/type  : Linux dedicated"
    const osMatch = line.match(/os(?:\/type)?\s*:\s*(.+)/i);
    if (osMatch) {
      serverInfo.os = osMatch[1].trim();
    }

    // Extract secure status from version line
    // CS:GO: "version : 1.38.8.1/13881 1575/8853 secure  [G:1:5746871]"
    // CS2:   "version  : 1.41.1.7/14117 10581 secure  public"
    const versionMatch = line.match(/version\s*:\s*.+\s+(secure|insecure)\s+/i);
    if (versionMatch) {
      serverInfo.secure = versionMatch[1].toLowerCase() === "secure";
    }

    // Parse player lines - different formats
    // CS2 player lines DON'T start with #, CS:GO lines DO
    const trimmedLine = line.trim();
    
    if (isCS2) {
      // CS2 format: id     time ping loss      state   rate adr name
      // Example: 65280    12:01   53    0     active 786432 152.230.154.180:52146 'nikita '
      // Skip header and separator lines
      if (trimmedLine.includes("id") && trimmedLine.includes("time") && trimmedLine.includes("ping")) {
        continue;
      }
      if (trimmedLine.includes("----") || trimmedLine.includes("#end") || !trimmedLine) {
        continue;
      }
      
      // Match lines that start with a number (player ID)
      // Time can be MM:SS or H:MM:SS or HH:MM:SS
      const match = trimmedLine.match(
        /^(\d+)\s+(\d+:\d+(?::\d+)?)\s+(\d+)\s+(\d+)\s+(\w+)\s+(\d+)\s+(\S+)\s+'([^']+)'/
      );
      
      if (match) {
        const [, userid, time, ping, loss, state, rate, address, name] = match;
        
        // Extract IP from address (format: ip:port)
        const playerIP = address ? address.split(':')[0] : null;
        
        const isBot = name.toLowerCase().includes("bot");
        if (isBot) {
          serverInfo.botCount++;
        }

        players.push({
          userid: parseInt(userid, 10),
          name: name.trim(),
          steamid: null, // CS2 doesn't include Steam ID in status output - needs different RCON command
          ip: playerIP,
          time: time,
          ping: parseInt(ping, 10),
          loss: parseInt(loss, 10),
          state: state,
          bot: isBot,
        });
      }
    } else if (trimmedLine.startsWith("#") && !trimmedLine.includes("#end")) {
      try {
        // Skip the header line
        if (trimmedLine.includes("userid") && trimmedLine.includes("name")) {
          continue;
        }
        
        // CS:GO format: # userid1 userid2 "name" steamid  time ping loss state rate address
        // Example: #  2 1 "ispp" STEAM_1:1:570793417  1:07:59 188 0 active 196608 187.55.85.1:27005
        // Note: There are TWO spaces between steamid and time (connected time field)
        // The first userid is display ID, second is internal ID
        
        // Time can be MM:SS or H:MM:SS or HH:MM:SS
        // Capture optional address at the end (ip:port format)
        const match = trimmedLine.match(
          /#\s+(\d+)\s+\d+\s+"([^"]+)"\s+(STEAM_[0-9]:[0-9]:\d+|\[U:[0-9]:\d+\]|BOT)\s+(\d+:\d+(?::\d+)?)\s+(\d+)\s+(\d+)\s+(\w+)(?:\s+\d+\s+(\S+))?/
        );

        if (match) {
          const [, userid, name, steamid, time, ping, loss, state, , address] = match;
          
          // Extract IP from address (format: ip:port)
          const playerIP = address ? address.split(':')[0] : null;

          const isBot = steamid === "BOT";
          if (isBot) {
            serverInfo.botCount++;
          }

          players.push({
            userid: parseInt(userid, 10),
            name: name.trim(),
            steamid: isBot ? null : steamid,
            ip: playerIP,
            time: time,
            ping: parseInt(ping, 10),
            loss: parseInt(loss, 10),
            state: state,
            bot: isBot,
          });
        }
      } catch (error) {
        logger.debug(`Failed to parse CS:GO player line: ${line}`, {
          error: error.message,
        });
      }
    }
  }

  logger.info(`=== PARSING COMPLETE ===`);
  logger.info(`Extracted ${players.length} players, ${serverInfo.botCount} bots`);
  logger.info(`Server info: ${JSON.stringify(serverInfo)}`);

  return { players, serverInfo, isCS2 };
}

/**
 * Enrich CS2 players with Steam IDs from status_json command
 * 
 * CS2's status command doesn't include Steam IDs, so we must use status_json
 * which returns a JSON object with server.clients array containing:
 * - steamid64: SteamID64 format (76561198...)
 * - steamid: SteamID3 format ([U:1:...])
 * - bot: Boolean flag
 * - name: Player name
 * 
 * Players are matched by name (trimmed) since CS2 doesn't provide a consistent
 * userid mapping between status and status_json commands.
 * 
 * @param {Array} players - Array of player objects from parseStatusResponse (missing steamid)
 * @param {string} statusJsonResponse - Raw JSON output from RCON status_json command
 */
function enrichCS2PlayersWithSteamIDs(players, statusJsonResponse) {
  try {
    logger.debug(`Parsing status_json response (${statusJsonResponse.length} chars)`);
    
    // Clean up the response - sometimes RCON responses have extra text before/after JSON
    let jsonText = statusJsonResponse.trim();
    
    // Find the first { and last } to extract just the JSON part
    const firstBrace = jsonText.indexOf('{');
    const lastBrace = jsonText.lastIndexOf('}');
    
    if (firstBrace === -1 || lastBrace === -1) {
      logger.error(`No JSON found in status_json response`);
      logger.debug(`Raw response:\n${statusJsonResponse}`);
      return;
    }
    
    jsonText = jsonText.substring(firstBrace, lastBrace + 1);
    
    const data = JSON.parse(jsonText);
    
    // Clients array is nested in server.clients
    const clients = data.server?.clients;
    
    if (!clients || !Array.isArray(clients)) {
      logger.warn(`status_json response missing server.clients array`);
      return;
    }
    
    logger.debug(`Found ${clients.length} clients in status_json`);
    
    // Create a map of name -> steamid for matching
    const steamIdMap = new Map();
    
    for (const client of clients) {
      if (client.name && client.steamid) {
        // Trim the name to match how we parsed it
        const trimmedName = client.name.trim();
        steamIdMap.set(trimmedName, {
          steamid: client.steamid,
          steamid64: client.steamid64,
          bot: client.bot || false
        });
        logger.debug(`Client from status_json: name="${trimmedName}", steamid=${client.steamid}, bot=${client.bot}`);
      }
    }
    
    // Match Steam IDs to players by name
    let enrichedCount = 0;
    for (const player of players) {
      const steamData = steamIdMap.get(player.name);
      if (steamData && !steamData.bot) {
        player.steamid = steamData.steamid;
        logger.debug(`Enriched player "${player.name}" with Steam ID ${steamData.steamid}`);
        enrichedCount++;
      }
    }
    
    logger.info(`Enriched ${enrichedCount} CS2 players with Steam IDs from status_json`);
  } catch (error) {
    logger.error(`Failed to parse status_json response: ${error.message}`);
    logger.debug(`Raw status_json response:\n${statusJsonResponse}`);
  }
}

/**
 * Convert Steam ID formats to SteamID64
 * 
 * Supported input formats:
 * - STEAM_X:Y:Z (SteamID2) -> 76561197960265728 + (Z * 2) + Y
 * - [U:1:Z] (SteamID3) -> 76561197960265728 + Z
 * - [G:1:Z] (GameServer ID) -> 85568392932669440 + Z
 * 
 * @param {string} steamid - Steam ID in any supported format
 * @returns {string|null} SteamID64 or null if invalid/bot
 */
function convertToSteamID64(steamid) {
  if (!steamid) return null;

  try {
    // Already SteamID64
    if (/^\d{17}$/.test(steamid)) {
      return steamid;
    }

    // STEAM_X:Y:Z format
    const steamMatch = steamid.match(/STEAM_([0-9]):([0-9]):(\d+)/);
    if (steamMatch) {
      const [, , y, z] = steamMatch;
      const accountId = parseInt(z, 10) * 2 + parseInt(y, 10);
      return (BigInt(76561197960265728) + BigInt(accountId)).toString();
    }

    // [U:1:Z] format
    const uMatch = steamid.match(/\[U:1:(\d+)\]/);
    if (uMatch) {
      const accountId = parseInt(uMatch[1], 10);
      return (BigInt(76561197960265728) + BigInt(accountId)).toString();
    }

    return null;
  } catch (error) {
    logger.error(`Failed to convert Steam ID: ${steamid}`, {
      error: error.message,
    });
    return null;
  }
}

module.exports = { queryRcon, convertToSteamID64 };
