const Rcon = require("rcon-srcds").default;
const logger = require("../utils/logger");

/**
 * Query server via RCON to get player details including Steam IDs
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

    await rcon.disconnect();

    if (!response || response.length === 0) {
      logger.warn(`RCON returned empty response from ${ip}:${port}`);
      return null;
    }

    const result = parseStatusResponse(response);
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
 * CS:GO format: hostname: X, version : X, os: X, players: X
 * CS2 format: hostname : X (with timestamp prefix), version  : X, os/type  : X, steamid  : X
 * Player line examples:
 * CS:GO: # 123 "PlayerName" STEAM_1:0:12345678 01:23 45 0 active 192.168.1.1:27005
 * CS2:  # 123      01:23   45    0   active  16000 adr "PlayerName"
 */
function parseStatusResponse(statusText) {
  const players = [];
  const serverInfo = {
    hostname: null,
    os: null,
    secure: null,
    steamid: null,
    botCount: 0,
  };

  const lines = statusText.split("\n");
  let isCS2 = false;

  // Detect format by checking for CS2-specific patterns (timestamp prefix)
  if (statusText.includes("Oct ") || statusText.includes("Jan ") || 
      statusText.includes("Feb ") || statusText.includes("Mar ") ||
      statusText.match(/^\w{3}\s+\d{1,2}\s+\d{2}:/m)) {
    isCS2 = true;
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

    // Extract Steam ID (owner) - different locations in CS:GO vs CS2
    // CS:GO: in version line as [G:1:5746871]
    // CS2:   separate line "steamid  : [G:1:12629799] (85568392932669223)"
    const steamidMatch = line.match(/steamid\s*:\s*(\[G:[0-9]:\d+\]|\d{17})/i);
    if (steamidMatch) {
      // CS2 format - use the bracket format or raw steamid64
      const steamidStr = steamidMatch[1].trim();
      if (steamidStr.startsWith('[G:')) {
        // Convert [G:1:X] to SteamID64
        const gMatch = steamidStr.match(/\[G:1:(\d+)\]/);
        if (gMatch) {
          serverInfo.steamid = (BigInt(103562079161294848) + BigInt(gMatch[1])).toString();
        }
      } else {
        serverInfo.steamid = steamidStr;
      }
    } else {
      // CS:GO format - extract from version line
      const csgoSteamMatch = line.match(/\[G:1:(\d+)\]/);
      if (csgoSteamMatch && !serverInfo.steamid) {
        serverInfo.steamid = (BigInt(103562079161294848) + BigInt(csgoSteamMatch[1])).toString();
      }
    }

    // Parse player lines - different formats
    if (line.trim().startsWith("#") && !line.includes("#end")) {
      try {
        if (isCS2) {
          // CS2 format: #  id     time ping loss      state   rate adr name
          // Example: # 123      01:23   45    0   active  16000 adr "PlayerName"
          const match = line.match(
            /#\s+(\d+)\s+(\d+:\d+)\s+(\d+)\s+(\d+)\s+(\w+)\s+(\d+)\s+(\S+)\s+"([^"]+)"/
          );
          
          if (match) {
            const [, userid, time, ping, loss, state, rate, steamid, name] = match;
            
            const isBot = steamid === "BOT" || name.toLowerCase().includes("[bot]");
            if (isBot) {
              serverInfo.botCount++;
            }

            players.push({
              userid: parseInt(userid, 10),
              name: name.trim(),
              steamid: isBot ? null : steamid,
              time: time,
              ping: parseInt(ping, 10),
              loss: parseInt(loss, 10),
              state: state,
              bot: isBot,
            });
          }
        } else {
          // CS:GO format: # userid "name" steamid time ping loss state [address]
          // Example: # 123 "PlayerName" STEAM_1:0:12345678 01:23 45 0 active 192.168.1.1:27005
          const match = line.match(
            /#\s+(\d+)\s+"([^"]+)"\s+(STEAM_[0-9]:[0-9]:\d+|\[U:[0-9]:\d+\]|BOT)\s+(\d+:\d+)\s+(\d+)\s+(\d+)\s+(\w+)/
          );

          if (match) {
            const [, userid, name, steamid, time, ping, loss, state] = match;

            const isBot = steamid === "BOT";
            if (isBot) {
              serverInfo.botCount++;
            }

            players.push({
              userid: parseInt(userid, 10),
              name: name.trim(),
              steamid: isBot ? null : steamid,
              time: time,
              ping: parseInt(ping, 10),
              loss: parseInt(loss, 10),
              state: state,
              bot: isBot,
            });
          }
        }
      } catch (error) {
        logger.debug(`Failed to parse player line: ${line}`, {
          error: error.message,
        });
      }
    }
  }

  return { players, serverInfo };
}

/**
 * Convert Steam ID formats to SteamID64
 * STEAM_1:0:12345678 -> 76561197960265728 + (12345678 * 2) + 0
 * [U:1:12345678] -> 76561197960265728 + 12345678 - 1
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
