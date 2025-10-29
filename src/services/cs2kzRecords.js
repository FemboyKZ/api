const axios = require("axios");
const logger = require("../utils/logger");

const CS2KZ_API_URL = process.env.CS2KZ_API_URL || "https://api.cs2kz.org";

/**
 * Fetch recent records from CS2KZ API for a specific server
 * 
 * @param {number} serverId - The CS2KZ API server ID
 * @param {number} limit - Maximum number of records to fetch (default: 10)
 * @returns {Promise<Array>} Array of recent records
 */
async function fetchRecentRecords(serverId, limit = 10) {
  try {
    const url = `${CS2KZ_API_URL}/records`;
    const params = {
      server: serverId,
      sort_by: "submission-date",
      sort_order: "descending",
      limit: limit,
    };

    logger.info(`Fetching records from CS2KZ API`, {
      url,
      params,
      serverId,
    });

    const response = await axios.get(url, {
      params,
      timeout: 5000,
    });

    logger.info(`CS2KZ API response for server ${serverId}`, {
      status: response.status,
      dataLength: response.data?.values?.length || response.data?.data?.length || response.data?.length || 0,
      dataType: Array.isArray(response.data) ? 'array' : typeof response.data,
      hasDataProperty: response.data?.data !== undefined,
      hasValuesProperty: response.data?.values !== undefined,
      total: response.data?.total,
      responseKeys: Object.keys(response.data || {}),
    });

    // CS2KZ API returns { total: number, values: [...] }
    const records = response.data?.values || response.data?.data || [];

    if (!Array.isArray(records)) {
      logger.warn(`Unexpected response format from CS2KZ API for server ${serverId}`, {
        responseKeys: Object.keys(response.data || {}),
        recordsType: typeof records,
      });
      return [];
    }

    logger.info(`Fetched ${records.length} records for server ${serverId}`);
    return records;
  } catch (error) {
    if (error.response) {
      logger.error(`CS2KZ API error for server ${serverId}`, {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data,
        url: error.config?.url,
        params: error.config?.params,
      });
    } else if (error.request) {
      logger.error(`CS2KZ API no response for server ${serverId}`, {
        error: error.message,
        code: error.code,
      });
    } else {
      logger.error(`CS2KZ API request error for server ${serverId}`, {
        error: error.message,
      });
    }
    return [];
  }
}

/**
 * Fetch recent records for all CS2 servers that have an apiId
 * 
 * @param {Array} servers - Array of server objects with apiId property
 * @param {number} limit - Maximum records per server (default: 10)
 * @returns {Promise<Object>} Object with server keys and their recent records
 */
async function fetchRecentRecordsForServers(servers, limit = 10) {
  const cs2Servers = servers.filter(s => s.game === "counterstrike2" && s.apiId);
  
  if (cs2Servers.length === 0) {
    logger.info("No CS2 servers with apiId found");
    return {};
  }

  logger.info(`Fetching recent records for ${cs2Servers.length} CS2 servers`);

  const recordsPromises = cs2Servers.map(async (server) => {
    const records = await fetchRecentRecords(server.apiId, limit);
    return {
      serverKey: `${server.ip}:${server.port}`,
      apiId: server.apiId,
      records: records,
    };
  });

  const results = await Promise.all(recordsPromises);

  // Convert to object with server keys
  const recordsMap = {};
  results.forEach(result => {
    recordsMap[result.serverKey] = {
      apiId: result.apiId,
      records: result.records,
    };
  });

  return recordsMap;
}

module.exports = {
  fetchRecentRecords,
  fetchRecentRecordsForServers,
};
