/**
 * Server Metadata Scraper
 * 
 * Fetches and populates server metadata from the GlobalKZ API into the kz_servers table.
 * 
 * API Endpoint: GET https://kztimerglobal.com/api/v2/servers/{server_id}
 * 
 * Response format:
 * {
 *   "id": 1279,
 *   "api_key": "abc123...",
 *   "port": 27025,
 *   "ip": "37.27.107.76",
 *   "name": "FemboyKZ | EU | Whitelist | 128t VNL Global",
 *   "owner_steamid64": 76561198268569118,
 *   "created_on": "2023-01-15T10:30:00Z",
 *   "updated_on": "2024-11-08T15:45:00Z",
 *   "approval_status": 1,
 *   "approved_by_steamid64": 76561198123456789
 * }
 * 
 * Usage:
 *   node scripts/server-metadata-scraper.js [options]
 * 
 * Options:
 *   --batch-size N    Number of servers to process per batch (default: 10)
 *   --delay N         Delay between batches in milliseconds (default: 1000)
 *   --force           Update all servers even if metadata exists
 *   --server-id N     Process only specific server_id
 *   --dry-run         Show what would be done without making changes
 *   --help            Show this help message
 */

const mysql = require('mysql2/promise');
const axios = require('axios');
require('dotenv').config();

// Configuration
const CONFIG = {
  db: {
    host: process.env.KZ_DB_HOST || "localhost",
    port: parseInt(process.env.KZ_DB_PORT) || 3308,
    user: process.env.KZ_DB_USER || "root",
    password: process.env.KZ_DB_PASSWORD || "",
    database: process.env.KZ_DB_NAME || "kz_records",
    charset: 'utf8mb4',
  },
  gokzApi: process.env.GOKZ_API_URL || 'https://kztimerglobal.com/api/v2',
  batchSize: 10,
  delayBetweenBatches: 1000, // ms
  retryAttempts: 3,
  retryDelay: 2000, // ms
  forceUpdate: false,
  targetServerId: null,
  dryRun: false,
};

// Statistics
const stats = {
  serversProcessed: 0,
  serversUpdated: 0,
  serversSkipped: 0,
  serversNotFound: 0,
  errors: 0,
  startTime: null,
};

// Database connection
let connection = null;

// Graceful shutdown flag
let isShuttingDown = false;

/**
 * Logger utility
 */
function log(level, message) {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  console.log(`[${timestamp}] [${level.toUpperCase()}] ${message}`);
}

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    switch (arg) {
      case '--batch-size':
        CONFIG.batchSize = parseInt(args[++i], 10);
        break;
      case '--delay':
        CONFIG.delayBetweenBatches = parseInt(args[++i], 10);
        break;
      case '--force':
        CONFIG.forceUpdate = true;
        break;
      case '--server-id':
        CONFIG.targetServerId = parseInt(args[++i], 10);
        break;
      case '--dry-run':
        CONFIG.dryRun = true;
        break;
      case '--help':
        console.log(`
Server Metadata Scraper

Fetches server metadata from GlobalKZ API and populates kz_servers table.

Usage:
  node scripts/server-metadata-scraper.js [options]

Options:
  --batch-size N    Number of servers to process per batch (default: 10)
  --delay N         Delay between batches in milliseconds (default: 1000)
  --force           Update all servers even if metadata exists
  --server-id N     Process only specific server_id
  --dry-run         Show what would be done without making changes
  --help            Show this help message

Examples:
  # Update servers with missing metadata
  node scripts/server-metadata-scraper.js

  # Update all servers (force)
  node scripts/server-metadata-scraper.js --force

  # Process specific server
  node scripts/server-metadata-scraper.js --server-id 1279

  # Dry run to see what would be updated
  node scripts/server-metadata-scraper.js --dry-run

  # Custom batch size and delay
  node scripts/server-metadata-scraper.js --batch-size 20 --delay 2000
        `);
        process.exit(0);
        break;
    }
  }
}

/**
 * Validate environment variables
 */
function validateEnvironment() {
  const required = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    log('error', `Missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }
}

/**
 * Connect to database
 */
async function connectDatabase() {
  try {
    connection = await mysql.createConnection(CONFIG.db);
    log('info', `Connected to database: ${CONFIG.db.database}`);
    return connection;
  } catch (error) {
    log('error', `Failed to connect to database: ${error.message}`);
    throw error;
  }
}

/**
 * Get servers that need metadata updates
 */
async function getServersToProcess() {
  try {
    let query;
    let params = [];
    
    if (CONFIG.targetServerId) {
      // Process specific server
      query = 'SELECT id, server_id, server_name FROM kz_servers WHERE server_id = ?';
      params = [CONFIG.targetServerId];
    } else if (CONFIG.forceUpdate) {
      // Process all servers
      query = 'SELECT id, server_id, server_name FROM kz_servers ORDER BY server_id';
    } else {
      // Process only servers with missing metadata
      query = `
        SELECT id, server_id, server_name 
        FROM kz_servers 
        WHERE port IS NULL OR ip IS NULL OR owner_steamid64 IS NULL
        ORDER BY server_id
      `;
    }
    
    const [rows] = await connection.query(query, params);
    return rows;
  } catch (error) {
    log('error', `Failed to fetch servers: ${error.message}`);
    throw error;
  }
}

/**
 * Fetch server metadata from GlobalKZ API
 */
async function fetchServerMetadata(serverId, attempt = 1) {
  try {
    const url = `${CONFIG.gokzApi}/servers/${serverId}`;
    const response = await axios.get(url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'KZ-Records-Scraper/1.0',
      },
    });
    
    return response.data;
  } catch (error) {
    if (error.response) {
      // API returned an error response
      if (error.response.status === 404) {
        // Server not found in GlobalKZ
        return null;
      } else if (error.response.status === 429) {
        // Rate limited
        log('warn', `Rate limited by API. Waiting 60 seconds...`);
        await sleep(60000);
        
        if (attempt < CONFIG.retryAttempts) {
          return await fetchServerMetadata(serverId, attempt + 1);
        } else {
          throw new Error('Max retry attempts reached for rate limiting');
        }
      }
    }
    
    // Network error or other issue - retry with exponential backoff
    if (attempt < CONFIG.retryAttempts) {
      const delay = CONFIG.retryDelay * Math.pow(2, attempt - 1);
      log('warn', `Error fetching server ${serverId}: ${error.message}. Retrying in ${delay}ms... (attempt ${attempt}/${CONFIG.retryAttempts})`);
      await sleep(delay);
      return await fetchServerMetadata(serverId, attempt + 1);
    }
    
    throw error;
  }
}

/**
 * Convert ISO 8601 datetime string to MySQL DATETIME format
 */
function formatDateTime(isoString) {
  if (!isoString) return null;
  try {
    const date = new Date(isoString);
    return date.toISOString().slice(0, 19).replace('T', ' ');
  } catch (error) {
    return null;
  }
}

/**
 * Update server metadata in database
 */
async function updateServerMetadata(serverId, metadata) {
  if (CONFIG.dryRun) {
    log('info', `[DRY RUN] Would update server ${serverId} with: ip=${metadata.ip}, port=${metadata.port}, owner=${metadata.owner_steamid64}`);
    return;
  }
  
  try {
    const query = `
      UPDATE kz_servers 
      SET 
        api_key = ?,
        port = ?,
        ip = ?,
        server_name = ?,
        owner_steamid64 = ?,
        created_on = ?,
        updated_on = ?,
        approval_status = ?,
        approved_by_steamid64 = ?
      WHERE server_id = ?
    `;
    
    // Convert owner_steamid64 and approved_by_steamid64 to strings for precision
    const ownerSteamId = metadata.owner_steamid64 ? String(metadata.owner_steamid64) : null;
    const approverSteamId = metadata.approved_by_steamid64 ? String(metadata.approved_by_steamid64) : null;
    
    const params = [
      metadata.api_key || null,
      metadata.port,
      metadata.ip,
      metadata.name,
      ownerSteamId,
      formatDateTime(metadata.created_on),
      formatDateTime(metadata.updated_on),
      metadata.approval_status || null,
      approverSteamId,
      serverId,
    ];
    
    await connection.query(query, params);
  } catch (error) {
    log('error', `Failed to update server ${serverId}: ${error.message}`);
    throw error;
  }
}

/**
 * Process a single server
 */
async function processServer(server) {
  if (isShuttingDown) {
    return;
  }
  
  const { server_id, server_name } = server;
  
  try {
    log('info', `Processing server: ${server_name} (ID: ${server_id})`);
    
    // Fetch metadata from API
    const metadata = await fetchServerMetadata(server_id);
    
    if (!metadata) {
      log('warn', `✗ Server ${server_id} not found in GlobalKZ API`);
      stats.serversNotFound++;
      return;
    }
    
    // Update database
    await updateServerMetadata(server_id, metadata);
    
    const approvalStr = metadata.approval_status ? `status=${metadata.approval_status}` : 'not approved';
    const summary = `ip=${metadata.ip}:${metadata.port}, owner=${metadata.owner_steamid64 || 'none'}, ${approvalStr}`;
    log('info', `✓ Updated ${server_name}: ${summary}`);
    stats.serversUpdated++;
    
  } catch (error) {
    log('error', `✗ Error processing server ${server_id}: ${error.message}`);
    stats.errors++;
  } finally {
    stats.serversProcessed++;
  }
}

/**
 * Process servers in batches
 */
async function processServers(servers) {
  const totalServers = servers.length;
  let processedCount = 0;
  
  for (let i = 0; i < servers.length; i += CONFIG.batchSize) {
    if (isShuttingDown) {
      log('info', 'Graceful shutdown initiated. Stopping server processing...');
      break;
    }
    
    const batch = servers.slice(i, i + CONFIG.batchSize);
    const batchNum = Math.floor(i / CONFIG.batchSize) + 1;
    const totalBatches = Math.ceil(totalServers / CONFIG.batchSize);
    
    log('info', `Processing batch ${batchNum}/${totalBatches} (${batch.length} servers)...`);
    
    // Process batch sequentially to avoid rate limiting
    for (const server of batch) {
      await processServer(server);
      processedCount++;
      
      // Show progress every 10 servers
      if (processedCount % 10 === 0) {
        const percent = ((processedCount / totalServers) * 100).toFixed(1);
        log('info', `Progress: ${processedCount}/${totalServers} (${percent}%)`);
      }
    }
    
    // Delay between batches
    if (i + CONFIG.batchSize < servers.length && !isShuttingDown) {
      log('info', `Waiting ${CONFIG.delayBetweenBatches}ms before next batch...`);
      await sleep(CONFIG.delayBetweenBatches);
    }
  }
}

/**
 * Sleep utility
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Print statistics
 */
function printStats() {
  const elapsed = (Date.now() - stats.startTime) / 1000;
  const rate = stats.serversProcessed > 0 ? (stats.serversProcessed / elapsed).toFixed(2) : '0.00';
  
  log('info', '======================================================================');
  log('info', 'Scraper completed!');
  log('info', `  Total processed: ${stats.serversProcessed}`);
  log('info', `  Updated: ${stats.serversUpdated}`);
  log('info', `  Skipped: ${stats.serversSkipped}`);
  log('info', `  Not found: ${stats.serversNotFound}`);
  log('info', `  Errors: ${stats.errors}`);
  log('info', `  Time elapsed: ${elapsed.toFixed(2)}s`);
  log('info', `  Rate: ${rate} servers/s`);
  log('info', '======================================================================');
}

/**
 * Graceful shutdown handler
 */
async function gracefulShutdown(signal) {
  if (isShuttingDown) {
    return;
  }
  
  isShuttingDown = true;
  log('info', `Received ${signal}. Shutting down gracefully...`);
  
  // Print current stats
  printStats();
  
  // Close database connection
  if (connection) {
    await connection.end();
    log('info', 'Database connection closed');
  }
  
  process.exit(0);
}

/**
 * Main function
 */
async function main() {
  try {
    // Setup signal handlers
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    
    // Parse arguments
    parseArgs();
    
    // Validate environment
    validateEnvironment();
    
    // Print configuration
    log('info', '======================================================================');
    log('info', 'Server Metadata Scraper');
    log('info', '======================================================================');
    log('info', 'Configuration:');
    log('info', `  Database: ${CONFIG.db.host}:${CONFIG.db.port}/${CONFIG.db.database}`);
    log('info', `  API: ${CONFIG.gokzApi}`);
    log('info', `  Batch size: ${CONFIG.batchSize}`);
    log('info', `  Delay: ${CONFIG.delayBetweenBatches}ms`);
    log('info', `  Force update: ${CONFIG.forceUpdate}`);
    log('info', `  Target server ID: ${CONFIG.targetServerId || 'none'}`);
    log('info', `  Mode: ${CONFIG.dryRun ? 'DRY RUN' : 'LIVE'}`);
    log('info', '======================================================================');
    
    // Connect to database
    await connectDatabase();
    
    // Get servers to process
    log('info', 'Fetching servers needing metadata...');
    const servers = await getServersToProcess();
    
    if (servers.length === 0) {
      log('info', 'No servers need metadata updates. Exiting.');
      await connection.end();
      return;
    }
    
    log('info', `Found ${servers.length} server(s) to process`);
    
    // Start processing
    stats.startTime = Date.now();
    await processServers(servers);
    
    // Print final statistics
    printStats();
    
    // Close connection
    await connection.end();
    log('info', 'Database connection closed');
    
  } catch (error) {
    log('error', `Fatal error: ${error.message}`);
    if (connection) {
      await connection.end();
    }
    process.exit(1);
  }
}

// Run the scraper
if (require.main === module) {
  main().catch(error => {
    log('error', `Unhandled error: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { main };
