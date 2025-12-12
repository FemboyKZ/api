/**
 * Update KZ Records Statistics Tables
 * Rebuilds aggregated statistics for faster queries
 *
 * Usage:
 *   node scripts/update-kz-statistics.js              # Update all statistics
 *   node scripts/update-kz-statistics.js --players    # Update only player stats
 *   node scripts/update-kz-statistics.js --maps       # Update only map stats
 *   node scripts/update-kz-statistics.js --servers    # Update only server stats
 *   node scripts/update-kz-statistics.js --populate   # Initial population (all)
 *   node scripts/update-kz-statistics.js --populate --players  # Populate only players
 *   node scripts/update-kz-statistics.js --populate --maps     # Populate only maps
 *   node scripts/update-kz-statistics.js --populate --servers  # Populate only servers
 *
 * Batch options (for player statistics with large datasets):
 *   --batch-size=5000    # Players per batch (default: 5000)
 *   --max-batches=100    # Max batches to process, 0=unlimited (default: 0)
 *
 * Examples:
 *   node scripts/update-kz-statistics.js --players --batch-size=2000
 *   node scripts/update-kz-statistics.js --populate --players --batch-size=5000 --max-batches=100
 */

require("dotenv").config();

const mysql = require("mysql2/promise");

const DB_CONFIG = {
  host: process.env.KZ_DB_HOST || "localhost",
  user: process.env.KZ_DB_USER || "root",
  port: process.env.KZ_DB_PORT || 3308,
  password: process.env.KZ_DB_PASSWORD || "",
  database: process.env.KZ_DB_NAME || "kz_records",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  multipleStatements: true,
};

async function updateMapStatistics(connection) {
  console.log("Updating map statistics...");

  try {
    // Call stored procedure to refresh map statistics
    await connection.query("CALL refresh_all_map_statistics()");
    console.log("✓ Map statistics updated successfully");
  } catch (error) {
    console.error("✗ Error updating map statistics:", error.message);
    throw error;
  }
}

async function updateServerStatistics(connection) {
  console.log("Updating server statistics...");

  try {
    // Call stored procedure to refresh server statistics
    await connection.query("CALL refresh_all_server_statistics()");
    console.log("✓ Server statistics updated successfully");
  } catch (error) {
    console.error("✗ Error updating server statistics:", error.message);
    throw error;
  }
}

async function updatePlayerStatistics(
  connection,
  batchSize = 5000,
  maxBatches = 0,
) {
  console.log(
    `Updating player statistics (batch size: ${batchSize}, max batches: ${maxBatches || "unlimited"})...`,
  );

  try {
    // Set longer timeout for large datasets
    await connection.query("SET SESSION innodb_lock_wait_timeout = 600");
    await connection.query("SET SESSION wait_timeout = 28800");

    // Call batched stored procedure
    const [results] = await connection.query(
      "CALL refresh_player_statistics_batched(?, ?)",
      [batchSize, maxBatches],
    );

    // Extract summary from last result set
    const summary = Array.isArray(results)
      ? results[results.length - 1]
      : results;
    const playersProcessed = summary?.[0]?.players_processed || 0;
    const batches = summary?.[0]?.batches || 0;

    console.log(
      `✓ Player statistics updated: ${playersProcessed} players in ${batches} batches`,
    );
  } catch (error) {
    console.error("✗ Error updating player statistics:", error.message);
    throw error;
  }
}

async function populatePlayerStatistics(
  connection,
  batchSize = 5000,
  maxBatches = 0,
) {
  console.log(
    `Populating player statistics (batch size: ${batchSize}, max batches: ${maxBatches || "unlimited"})...`,
  );
  try {
    // Set longer timeout for large datasets
    await connection.query("SET SESSION innodb_lock_wait_timeout = 600");
    await connection.query("SET SESSION wait_timeout = 28800");

    // Call force refresh (ignores staleness) for initial population
    const [results] = await connection.query(
      "CALL force_refresh_player_statistics_batched(?, ?)",
      [batchSize, maxBatches],
    );

    const summary = Array.isArray(results)
      ? results[results.length - 1]
      : results;
    const playersProcessed = summary?.[0]?.players_processed || 0;
    const batches = summary?.[0]?.batches || 0;

    console.log(
      `✓ Player statistics populated: ${playersProcessed} players in ${batches} batches`,
    );
  } catch (error) {
    console.error("✗ Error populating player statistics:", error.message);
    throw error;
  }
}

async function populateMapStatistics(connection) {
  console.log("Populating map statistics...");
  try {
    await connection.query("CALL populate_map_statistics()");
    console.log("✓ Map statistics populated");
  } catch (error) {
    console.error("✗ Error populating map statistics:", error.message);
    throw error;
  }
}

async function populateServerStatistics(connection) {
  console.log("Populating server statistics...");
  try {
    await connection.query("CALL populate_server_statistics()");
    console.log("✓ Server statistics populated");
  } catch (error) {
    console.error("✗ Error populating server statistics:", error.message);
    throw error;
  }
}

async function populateAllStatistics(
  connection,
  batchSize = 5000,
  maxBatches = 0,
) {
  console.log("\n" + "=".repeat(60));
  console.log("INITIAL POPULATION OF ALL STATISTICS TABLES");
  console.log("=".repeat(60) + "\n");
  console.log("This may take several minutes depending on data size...\n");

  try {
    console.log("1/3 Player statistics...");
    await populatePlayerStatistics(connection, batchSize, maxBatches);
    console.log("");

    console.log("2/3 Map statistics...");
    await populateMapStatistics(connection);
    console.log("");

    console.log("3/3 Server statistics...");
    await populateServerStatistics(connection);
    console.log("");

    console.log("=".repeat(60));
    console.log("Initial population complete!");
    console.log("=".repeat(60));
  } catch (error) {
    console.error("✗ Error during initial population:", error.message);
    throw error;
  }
}

async function analyzeTables(connection) {
  console.log("Analyzing tables for query optimization...");

  await connection.query("ANALYZE TABLE kz_records_partitioned");
  await connection.query("ANALYZE TABLE kz_players");
  await connection.query("ANALYZE TABLE kz_maps");
  await connection.query("ANALYZE TABLE kz_servers");
  await connection.query("ANALYZE TABLE kz_map_statistics");
  await connection.query("ANALYZE TABLE kz_server_statistics");
  await connection.query("ANALYZE TABLE kz_player_statistics");

  console.log("✓ Table analysis complete");
}

async function showStatistics(connection) {
  console.log("\n" + "=".repeat(60));
  console.log("Database Statistics Summary");
  console.log("=".repeat(60) + "\n");

  // Total records
  const [[{ total_records }]] = await connection.query(
    "SELECT COUNT(*) as total_records FROM kz_records",
  );
  console.log(`Total Records: ${total_records.toLocaleString()}`);

  // Total players
  const [[{ total_players }]] = await connection.query(
    "SELECT COUNT(*) as total_players FROM kz_players",
  );
  console.log(`Total Players: ${total_players.toLocaleString()}`);

  // Total maps
  const [[{ total_maps }]] = await connection.query(
    "SELECT COUNT(*) as total_maps FROM kz_maps",
  );
  console.log(`Total Maps: ${total_maps.toLocaleString()}`);

  // Total servers
  const [[{ total_servers }]] = await connection.query(
    "SELECT COUNT(*) as total_servers FROM kz_servers",
  );
  console.log(`Total Servers: ${total_servers.toLocaleString()}`);

  // Database size
  const [sizes] = await connection.query(
    `
        SELECT 
            table_name,
            ROUND((data_length + index_length) / 1024 / 1024, 2) AS size_mb
        FROM information_schema.tables
        WHERE table_schema = ?
        ORDER BY (data_length + index_length) DESC
    `,
    [DB_CONFIG.database],
  );

  console.log("\nTable Sizes:");
  let totalSize = 0;
  sizes.forEach(({ table_name, size_mb }) => {
    const sizeMb = size_mb || 0;
    console.log(
      `  ${(table_name || "unknown").padEnd(30)} ${sizeMb.toLocaleString().padStart(10)} MB`,
    );
    totalSize += parseFloat(sizeMb);
  });
  console.log(
    `  ${"TOTAL".padEnd(30)} ${totalSize.toFixed(2).padStart(10)} MB`,
  );

  // Top 10 players by records
  console.log("\nTop 10 Players by Record Count:");
  const [topPlayers] = await connection.query(`
        SELECT 
            p.player_name,
            p.steamid64,
            ps.total_records,
            ps.world_records,
            ROUND(ps.total_playtime / 3600, 2) as total_hours
        FROM kz_player_statistics ps
        JOIN kz_players p ON ps.player_id = p.id
        ORDER BY ps.total_records DESC
        LIMIT 10
    `);

  topPlayers.forEach((player, index) => {
    // Show steamid64 if name is unknown
    const displayName =
      player.player_name && !player.player_name.startsWith("Unknown Player")
        ? player.player_name
        : player.steamid64;
    console.log(
      `  ${(index + 1).toString().padStart(2)}. ${(displayName || "Unknown").padEnd(25)} ` +
        `Records: ${(player.total_records || 0).toLocaleString().padStart(7)} | ` +
        `WRs: ${(player.world_records || 0).toString().padStart(4)} | ` +
        `Hours: ${(player.total_hours || 0).toLocaleString()}`,
    );
  });

  // Most popular maps
  console.log("\nTop 10 Most Popular Maps:");
  const [topMaps] = await connection.query(`
        SELECT 
            m.map_name,
            ms.total_records,
            ms.unique_players,
            ms.world_record_time
        FROM kz_map_statistics ms
        JOIN kz_maps m ON ms.map_id = m.id
        ORDER BY ms.total_records DESC
        LIMIT 10
    `);

  topMaps.forEach((map, index) => {
    const wrTime = map.world_record_time
      ? parseFloat(map.world_record_time).toFixed(3) + "s"
      : "N/A";
    console.log(
      `  ${(index + 1).toString().padStart(2)}. ${(map.map_name || "Unknown").padEnd(30)} ` +
        `Records: ${(map.total_records || 0).toLocaleString().padStart(6)} | ` +
        `Players: ${(map.unique_players || 0).toLocaleString().padStart(5)} | ` +
        `WR: ${wrTime}`,
    );
  });

  // Top servers by records
  console.log("\nTop 10 Servers by Record Count:");
  const [topServers] = await connection.query(`
        SELECT 
            s.server_name,
            ss.total_records,
            ss.unique_players,
            ss.unique_maps
        FROM kz_server_statistics ss
        JOIN kz_servers s ON ss.server_id = s.id
        ORDER BY ss.total_records DESC
        LIMIT 10
    `);

  topServers.forEach((server, index) => {
    console.log(
      `  ${(index + 1).toString().padStart(2)}. ${(server.server_name || "Unknown").padEnd(30)} ` +
        `Records: ${(server.total_records || 0).toLocaleString().padStart(6)} | ` +
        `Players: ${(server.unique_players || 0).toLocaleString().padStart(5)} | ` +
        `Maps: ${(server.unique_maps || 0).toLocaleString()}`,
    );
  });

  console.log("\n" + "=".repeat(60) + "\n");
}

async function main() {
  const args = process.argv.slice(2);
  const isPopulate = args.includes("--populate");
  const isPlayersOnly = args.includes("--players");
  const isMapsOnly = args.includes("--maps");
  const isServersOnly = args.includes("--servers");

  // Parse batch size and max batches from arguments
  const batchSizeArg = args.find((a) => a.startsWith("--batch-size="));
  const maxBatchesArg = args.find((a) => a.startsWith("--max-batches="));
  const batchSize = batchSizeArg ? parseInt(batchSizeArg.split("=")[1]) : 5000;
  const maxBatches = maxBatchesArg ? parseInt(maxBatchesArg.split("=")[1]) : 0;

  console.log("KZ Records Statistics Update");
  console.log(
    `Database: ${DB_CONFIG.host}:${DB_CONFIG.port}/${DB_CONFIG.database}`,
  );
  console.log(
    `Batch size: ${batchSize}, Max batches: ${maxBatches || "unlimited"}\n`,
  );

  const pool = await mysql.createPool(DB_CONFIG);
  const connection = await pool.getConnection();

  try {
    const startTime = Date.now();

    if (isPopulate) {
      // Initial population mode
      if (isPlayersOnly || isMapsOnly || isServersOnly) {
        // Selective population
        console.log("Selective initial population...\n");
        if (isPlayersOnly)
          await populatePlayerStatistics(connection, batchSize, maxBatches);
        if (isMapsOnly) await populateMapStatistics(connection);
        if (isServersOnly) await populateServerStatistics(connection);
      } else {
        // Populate all
        await populateAllStatistics(connection, batchSize, maxBatches);
      }
    } else if (isPlayersOnly) {
      // Update only players
      await updatePlayerStatistics(connection, batchSize, maxBatches);
    } else if (isMapsOnly) {
      // Update only maps
      await updateMapStatistics(connection);
    } else if (isServersOnly) {
      // Update only servers
      await updateServerStatistics(connection);
    } else {
      // Update all
      console.log("Updating all statistics tables...\n");
      await updatePlayerStatistics(connection, batchSize, maxBatches);
      await updateMapStatistics(connection);
      await updateServerStatistics(connection);
    }

    await analyzeTables(connection);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n✓ Statistics updated successfully in ${elapsed}s`);

    await showStatistics(connection);
  } catch (error) {
    console.error("✗ Error updating statistics:", error);
    throw error;
  } finally {
    connection.release();
    await pool.end();
  }
}

// Run if executed directly
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("\n✗ Fatal error:", error);
      process.exit(1);
    });
}

module.exports = {
  updateMapStatistics,
  updateServerStatistics,
  updatePlayerStatistics,
  populateAllStatistics,
  populateMapStatistics,
  populateServerStatistics,
  populatePlayerStatistics,
  showStatistics,
};
