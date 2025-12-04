/**
 * Discord Webhook Service
 *
 * Posts server status updates to Discord using webhooks.
 * - Separate webhooks for CS:GO and CS2 servers
 * - Creates or updates existing messages (edit instead of spam)
 * - Runs after server queries complete (called from updater.js)
 * - Rich embeds with server information
 *
 * Configuration (via .env):
 *   DISCORD_WEBHOOK_CSGO=https://discord.com/api/webhooks/...
 *   DISCORD_WEBHOOK_CS2=https://discord.com/api/webhooks/...
 *   DISCORD_WEBHOOK_ENABLED=true
 *
 * Message Format:
 * - Embed color: Pink (#ff00b3) (online) / Red (offline)
 * - Title: Total players across all servers
 * - Fields: One per server with status, map, player count
 * - Footer: Last updated timestamp
 */

require("dotenv").config();
const axios = require("axios");
const logger = require("../utils/logger");
const pool = require("../db");
const { sanitizePlayerName } = require("../utils/validators");

// Configuration
const WEBHOOK_ENABLED = process.env.DISCORD_WEBHOOK_ENABLED === "true";
const WEBHOOK_CSGO = process.env.DISCORD_WEBHOOK_CSGO;
const WEBHOOK_CS2 = process.env.DISCORD_WEBHOOK_CS2;

// Store message IDs for editing (loaded from database)
let csgoMessageId = null;
let cs2MessageId = null;

/**
 * Load message IDs from database
 */
async function loadMessageIds() {
  try {
    const [rows] = await pool.query(
      "SELECT setting_key, setting_value FROM settings WHERE setting_key IN ('discord_message_id_csgo', 'discord_message_id_cs2')",
    );

    rows.forEach((row) => {
      if (row.setting_key === "discord_message_id_csgo" && row.setting_value) {
        csgoMessageId = row.setting_value;
      } else if (
        row.setting_key === "discord_message_id_cs2" &&
        row.setting_value
      ) {
        cs2MessageId = row.setting_value;
      }
    });
  } catch (error) {
    logger.warn("Failed to load Discord message IDs from database", {
      error: error.message,
    });
  }
}

/**
 * Save message ID to database
 */
async function saveMessageId(game, messageId) {
  try {
    const key =
      game === "csgo" ? "discord_message_id_csgo" : "discord_message_id_cs2";
    await pool.query(
      "INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?, updated_at = CURRENT_TIMESTAMP",
      [key, messageId, messageId],
    );
    logger.debug("Saved Discord message ID to database", { game, messageId });
  } catch (error) {
    logger.error("Failed to save Discord message ID to database", {
      game,
      messageId,
      error: error.message,
    });
  }
}

/**
 * Parse webhook URL to extract webhook ID and token
 */
function parseWebhookUrl(url) {
  if (!url) return null;

  const match = url.match(/\/webhooks\/(\d+)\/([^/]+)/);
  if (!match) {
    logger.error("Invalid webhook URL format", { url });
    return null;
  }

  return {
    id: match[1],
    token: match[2],
  };
}

/**
 * Fetch servers from database by game type
 */
async function getServersByGame(game) {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM servers WHERE game = ? ORDER BY port ASC",
      [game],
    );

    return rows.map((server) => {
      // Parse players_list JSON
      let playersList = [];
      if (server.players_list) {
        try {
          playersList =
            typeof server.players_list === "string"
              ? JSON.parse(server.players_list)
              : server.players_list;
        } catch (e) {
          playersList = [];
        }
      }

      return {
        ip: server.ip,
        port: server.port,
        game: server.game,
        hostname: server.hostname,
        status: server.status,
        map: server.map,
        players: server.player_count,
        maxplayers: server.maxplayers,
        bots: server.bot_count,
        region: server.region,
        domain: server.domain,
        tickrate: server.tickrate,
        playersList,
      };
    });
  } catch (error) {
    logger.error("Failed to fetch servers from database", {
      game,
      error: error.message,
    });
    return [];
  }
}

/**
 * Build Discord embeds for servers grouped by region
 */
function buildEmbeds(servers, game) {
  try {
    const gameTitle = game === "csgo" ? "CS:GO" : "CS2";
    const gameLower = game === "csgo" ? "csgo" : "cs2";

    // Group servers by region and sort by port
    const euServers = servers
      .filter((s) => s.region === "eu")
      .sort((a, b) => a.port - b.port);
    const naServers = servers
      .filter((s) => s.region === "na")
      .sort((a, b) => a.port - b.port);
    const otherServers = servers
      .filter((s) => s.region !== "eu" && s.region !== "na")
      .sort((a, b) => a.region - b.region);

    const embeds = [];

    // Helper function to build a single embed for a region
    function buildRegionEmbed(regionServers, regionName) {
      const onlineServers = regionServers.filter((s) => s.status === 1);
      const totalPlayers = regionServers.reduce(
        (sum, s) => sum + (s.players || 0),
        0,
      );

      // Color: Pink if any server online, Red if all offline
      const color = onlineServers.length > 0 ? 0xff00b3 : 0xf04747;

      const regionFlag =
        regionName === "EU"
          ? ":flag_eu:"
          : regionName === "NA"
            ? ":flag_us:"
            : ":globe_with_meridians:";

      const regionFlags = {
        na: "",
        eu: "",
        as: ":flag_jp:",
        sa: ":flag_br:",
        au: ":flag_au:",
        za: ":flag_za:",
      };

      const embed = {
        title: `${regionFlag} FKZ ${gameTitle} ${regionName} Servers`,
        description: `**${totalPlayers} ${totalPlayers === 1 ? "femboy" : "femboys"}** online across **${onlineServers.length}/${regionServers.length}** ${onlineServers.length === 1 ? "server" : "servers"}\n\u200B`,
        color,
        fields: [],
        footer: {
          text: `Last updated`,
        },
        timestamp: new Date().toISOString(),
        image: {
          url: "https://femboy.kz/images/wide.png",
        },
      };

      // Add field for each server
      regionServers.forEach((server, index) => {
        const statusEmoji =
          server.status === 1 ? ":green_circle:" : ":broken_heart:";
        const serverName =
          `${regionFlags[server.region]} ${server.hostname}` ||
          `${regionFlags[server.region]} ${server.ip}:${server.port}`;

        let fieldValue = `${statusEmoji} - Players: \`${server.players || 0}/${server.maxplayers || 0}\``;

        if (server.status === 1) {
          fieldValue += ` - Map: \`${server.map || "Unknown"}\``;

          if (server.domain) {
            fieldValue += `\n[connect ${server.domain}:${server.port}](<https://${gameLower}.femboy.kz/connect?ip=${server.ip}:${server.port}>)`;
          }

          if (server.playersList.length > 0) {
            const playerLinks = server.playersList
              .slice(0, 15)
              .map((p) => {
                // Sanitize player name (removes invisible Unicode, control chars)
                const displayName = sanitizePlayerName(p.name) || "Unknown";

                if (p.steamid) {
                  return `• [${displayName}](<https://steamcommunity.com/profiles/${p.steamid}>)`;
                }
                return `• ${displayName}`;
              })
              .join("\n");

            const remaining =
              server.playersList.length > 15
                ? `\n... +${server.playersList.length - 15} more`
                : "";

            fieldValue += `\nPlayers:\n${playerLinks}${remaining}`;
          }
        } else {
          fieldValue += `\n\`OFFLINE!\``;
        }

        // Add spacing after field, except for the last server
        const isLastServer = index === regionServers.length - 1;
        if (!isLastServer) {
          fieldValue += `\n\u200B`;
        }

        embed.fields.push({
          name: serverName,
          value: fieldValue,
          inline: false,
        });
      });

      return embed;
    }

    if (euServers.length > 0) {
      embeds.push(buildRegionEmbed(euServers, "EU"));
    }

    if (naServers.length > 0) {
      embeds.push(buildRegionEmbed(naServers, "NA"));
    }

    if (otherServers.length > 0) {
      embeds.push(buildRegionEmbed(otherServers, "Other"));
    }

    return embeds;
  } catch (error) {
    logger.error("Error in buildEmbeds", {
      error: error.message,
      stack: error.stack,
      game,
    });
    return [];
  }
}

/**
 * Send or update Discord message with multiple embeds
 */
async function sendOrUpdateMessage(webhookUrl, embeds, messageId = null) {
  const webhook = parseWebhookUrl(webhookUrl);
  if (!webhook) {
    return null;
  }

  try {
    if (messageId) {
      // Edit existing message
      const editUrl = `https://discord.com/api/webhooks/${webhook.id}/${webhook.token}/messages/${messageId}`;
      await axios.patch(editUrl, {
        embeds: embeds,
      });
      logger.debug("Updated Discord message", { messageId });
      return messageId;
    } else {
      // Create new message
      const createUrl = `https://discord.com/api/webhooks/${webhook.id}/${webhook.token}?wait=true`;
      const response = await axios.post(createUrl, {
        embeds: embeds,
      });
      return response.data.id;
    }
  } catch (error) {
    if (error.response?.status === 404 && messageId) {
      // Message was deleted, create a new one
      logger.warn("Discord message not found, creating new one", { messageId });
      return sendOrUpdateMessage(webhookUrl, embeds, null);
    }

    logger.error("Failed to send/update Discord message", {
      error: error.message,
      status: error.response?.status,
      data: error.response?.data,
    });
    return null;
  }
}

/**
 * Update Discord webhooks for both games
 */
async function updateDiscordWebhooks() {
  if (!WEBHOOK_ENABLED) {
    logger.debug("Discord webhooks disabled");
    return;
  }

  try {
    // Update CS:GO webhook
    if (WEBHOOK_CSGO) {
      const csgoServers = await getServersByGame("csgo");
      if (csgoServers.length > 0) {
        const csgoEmbeds = buildEmbeds(csgoServers, "csgo");
        const newMessageId = await sendOrUpdateMessage(
          WEBHOOK_CSGO,
          csgoEmbeds,
          csgoMessageId,
        );
        if (newMessageId && newMessageId !== csgoMessageId) {
          csgoMessageId = newMessageId;
          await saveMessageId("csgo", newMessageId);
        }
      }
    }

    // Update CS2 webhook
    if (WEBHOOK_CS2) {
      const cs2Servers = await getServersByGame("counterstrike2");
      if (cs2Servers.length > 0) {
        const cs2Embeds = buildEmbeds(cs2Servers, "counterstrike2");
        const newMessageId = await sendOrUpdateMessage(
          WEBHOOK_CS2,
          cs2Embeds,
          cs2MessageId,
        );
        if (newMessageId && newMessageId !== cs2MessageId) {
          cs2MessageId = newMessageId;
          await saveMessageId("cs2", newMessageId);
        }
      }
    }

    logger.debug("Discord webhooks updated successfully");
  } catch (error) {
    logger.error("Error updating Discord webhooks", { error: error.message });
  }
}

module.exports = {
  updateDiscordWebhooks,
  loadMessageIds,
};
