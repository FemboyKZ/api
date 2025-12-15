#!/usr/bin/env node

/**
 * Script to batch import player PBs from KZTimer Global API
 * Fetches top 1000 records per map/mode/stage combination
 *
 * Usage:
 *   node scripts/import-map-pbs.js [options]
 *
 * Options:
 *   --map <name>      Import PBs for a specific map only
 *   --mode <mode>     Import PBs for a specific mode only (kz_timer, kz_simple, kz_vanilla)
 *   --batch <size>    Batch size for DB inserts (default: 500)
 *   --delay <ms>      Delay between API requests in ms (default: 100)
 *   --limit <n>       Number of records per API request (default: 1000, max: 1000)
 *   --offset <n>      Offset for API requests (default: 0, use to get records beyond 1000)
 *   --dry-run         Show what would be done without making changes
 *   --help            Show this help message
 *
 * Environment:
 *   KZ_SCRAPER_PROXIES  Comma-separated list of proxy URLs
 *                       Format: http://user:pass@host:port or http://host:port
 *
 * Examples:
 *   node scripts/import-map-pbs.js                    # Full import all maps
 *   node scripts/import-map-pbs.js --map kz_beginnerblock_go  # Single map
 *   node scripts/import-map-pbs.js --mode kz_timer    # Only kz_timer mode
 *   KZ_SCRAPER_PROXIES=http://proxy:8080 node scripts/import-map-pbs.js
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
let totalApiCalls = 0;
let totalRecordsFetched = 0;

// Mode configurations
const MODES = [
  { mode: "kz_timer", modeId: 200 },
  { mode: "kz_simple", modeId: 201 },
  { mode: "kz_vanilla", modeId: 202 },
];

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
 * Force rotate to next proxy (used on timeouts/errors)
 */
function forceRotateProxy() {
  if (proxyAgents.length > 1) {
    currentProxyIndex = (currentProxyIndex + 1) % proxyAgents.length;
    const agent = proxyAgents[currentProxyIndex];
    const displayUrl = agent.proxyUrl.replace(/:([^@:]+)@/, ":****@");
    console.warn(`  Rotating to proxy ${currentProxyIndex + 1}: ${displayUrl}`);
  }
}

/**
 * Get axios config with proxy agent if available
 */
function getAxiosConfigWithProxy(timeout = 30000) {
  const config = { timeout };

  if (proxyAgents.length > 0) {
    const agent = proxyAgents[currentProxyIndex];
    if (GOKZ_API_URL.startsWith("https")) {
      config.httpsAgent = agent.httpsAgent;
    } else {
      config.httpAgent = agent.httpAgent;
    }
    // Round-robin to next proxy on each request
    currentProxyIndex = (currentProxyIndex + 1) % proxyAgents.length;
  }

  return config;
}

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    map: null,
    mode: null,
    batchSize: 500,
    delay: 100,
    limit: 1000,
    offset: 0,
    skip: 0,
    iterations: 1,
    dryRun: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--map":
        options.map = args[++i];
        break;
      case "--mode":
        options.mode = args[++i];
        break;
      case "--batch":
        options.batchSize = parseInt(args[++i], 10) || 500;
        break;
      case "--delay":
        options.delay = parseInt(args[++i], 10) || 100;
        break;
      case "--limit":
        options.limit = Math.min(parseInt(args[++i], 10) || 1000, 1000);
        break;
      case "--offset":
        options.offset = parseInt(args[++i], 10) || 0;
        break;
      case "--skip":
        options.skip = parseInt(args[++i], 10) || 0;
        break;
      case "--iterations":
        options.iterations = Math.max(1, parseInt(args[++i], 10) || 1);
        break;
      case "--dry-run":
        options.dryRun = true;
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
Script to batch import player PBs from KZTimer Global API
Fetches top records per map/mode and imports them as player PBs

Usage:
  node scripts/import-map-pbs.js [options]

Options:
  --map <name>      Import PBs for a specific map only
  --mode <mode>     Import PBs for a specific mode only (kz_timer, kz_simple, kz_vanilla)
  --batch <size>    Batch size for DB inserts (default: 500)
  --delay <ms>      Delay between API requests in ms (default: 100)
  --limit <n>       Number of records per API request (default: 1000, max: 1000)
  --offset <n>      Offset for API requests (default: 0, use to get records beyond 1000)
  --skip <n>        Skip the first N maps (default: 0, use to resume after restart)
  --iterations <n>  Run through all maps N times, incrementing offset by 1000 each iteration
  --dry-run         Show what would be done without making changes
  --help            Show this help message

Environment:
  KZ_SCRAPER_PROXIES  Comma-separated proxy URLs (avoids rate limits)
                      Format: http://user:pass@host:port or http://host:port

Examples:
  node scripts/import-map-pbs.js                       # Full import all maps
  node scripts/import-map-pbs.js --map kz_beginnerblock_go  # Single map
  node scripts/import-map-pbs.js --mode kz_timer       # Only kz_timer mode
  node scripts/import-map-pbs.js --dry-run             # Preview without changes

Proxy usage:
  KZ_SCRAPER_PROXIES=http://proxy1:8080,http://proxy2:8080 node scripts/import-map-pbs.js
`);
}

/**
 * Fetch map top records from KZTimer API with proxy and retry support
 */
async function fetchMapTopRecords(
  mapName,
  mode,
  hasTeleports,
  stage,
  limit,
  offset,
  delay,
  attempt = 1,
) {
  try {
    const params = {
      map_name: mapName,
      modes_list_string: mode,
      stage: stage,
      tickrate: 128,
      limit: limit,
      offset: offset,
    };

    // hasTeleports: true = overall (any), false = pro only
    if (hasTeleports === false) {
      params.has_teleports = false;
    }

    const axiosConfig = getAxiosConfigWithProxy(30000);
    axiosConfig.params = params;
    axiosConfig.validateStatus = (status) =>
      status === 200 || status === 404 || status === 429;

    const response = await axios.get(
      `${GOKZ_API_URL}/records/top`,
      axiosConfig,
    );
    totalApiCalls++;

    // Handle rate limiting
    if (response.status === 429) {
      rateLimitCount++;
      forceRotateProxy(); // Switch proxy on rate limit
      console.warn(
        `  Rate limited (429), waiting ${PROXY_CONFIG.rateLimitDelay / 1000}s... (total: ${rateLimitCount})`,
      );
      await new Promise((resolve) =>
        setTimeout(resolve, PROXY_CONFIG.rateLimitDelay),
      );

      if (attempt < PROXY_CONFIG.retryAttempts) {
        return fetchMapTopRecords(
          mapName,
          mode,
          hasTeleports,
          stage,
          limit,
          offset,
          delay,
          attempt + 1,
        );
      }
      return [];
    }

    // Small delay between requests (reduced if using proxies)
    const actualDelay = proxyAgents.length > 0 ? Math.min(delay, 50) : delay;
    await new Promise((resolve) => setTimeout(resolve, actualDelay));

    if (
      response.status === 404 ||
      !response.data ||
      response.data.length === 0
    ) {
      return [];
    }

    return response.data;
  } catch (error) {
    // Check if it's a timeout or network error - rotate proxy
    const isTimeout = error.code === "ECONNABORTED" || error.message?.includes("timeout");
    const isNetworkError = error.code === "ECONNREFUSED" || error.code === "ECONNRESET" || 
                           error.code === "ETIMEDOUT" || error.code === "ENETUNREACH";
    
    if (isTimeout || isNetworkError) {
      forceRotateProxy();
    }

    // Retry on network errors
    if (attempt < PROXY_CONFIG.retryAttempts) {
      const retryDelay = PROXY_CONFIG.retryDelay * Math.pow(2, attempt - 1);
      console.warn(
        `  Retry ${attempt}/${PROXY_CONFIG.retryAttempts} for ${mapName} (${mode}) after ${retryDelay}ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
      return fetchMapTopRecords(
        mapName,
        mode,
        hasTeleports,
        stage,
        limit,
        offset,
        delay,
        attempt + 1,
      );
    }
    console.error(
      `  Error fetching top for ${mapName} (${mode}): ${error.message}`,
    );
    return [];
  }
}

/**
 * Get all maps from database or filter by name
 */
async function getMaps(pool, mapName = null) {
  let query = `
    SELECT id, map_name, difficulty, validated 
    FROM kz_maps 
    WHERE 1=1
  `;
  const params = [];

  if (mapName) {
    query += " AND map_name = ?";
    params.push(mapName);
  }

  query += " ORDER BY map_name ASC";

  const [rows] = await pool.query(query, params);
  return rows;
}

/**
 * Get or create player ID from steamid64
 * Returns player_id for the given steamid64
 */
async function getOrCreatePlayer(pool, steamid64, playerName) {
  // Try to get existing player
  const [existing] = await pool.query(
    "SELECT id FROM kz_players WHERE steamid64 = ?",
    [steamid64],
  );

  if (existing.length > 0) {
    return existing[0].id;
  }

  // Create new player
  // Convert steamid64 to steam_id format
  const steamId = steamid64ToSteamId(steamid64);

  const [result] = await pool.query(
    `INSERT INTO kz_players (steamid64, steam_id, player_name) 
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
    [steamid64, steamId, playerName || "Unknown"],
  );

  return result.insertId;
}

/**
 * Convert SteamID64 to legacy SteamID format
 */
function steamid64ToSteamId(steamid64) {
  const id64 = BigInt(steamid64);
  const universe = 1n;
  const accountId = id64 - 76561197960265728n;
  const y = accountId % 2n;
  const z = accountId / 2n;
  return `STEAM_${universe}:${y}:${z}`;
}

/**
 * Batch upsert PBs into kz_player_map_pbs table
 * Keeps the faster time if duplicate exists
 */
async function batchUpsertPBs(pool, pbsData, options) {
  if (pbsData.length === 0) return { inserted: 0, updated: 0 };

  let totalInserted = 0;
  let totalUpdated = 0;

  // Process in batches
  for (let i = 0; i < pbsData.length; i += options.batchSize) {
    const batch = pbsData.slice(i, i + options.batchSize);

    if (options.dryRun) {
      console.log(`    [DRY RUN] Would upsert ${batch.length} PBs`);
      continue;
    }

    // Build batch insert query
    const values = [];
    const placeholders = [];

    for (const pb of batch) {
      placeholders.push("(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      values.push(
        pb.playerId,
        pb.steamid64,
        pb.mapId,
        pb.mapName,
        pb.mode,
        pb.stage,
        pb.proTime,
        pb.proTeleports,
        pb.proPoints,
        pb.proRecordId,
        pb.proCreatedOn,
        pb.tpTime,
        pb.tpTeleports,
        pb.tpPoints,
        pb.tpRecordId,
        pb.tpCreatedOn,
        pb.mapDifficulty,
      );
    }

    const query = `
      INSERT INTO kz_player_map_pbs (
        player_id, steamid64, map_id, map_name, mode, stage,
        pro_time, pro_teleports, pro_points, pro_record_id, pro_created_on,
        tp_time, tp_teleports, tp_points, tp_record_id, tp_created_on,
        map_difficulty
      ) VALUES ${placeholders.join(", ")}
      ON DUPLICATE KEY UPDATE
        pro_time = IF(
          VALUES(pro_time) IS NOT NULL AND (pro_time IS NULL OR VALUES(pro_time) < pro_time),
          VALUES(pro_time), pro_time
        ),
        pro_teleports = IF(
          VALUES(pro_time) IS NOT NULL AND (pro_time IS NULL OR VALUES(pro_time) < pro_time),
          VALUES(pro_teleports), pro_teleports
        ),
        pro_points = IF(
          VALUES(pro_time) IS NOT NULL AND (pro_time IS NULL OR VALUES(pro_time) < pro_time),
          VALUES(pro_points), pro_points
        ),
        pro_record_id = IF(
          VALUES(pro_time) IS NOT NULL AND (pro_time IS NULL OR VALUES(pro_time) < pro_time),
          VALUES(pro_record_id), pro_record_id
        ),
        pro_created_on = IF(
          VALUES(pro_time) IS NOT NULL AND (pro_time IS NULL OR VALUES(pro_time) < pro_time),
          VALUES(pro_created_on), pro_created_on
        ),
        tp_time = IF(
          VALUES(tp_time) IS NOT NULL AND (tp_time IS NULL OR VALUES(tp_time) < tp_time),
          VALUES(tp_time), tp_time
        ),
        tp_teleports = IF(
          VALUES(tp_time) IS NOT NULL AND (tp_time IS NULL OR VALUES(tp_time) < tp_time),
          VALUES(tp_teleports), tp_teleports
        ),
        tp_points = IF(
          VALUES(tp_time) IS NOT NULL AND (tp_time IS NULL OR VALUES(tp_time) < tp_time),
          VALUES(tp_points), tp_points
        ),
        tp_record_id = IF(
          VALUES(tp_time) IS NOT NULL AND (tp_time IS NULL OR VALUES(tp_time) < tp_time),
          VALUES(tp_record_id), tp_record_id
        ),
        tp_created_on = IF(
          VALUES(tp_time) IS NOT NULL AND (tp_time IS NULL OR VALUES(tp_time) < tp_time),
          VALUES(tp_created_on), tp_created_on
        ),
        updated_at = CURRENT_TIMESTAMP
    `;

    try {
      const [result] = await pool.query(query, values);
      // affectedRows: inserted rows + updated rows (each updated counts as 2)
      const inserted = result.affectedRows - result.changedRows;
      const updated = result.changedRows;
      totalInserted += inserted;
      totalUpdated += updated;
    } catch (error) {
      console.error(`    Error upserting batch: ${error.message}`);
    }
  }

  return { inserted: totalInserted, updated: totalUpdated };
}

/**
 * Process records from API into PB format grouped by player/map/mode/stage
 */
function processRecordsIntoPBs(records, mapId, mapName, mapDifficulty, mode) {
  // Group records by player + stage, keeping best pro and best overall
  const pbsByPlayer = new Map(); // key: `${steamid64}-${stage}`

  for (const record of records) {
    if (!record.steamid64 || !record.steamid64.startsWith("7656119")) {
      continue; // Skip invalid/bot players
    }

    const key = `${record.steamid64}-${record.stage}`;

    if (!pbsByPlayer.has(key)) {
      pbsByPlayer.set(key, {
        steamid64: record.steamid64,
        playerName: record.player_name,
        mapId,
        mapName,
        mapDifficulty,
        mode,
        stage: record.stage,
        proTime: null,
        proTeleports: 0,
        proPoints: 0,
        proRecordId: null,
        proCreatedOn: null,
        tpTime: null,
        tpTeleports: 0,
        tpPoints: 0,
        tpRecordId: null,
        tpCreatedOn: null,
      });
    }

    const pb = pbsByPlayer.get(key);

    if (record.teleports === 0) {
      // Pro run - keep fastest
      if (pb.proTime === null || record.time < pb.proTime) {
        pb.proTime = record.time;
        pb.proTeleports = 0;
        pb.proPoints = record.points;
        pb.proRecordId = record.id;
        pb.proCreatedOn = record.created_on;
      }
    } else {
      // TP run - keep fastest
      if (pb.tpTime === null || record.time < pb.tpTime) {
        pb.tpTime = record.time;
        pb.tpTeleports = record.teleports;
        pb.tpPoints = record.points;
        pb.tpRecordId = record.id;
        pb.tpCreatedOn = record.created_on;
      }
    }
  }

  return Array.from(pbsByPlayer.values());
}

/**
 * Import PBs for a single map across all modes
 */
async function importMapPBs(pool, map, modes, options) {
  const allPBs = [];
  const playerCache = new Map(); // steamid64 -> player_id

  for (const modeConfig of modes) {
    const { mode } = modeConfig;

    // Fetch pro records (has_teleports = false)
    console.log(
      `    Fetching ${mode} pro records (offset: ${options.offset})...`,
    );
    const proRecords = await fetchMapTopRecords(
      map.map_name,
      mode,
      false,
      0,
      options.limit,
      options.offset,
      options.delay,
    );
    totalRecordsFetched += proRecords.length;

    // Fetch overall records (has_teleports = null/any)
    console.log(
      `    Fetching ${mode} overall records (offset: ${options.offset})...`,
    );
    const overallRecords = await fetchMapTopRecords(
      map.map_name,
      mode,
      null,
      0,
      options.limit,
      options.offset,
      options.delay,
    );
    totalRecordsFetched += overallRecords.length;

    // Combine records
    const allRecords = [...proRecords, ...overallRecords];

    if (allRecords.length === 0) {
      console.log(`    No records found for ${mode}`);
      continue;
    }

    console.log(
      `    Found ${proRecords.length} pro + ${overallRecords.length} overall records`,
    );

    // Process into PBs format
    const pbs = processRecordsIntoPBs(
      allRecords,
      map.id,
      map.map_name,
      map.difficulty,
      mode,
    );

    // Resolve player IDs
    for (const pb of pbs) {
      if (!playerCache.has(pb.steamid64)) {
        const playerId = await getOrCreatePlayer(
          pool,
          pb.steamid64,
          pb.playerName,
        );
        playerCache.set(pb.steamid64, playerId);
      }
      pb.playerId = playerCache.get(pb.steamid64);
    }

    allPBs.push(...pbs);
  }

  // Batch upsert all PBs for this map
  if (allPBs.length > 0) {
    const result = await batchUpsertPBs(pool, allPBs, options);
    console.log(
      `    Upserted ${allPBs.length} PBs (${result.inserted} new, ${result.updated} updated)`,
    );
  }

  return {
    pbCount: allPBs.length,
    playerCount: playerCache.size,
  };
}

/**
 * Main import function
 */
async function main() {
  const options = parseArgs();

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  console.log("=================================================");
  console.log("  KZTimer Global API -> Player PBs Importer");
  console.log("=================================================");
  console.log("");

  if (options.dryRun) {
    console.log("*** DRY RUN MODE - No changes will be made ***");
    console.log("");
  }

  console.log("Configuration:");
  console.log(`  Map filter: ${options.map || "all"}`);
  console.log(`  Mode filter: ${options.mode || "all"}`);
  console.log(`  Batch size: ${options.batchSize}`);
  console.log(`  Request delay: ${options.delay}ms`);
  console.log(`  Records limit: ${options.limit}`);
  console.log(`  Records offset: ${options.offset}`);
  console.log("");

  // Setup proxies if configured
  setupProxies();
  console.log("");

  // Initialize database
  console.log("Connecting to database...");
  await initKzDatabase();
  const pool = getKzPool();
  console.log("Connected!");
  console.log("");

  const startTime = Date.now();

  try {
    // Get maps to process
    const maps = await getMaps(pool, options.map);
    console.log(`Found ${maps.length} maps to process`);
    if (options.skip > 0) {
      console.log(`Skipping first ${options.skip} maps (starting at map #${options.skip + 1})`);
    }
    console.log("");

    // Filter modes if specified
    let modes = MODES;
    if (options.mode) {
      modes = MODES.filter((m) => m.mode === options.mode);
      if (modes.length === 0) {
        console.error(`Invalid mode: ${options.mode}`);
        console.log("Valid modes: kz_timer, kz_simple, kz_vanilla");
        process.exit(1);
      }
    }

    let totalPBs = 0;
    let totalPlayers = 0;
    let processedMaps = 0;
    let skippedMaps = 0;
    const baseOffset = options.offset;

    // Iteration loop - run through all maps multiple times with increasing offset
    for (let iteration = 0; iteration < options.iterations; iteration++) {
      const currentOffset = baseOffset + (iteration * 1000);
      const iterationOptions = { ...options, offset: currentOffset };
      
      if (options.iterations > 1) {
        console.log("");
        console.log(`=== Iteration ${iteration + 1}/${options.iterations} (offset: ${currentOffset}) ===`);
        console.log("");
      }

      let iterationMapCount = 0;
      for (const map of maps) {
        iterationMapCount++;
        processedMaps++;
        
        // Skip maps if --skip option is used (only on first iteration)
        if (iteration === 0 && options.skip > 0 && iterationMapCount <= options.skip) {
          skippedMaps++;
          continue;
        }
        
        const displayNum = options.iterations > 1 
          ? `${iteration + 1}.${iterationMapCount}` 
          : `${iterationMapCount}`;
        console.log(
          `[${displayNum}/${maps.length}] Processing ${map.map_name}...`,
        );

        const result = await importMapPBs(pool, map, modes, iterationOptions);
        totalPBs += result.pbCount;
        totalPlayers += result.playerCount;

        // Progress stats every 10 maps
        if (iterationMapCount % 10 === 0) {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log("");
          console.log(
            `  Progress: ${iterationMapCount}/${maps.length} maps (iter ${iteration + 1}), ${totalPBs} PBs, ${totalApiCalls} API calls, ${elapsed}s elapsed`,
          );
          console.log("");
        }
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log("");
    console.log("=================================================");
    console.log("  Import Complete!");
    console.log("=================================================");
    if (options.iterations > 1) {
      console.log(`  Iterations: ${options.iterations} (offsets: ${baseOffset} to ${baseOffset + (options.iterations - 1) * 1000})`);
    }
    console.log(`  Maps processed: ${processedMaps - skippedMaps} (skipped: ${skippedMaps})`);
    console.log(`  Total PBs: ${totalPBs}`);
    console.log(`  Unique players: ${totalPlayers}`);
    console.log(`  API calls: ${totalApiCalls}`);
    console.log(`  Records fetched: ${totalRecordsFetched}`);
    console.log(`  Rate limit hits: ${rateLimitCount}`);
    console.log(`  Time elapsed: ${elapsed}s`);
    console.log("");
  } catch (error) {
    console.error("Fatal error:", error);
    process.exit(1);
  } finally {
    await closeKzDatabase();
  }
}

// Run the script
main().catch((error) => {
  console.error("Unhandled error:", error);
  process.exit(1);
});
