#!/usr/bin/env node

/**
 * Standalone script to populate Player PBs and World Records from local database
 *
 * Usage:
 *   node scripts/populate-pbs-wrs.js [options]
 *
 * Options:
 *   --wrs-only      Only populate world records
 *   --pbs-only      Only populate player PBs
 *   --map <name>    Refresh WRs for a specific map
 *   --player <id>   Refresh PBs for a specific player (steamid64)
 *   --batch <size>  Batch size for bulk operations (default: 100)
 *   --verify        Verify/update stats against KZT API instead of local DB
 *   --force         Force refresh even if already synced
 *   --help          Show this help message
 *
 * Environment:
 *   KZ_SCRAPER_PROXIES  Comma-separated list of proxy URLs for --verify mode
 *                       Format: http://user:pass@host:port or http://host:port
 *
 * Examples:
 *   node scripts/populate-pbs-wrs.js                    # Full population from local DB
 *   node scripts/populate-pbs-wrs.js --wrs-only         # Only WRs from local DB
 *   node scripts/populate-pbs-wrs.js --verify           # Verify against KZT API
 *   node scripts/populate-pbs-wrs.js --map kz_beginnerblock_go  # Single map
 *   node scripts/populate-pbs-wrs.js --player 76561198012345678  # Single player
 */

require("dotenv").config();

const axios = require("axios");
const { HttpsProxyAgent } = require("https-proxy-agent");
const { HttpProxyAgent } = require("http-proxy-agent");
const {
  initKzDatabase,
  getKzPool,
  closeKzDatabase,
} = require("../src/db/kzRecords");

const GOKZ_API_URL =
  process.env.GOKZ_API_URL || "https://kztimerglobal.com/api/v2";

// Proxy configuration
const PROXY_CONFIG = {
  proxies: process.env.KZ_SCRAPER_PROXIES
    ? process.env.KZ_SCRAPER_PROXIES.split(",")
        .map((p) => p.trim())
        .filter(Boolean)
    : [],
  retryAttempts: 3,
  retryDelay: 2500,
  rateLimitDelay: 60000,
};

// Proxy state
let currentProxyIndex = 0;
const proxyAgents = [];
let rateLimitCount = 0;

/**
 * Setup proxy agents from environment configuration
 */
function setupProxies() {
  if (PROXY_CONFIG.proxies.length > 0) {
    console.log(`Setting up ${PROXY_CONFIG.proxies.length} proxies...`);

    PROXY_CONFIG.proxies.forEach((proxyUrl, index) => {
      try {
        const httpsAgent = new HttpsProxyAgent(proxyUrl);
        const httpAgent = new HttpProxyAgent(proxyUrl);
        proxyAgents.push({ proxyUrl, httpsAgent, httpAgent });
        // Hide password in log
        const displayUrl = proxyUrl.replace(/:([^@:]+)@/, ":****@");
        console.log(`  Proxy ${index + 1}: ${displayUrl}`);
      } catch (error) {
        console.error(
          `  Failed to create agent for proxy ${proxyUrl}: ${error.message}`,
        );
      }
    });

    if (proxyAgents.length === 0) {
      console.log("No valid proxies configured, using direct connection");
    } else {
      console.log(`${proxyAgents.length} proxies ready for rotation`);
    }
  }
}

/**
 * Get axios config with proxy agent if available
 */
function getAxiosConfigWithProxy(timeout = 10000) {
  const config = { timeout };

  if (proxyAgents.length > 0) {
    const agent = proxyAgents[currentProxyIndex];
    if (GOKZ_API_URL.startsWith("https")) {
      config.httpsAgent = agent.httpsAgent;
    } else {
      config.httpAgent = agent.httpAgent;
    }
    // Round-robin to next proxy
    currentProxyIndex = (currentProxyIndex + 1) % proxyAgents.length;
  }

  return config;
}

// WR types to sync - mode strings map to mode IDs in DB
const WR_TYPES = [
  {
    mode: "kz_timer",
    modeId: 200,
    hasTeleports: false,
    columnPrefix: "wr_kz_timer_pro",
  },
  {
    mode: "kz_timer",
    modeId: 200,
    hasTeleports: null,
    columnPrefix: "wr_kz_timer_overall",
  },
  {
    mode: "kz_simple",
    modeId: 201,
    hasTeleports: false,
    columnPrefix: "wr_kz_simple_pro",
  },
  {
    mode: "kz_simple",
    modeId: 201,
    hasTeleports: null,
    columnPrefix: "wr_kz_simple_overall",
  },
  {
    mode: "kz_vanilla",
    modeId: 202,
    hasTeleports: false,
    columnPrefix: "wr_kz_vanilla_pro",
  },
  {
    mode: "kz_vanilla",
    modeId: 202,
    hasTeleports: null,
    columnPrefix: "wr_kz_vanilla_overall",
  },
];

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    wrsOnly: false,
    pbsOnly: false,
    map: null,
    player: null,
    batchSize: 100,
    concurrency: 10,
    verify: false,
    force: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--wrs-only":
        options.wrsOnly = true;
        break;
      case "--pbs-only":
        options.pbsOnly = true;
        break;
      case "--map":
        options.map = args[++i];
        break;
      case "--player":
        options.player = args[++i];
        break;
      case "--batch":
        options.batchSize = parseInt(args[++i], 10) || 100;
        break;
      case "--concurrency":
        options.concurrency = parseInt(args[++i], 10) || 10;
        break;
      case "--verify":
        options.verify = true;
        break;
      case "--force":
        options.force = true;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
    }
  }

  return options;
}

function showHelp() {
  console.log(`
Standalone script to populate Player PBs and World Records

Usage:
  node scripts/populate-pbs-wrs.js [options]

Options:
  --wrs-only        Only populate world records
  --pbs-only        Only populate player PBs
  --map <name>      Refresh WRs for a specific map
  --player <id>     Refresh PBs for a specific player (steamid64)
  --batch <size>    Batch size for bulk operations (default: 100)
  --concurrency <n> Number of players to process in parallel (default: 10)
  --verify          Verify/update stats against KZT API instead of local DB
  --force           Force refresh even if already synced
  --help            Show this help message

Environment:
  KZ_SCRAPER_PROXIES  Comma-separated proxy URLs for --verify mode (avoids rate limits)
                      Format: http://user:pass@host:port or http://host:port

Examples:
  node scripts/populate-pbs-wrs.js                    # Full population from local DB
  node scripts/populate-pbs-wrs.js --wrs-only         # Only WRs from local DB  
  node scripts/populate-pbs-wrs.js --pbs-only --concurrency 20  # Fast PB population
  node scripts/populate-pbs-wrs.js --verify           # Verify against KZT API
  node scripts/populate-pbs-wrs.js --map kz_beginnerblock_go  # Single map
  node scripts/populate-pbs-wrs.js --player 76561198012345678  # Single player

Proxy usage (for --verify mode):
  KZ_SCRAPER_PROXIES=http://proxy1:8080,http://proxy2:8080 node scripts/populate-pbs-wrs.js --verify
`);
}

// ================== LOCAL DB FUNCTIONS ==================

/**
 * Get WR from local database for a specific map/mode/teleport type
 * Excludes banned, non-validated, and placeholder players
 */
async function getWRFromLocalDB(pool, mapId, mode, hasTeleports) {
  let query = `
    SELECT 
      r.id as record_id,
      r.time,
      r.teleports,
      r.points,
      r.created_on,
      p.steamid64,
      p.player_name
    FROM kz_records_partitioned r
    INNER JOIN kz_players p ON r.player_id = p.id
    WHERE r.map_id = ?
      AND r.mode = ?
      AND r.stage = 0
      AND r.tickrate = 128
      AND (p.is_banned IS NULL OR p.is_banned = FALSE)
      AND p.steamid64 LIKE '7656119%'
  `;

  const params = [mapId, mode];

  if (hasTeleports === false) {
    // Pro records only (0 teleports)
    query += " AND r.teleports = 0";
  }
  // hasTeleports === null means overall (any teleports)

  query += " ORDER BY r.time ASC LIMIT 1";

  const [rows] = await pool.query(query, params);

  if (rows.length === 0) {
    return null;
  }

  const wr = rows[0];
  return {
    time: wr.time,
    steamid64: wr.steamid64,
    playerName: wr.player_name,
    recordId: wr.record_id,
    teleports: wr.teleports,
  };
}

/**
 * Get all PBs for a player from local database
 * Returns best times per map/mode
 */
async function getPBsFromLocalDB(pool, playerId) {
  const query = `
    SELECT 
      r.id as record_id,
      r.map_id,
      m.map_name,
      m.difficulty as map_difficulty,
      m.validated as map_validated,
      r.mode,
      r.time,
      r.teleports,
      r.points,
      r.created_on
    FROM kz_records_partitioned r
    INNER JOIN kz_maps m ON r.map_id = m.id
    WHERE r.player_id = ?
      AND r.stage = 0
      AND r.tickrate = 128
    ORDER BY r.map_id, r.mode, r.teleports, r.time ASC
  `;

  const [rows] = await pool.query(query, [playerId]);

  // Group by map/mode and find best pro/tp times
  const pbsByKey = {};

  for (const record of rows) {
    // Mode is already a string in the database (kz_timer, kz_simple, kz_vanilla)
    const modeStr = record.mode;

    const key = `${record.map_name}:${modeStr}`;

    if (!pbsByKey[key]) {
      pbsByKey[key] = {
        mapId: record.map_id,
        mapName: record.map_name,
        mapDifficulty: record.map_difficulty,
        mapValidated: record.map_validated,
        mode: modeStr,
        pro: null,
        tp: null,
      };
    }

    if (record.teleports === 0) {
      // Pro record
      if (!pbsByKey[key].pro || record.time < pbsByKey[key].pro.time) {
        pbsByKey[key].pro = {
          time: record.time,
          teleports: 0,
          points: record.points,
          recordId: record.record_id,
          createdOn: record.created_on,
        };
      }
    } else {
      // TP record
      if (!pbsByKey[key].tp || record.time < pbsByKey[key].tp.time) {
        pbsByKey[key].tp = {
          time: record.time,
          teleports: record.teleports,
          points: record.points,
          recordId: record.record_id,
          createdOn: record.created_on,
        };
      }
    }
  }

  return pbsByKey;
}

// ================== API VERIFY FUNCTIONS ==================

/**
 * Fetch WR from KZTimer API for verification with proxy and retry support
 */
async function fetchWRFromAPI(mapName, mode, hasTeleports, attempt = 1) {
  try {
    const params = {
      map_name: mapName,
      modes_list_string: mode,
      stage: 0,
      tickrate: 128,
      limit: 1,
    };

    if (hasTeleports === false) {
      params.has_teleports = false;
    }

    const axiosConfig = getAxiosConfigWithProxy(10000);
    axiosConfig.params = params;
    axiosConfig.validateStatus = (status) =>
      status === 200 || status === 404 || status === 429;

    const response = await axios.get(
      `${GOKZ_API_URL}/records/top`,
      axiosConfig,
    );

    // Handle rate limiting
    if (response.status === 429) {
      rateLimitCount++;
      console.warn(
        `  Rate limited (429), waiting ${PROXY_CONFIG.rateLimitDelay / 1000}s... (total: ${rateLimitCount})`,
      );
      await new Promise((resolve) =>
        setTimeout(resolve, PROXY_CONFIG.rateLimitDelay),
      );

      if (attempt < PROXY_CONFIG.retryAttempts) {
        return fetchWRFromAPI(mapName, mode, hasTeleports, attempt + 1);
      }
      return null;
    }

    // Small delay between requests (reduced if using proxies)
    const delay = proxyAgents.length > 0 ? 50 : 100;
    await new Promise((resolve) => setTimeout(resolve, delay));

    if (
      response.status === 404 ||
      !response.data ||
      response.data.length === 0
    ) {
      return null;
    }

    const wr = response.data[0];
    return {
      time: wr.time,
      steamid64: wr.steamid64,
      playerName: wr.player_name,
      recordId: wr.id,
      teleports: wr.teleports,
    };
  } catch (error) {
    // Retry on network errors
    if (attempt < PROXY_CONFIG.retryAttempts) {
      const delay = PROXY_CONFIG.retryDelay * Math.pow(2, attempt - 1);
      console.warn(
        `  Retry ${attempt}/${PROXY_CONFIG.retryAttempts} for ${mapName} (${mode}) after ${delay}ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
      return fetchWRFromAPI(mapName, mode, hasTeleports, attempt + 1);
    }
    console.error(
      `  Error fetching WR for ${mapName} (${mode}): ${error.message}`,
    );
    return null;
  }
}

/**
 * Fetch player PBs from KZTimer API for verification with proxy and retry support
 */
async function fetchPlayerPBsFromAPI(steamid64, attempt = 1) {
  try {
    const axiosConfig = getAxiosConfigWithProxy(30000);
    axiosConfig.params = {
      steamid64,
      stage: 0,
      tickrate: 128,
      limit: 9999,
    };
    axiosConfig.validateStatus = (status) =>
      status === 200 || status === 404 || status === 429;

    const response = await axios.get(
      `${GOKZ_API_URL}/records/top`,
      axiosConfig,
    );

    // Handle rate limiting
    if (response.status === 429) {
      rateLimitCount++;
      console.warn(
        `  Rate limited (429), waiting ${PROXY_CONFIG.rateLimitDelay / 1000}s... (total: ${rateLimitCount})`,
      );
      await new Promise((resolve) =>
        setTimeout(resolve, PROXY_CONFIG.rateLimitDelay),
      );

      if (attempt < PROXY_CONFIG.retryAttempts) {
        return fetchPlayerPBsFromAPI(steamid64, attempt + 1);
      }
      return [];
    }

    // Small delay between requests
    const delay = proxyAgents.length > 0 ? 50 : 100;
    await new Promise((resolve) => setTimeout(resolve, delay));

    if (response.status === 404 || !response.data) {
      return [];
    }

    return response.data;
  } catch (error) {
    // Retry on network errors
    if (attempt < PROXY_CONFIG.retryAttempts) {
      const delay = PROXY_CONFIG.retryDelay * Math.pow(2, attempt - 1);
      console.warn(
        `  Retry ${attempt}/${PROXY_CONFIG.retryAttempts} for player ${steamid64} after ${delay}ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
      return fetchPlayerPBsFromAPI(steamid64, attempt + 1);
    }
    console.error(`  Error fetching PBs for ${steamid64}: ${error.message}`);
    return [];
  }
}

// ================== UPDATE FUNCTIONS ==================

/**
 * Update WRs for a single map using local DB or API verification
 */
async function updateMapWRs(pool, mapId, mapName, options) {
  const wrsByType = {};

  for (const wrType of WR_TYPES) {
    let wr;

    if (options.verify) {
      // Use API for verification
      wr = await fetchWRFromAPI(mapName, wrType.mode, wrType.hasTeleports);
    } else {
      // Use local database
      wr = await getWRFromLocalDB(
        pool,
        mapId,
        wrType.mode,
        wrType.hasTeleports,
      );
    }

    wrsByType[wrType.columnPrefix] = wr;
  }

  // Build update query
  const setClauses = [];
  const values = [];

  for (const wrType of WR_TYPES) {
    const wr = wrsByType[wrType.columnPrefix];
    const prefix = wrType.columnPrefix;

    setClauses.push(`${prefix}_time = ?`);
    setClauses.push(`${prefix}_steamid64 = ?`);
    setClauses.push(`${prefix}_player_name = ?`);
    setClauses.push(`${prefix}_record_id = ?`);

    if (wr) {
      values.push(wr.time, wr.steamid64, wr.playerName, wr.recordId);
    } else {
      values.push(null, null, null, null);
    }

    if (wrType.hasTeleports === null) {
      setClauses.push(`${prefix}_teleports = ?`);
      values.push(wr ? wr.teleports : null);
    }
  }

  setClauses.push("world_records_synced_at = NOW()");
  values.push(mapId);

  await pool.query(
    `UPDATE kz_map_statistics SET ${setClauses.join(", ")} WHERE map_id = ?`,
    values,
  );

  const wrCount = Object.values(wrsByType).filter((w) => w !== null).length;
  return wrCount;
}

/**
 * Update PBs for a single player using local DB or API verification
 */
async function updatePlayerPBs(pool, playerId, steamid64, options) {
  let pbsByKey;

  if (options.verify) {
    // Use API for verification
    const pbs = await fetchPlayerPBsFromAPI(steamid64);

    if (pbs.length === 0) {
      return 0;
    }

    // Group PBs by map/mode
    pbsByKey = {};
    for (const pb of pbs) {
      const key = `${pb.map_name}:${pb.mode}`;
      if (!pbsByKey[key]) {
        pbsByKey[key] = {
          mapName: pb.map_name,
          mode: pb.mode,
          pro: null,
          tp: null,
        };
      }
      if (pb.teleports === 0) {
        if (!pbsByKey[key].pro || pb.time < pbsByKey[key].pro.time) {
          pbsByKey[key].pro = {
            time: pb.time,
            teleports: 0,
            points: pb.points,
            recordId: pb.id,
            createdOn: pb.created_on,
          };
        }
      } else {
        if (!pbsByKey[key].tp || pb.time < pbsByKey[key].tp.time) {
          pbsByKey[key].tp = {
            time: pb.time,
            teleports: pb.teleports,
            points: pb.points,
            recordId: pb.id,
            createdOn: pb.created_on,
          };
        }
      }
    }

    // Get map IDs for API results
    const mapNames = [...new Set(pbs.map((pb) => pb.map_name))];
    if (mapNames.length > 0) {
      const [maps] = await pool.query(
        `SELECT id, map_name, difficulty, validated FROM kz_maps WHERE map_name IN (?)`,
        [mapNames],
      );
      const mapLookup = {};
      for (const m of maps) {
        mapLookup[m.map_name] = m;
      }

      // Add map info to pbsByKey
      for (const key of Object.keys(pbsByKey)) {
        const mapName = pbsByKey[key].mapName;
        const map = mapLookup[mapName];
        if (map) {
          pbsByKey[key].mapId = map.id;
          pbsByKey[key].mapDifficulty = map.difficulty;
          pbsByKey[key].mapValidated = map.validated;
        }
      }
    }
  } else {
    // Use local database
    pbsByKey = await getPBsFromLocalDB(pool, playerId);
  }

  const pbValues = Object.values(pbsByKey).filter((pb) => pb.mapId);
  if (pbValues.length === 0) {
    return 0;
  }

  // Build bulk insert - much faster than individual inserts
  const values = [];
  const placeholders = [];

  for (const pbData of pbValues) {
    const pro = pbData.pro;
    const tp = pbData.tp;

    placeholders.push("(?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    values.push(
      playerId,
      steamid64,
      pbData.mapId,
      pbData.mapName,
      pbData.mode,
      pro?.time || null,
      pro ? 0 : 0,
      pro?.points ?? 0,
      pro?.recordId || null,
      pro?.createdOn || null,
      tp?.time || null,
      tp?.teleports ?? 0,
      tp?.points ?? 0,
      tp?.recordId || null,
      tp?.createdOn || null,
      pbData.mapDifficulty,
      pbData.mapValidated,
    );
  }

  // Single bulk upsert query
  await pool.query(
    `INSERT INTO kz_player_map_pbs 
     (player_id, steamid64, map_id, map_name, mode, stage,
      pro_time, pro_teleports, pro_points, pro_record_id, pro_created_on,
      tp_time, tp_teleports, tp_points, tp_record_id, tp_created_on,
      map_difficulty, map_validated)
     VALUES ${placeholders.join(", ")}
     ON DUPLICATE KEY UPDATE
       pro_time = COALESCE(VALUES(pro_time), pro_time),
       pro_teleports = COALESCE(VALUES(pro_teleports), pro_teleports),
       pro_points = COALESCE(VALUES(pro_points), pro_points),
       pro_record_id = COALESCE(VALUES(pro_record_id), pro_record_id),
       pro_created_on = COALESCE(VALUES(pro_created_on), pro_created_on),
       tp_time = COALESCE(VALUES(tp_time), tp_time),
       tp_teleports = COALESCE(VALUES(tp_teleports), tp_teleports),
       tp_points = COALESCE(VALUES(tp_points), tp_points),
       tp_record_id = COALESCE(VALUES(tp_record_id), tp_record_id),
       tp_created_on = COALESCE(VALUES(tp_created_on), tp_created_on),
       updated_at = NOW()`,
    values,
  );

  // Mark player as synced (ignore if column doesn't exist)
  try {
    await pool.query(
      `UPDATE kz_players SET pbs_synced_at = NOW() WHERE id = ?`,
      [playerId],
    );
  } catch (err) {
    // Column might not exist yet, ignore
  }

  return pbValues.length;
}

// ================== POPULATION FUNCTIONS ==================

/**
 * Populate WRs for all maps
 */
async function populateWorldRecords(pool, options) {
  const source = options.verify ? "KZT API" : "local DB";
  console.log(`\n=== Populating World Records from ${source} ===\n`);

  if (options.map) {
    // Single map refresh
    const [maps] = await pool.query(
      "SELECT id, map_name FROM kz_maps WHERE map_name = ?",
      [options.map],
    );

    if (maps.length === 0) {
      console.log(`Map "${options.map}" not found in database`);
      return;
    }

    console.log(`Refreshing WRs for ${options.map}...`);
    const wrCount = await updateMapWRs(
      pool,
      maps[0].id,
      maps[0].map_name,
      options,
    );
    console.log(`  Found ${wrCount}/6 WR types`);
    return;
  }

  // Bulk population
  let totalMaps = 0;
  let totalWRs = 0;
  let hasMore = true;
  let lastMapName = "";

  // Build query based on force option
  let whereClause = "WHERE m.validated = TRUE";
  if (!options.force) {
    whereClause += " AND ms.world_records_synced_at IS NULL";
  }

  while (hasMore) {
    // Use cursor-based pagination with map_name for --force mode
    let cursorClause = "";
    if (options.force && lastMapName) {
      cursorClause = `AND m.map_name > '${lastMapName.replace(/'/g, "''")}'`;
    }

    const [maps] = await pool.query(
      `SELECT m.id, m.map_name
       FROM kz_maps m
       LEFT JOIN kz_map_statistics ms ON m.id = ms.map_id
       ${whereClause} ${cursorClause}
       ORDER BY m.map_name ASC
       LIMIT ?`,
      [options.batchSize],
    );

    if (maps.length === 0) {
      hasMore = false;
      break;
    }

    console.log(`Processing batch of ${maps.length} maps...`);

    for (const map of maps) {
      process.stdout.write(`  ${map.map_name}... `);
      const wrCount = await updateMapWRs(pool, map.id, map.map_name, options);
      console.log(`${wrCount}/6 WRs`);
      totalMaps++;
      totalWRs += wrCount;
      lastMapName = map.map_name;
    }

    if (maps.length < options.batchSize) {
      hasMore = false;
    }
  }

  console.log(
    `\nWR Population complete: ${totalMaps} maps, ${totalWRs} total WRs`,
  );
}

/**
 * Populate PBs for all players
 */
async function populatePlayerPBs(pool, options) {
  const source = options.verify ? "KZT API" : "local DB";
  console.log(`\n=== Populating Player PBs from ${source} ===\n`);

  if (options.player) {
    // Single player refresh
    const [players] = await pool.query(
      "SELECT id, steamid64, player_name FROM kz_players WHERE steamid64 = ?",
      [options.player],
    );

    if (players.length === 0) {
      console.log(`Player "${options.player}" not found in database`);
      return;
    }

    console.log(
      `Refreshing PBs for ${players[0].player_name} (${options.player})...`,
    );
    const pbCount = await updatePlayerPBs(
      pool,
      players[0].id,
      players[0].steamid64,
      options,
    );
    console.log(`  Cached ${pbCount} map PBs`);
    return;
  }

  // Bulk population - find players with records but no PB cache
  // Exclude banned players
  let totalPlayers = 0;
  let totalPBs = 0;
  let hasMore = true;
  let lastPlayerId = 0;
  const concurrency = options.concurrency || 10; // Process 10 players in parallel

  // Build where clause based on force option
  let existsClause = "";
  if (!options.force) {
    existsClause = `AND NOT EXISTS (
      SELECT 1 FROM kz_player_map_pbs pb WHERE pb.player_id = p.id
    )`;
  }

  while (hasMore) {
    const [players] = await pool.query(
      `SELECT DISTINCT p.id, p.steamid64, p.player_name
       FROM kz_players p
       INNER JOIN kz_records_partitioned r ON p.id = r.player_id
       WHERE (p.is_banned IS NULL OR p.is_banned = FALSE)
         AND p.id > ?
         ${existsClause}
       ORDER BY p.id
       LIMIT ?`,
      [lastPlayerId, options.batchSize],
    );

    if (players.length === 0) {
      hasMore = false;
      break;
    }

    console.log(
      `Processing batch of ${players.length} players (${concurrency} parallel)...`,
    );

    // Process in parallel chunks
    for (let i = 0; i < players.length; i += concurrency) {
      const chunk = players.slice(i, i + concurrency);

      const results = await Promise.all(
        chunk.map(async (player) => {
          try {
            const pbCount = await updatePlayerPBs(
              pool,
              player.id,
              player.steamid64,
              options,
            );
            return { player, pbCount, error: null };
          } catch (err) {
            return { player, pbCount: 0, error: err.message };
          }
        }),
      );

      for (const result of results) {
        if (result.error) {
          console.log(
            `  ${result.player.player_name}... ERROR: ${result.error}`,
          );
        } else {
          console.log(
            `  ${result.player.player_name}... ${result.pbCount} PBs`,
          );
        }
        totalPlayers++;
        totalPBs += result.pbCount;
        lastPlayerId = result.player.id;
      }
    }

    if (players.length < options.batchSize) {
      hasMore = false;
    }
  }

  console.log(
    `\nPB Population complete: ${totalPlayers} players, ${totalPBs} total PB entries`,
  );
}

// ================== MAIN ==================

async function main() {
  const options = parseArgs();

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  console.log("=== PB & WR Population Script ===");
  console.log(
    `Source: ${options.verify ? "KZT API (verification mode)" : "Local Database"}`,
  );
  console.log(`Batch size: ${options.batchSize}`);
  console.log(`Force refresh: ${options.force}`);

  // Setup proxies if in verify mode
  if (options.verify) {
    setupProxies();
  }

  try {
    // Initialize database
    console.log("\nConnecting to database...");
    await initKzDatabase();
    const pool = getKzPool();

    if (!pool) {
      console.error("Failed to connect to KZ database");
      process.exit(1);
    }

    console.log("Connected!");

    // Check if required tables exist
    const [tables] = await pool.query(
      `SELECT table_name FROM information_schema.tables 
       WHERE table_schema = DATABASE() 
       AND table_name IN ('kz_map_statistics', 'kz_player_map_pbs')`,
    );
    const tableNames = tables.map((t) => t.TABLE_NAME || t.table_name);

    if (!options.pbsOnly) {
      if (!tableNames.includes("kz_map_statistics")) {
        console.error(
          "Table kz_map_statistics not found. Run schema migrations first.",
        );
      } else {
        await populateWorldRecords(pool, options);
      }
    }

    if (!options.wrsOnly) {
      if (!tableNames.includes("kz_player_map_pbs")) {
        console.error(
          "Table kz_player_map_pbs not found. Run schema migrations first.",
        );
      } else {
        await populatePlayerPBs(pool, options);
      }
    }

    console.log("\n=== Done! ===");
  } catch (error) {
    console.error(`\nError: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await closeKzDatabase();
  }
}

main();
