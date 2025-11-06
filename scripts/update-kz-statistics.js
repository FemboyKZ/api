/**
 * Update KZ Records Statistics Tables
 * Rebuilds aggregated statistics for faster queries
 *
 * Usage: node scripts/update-kz-statistics.js
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
};

async function updateMapStatistics(connection) {
  console.log("Updating map statistics...");

  // Clear existing statistics
  await connection.query("TRUNCATE TABLE kz_map_statistics");

  // Build new statistics
  const [result] = await connection.query(`
        INSERT INTO kz_map_statistics 
        (map_id, mode, stage, total_records, unique_players, world_record_time, avg_time)
        SELECT 
            r.map_id,
            r.mode,
            r.stage,
            COUNT(*) as total_records,
            COUNT(DISTINCT r.player_id) as unique_players,
            MIN(r.time) as world_record_time,
            AVG(r.time) as avg_time
        FROM kz_records r
        GROUP BY r.map_id, r.mode, r.stage
    `);

  console.log(`✓ Updated ${result.affectedRows} map statistics entries`);
}

async function updatePlayerStatistics(connection) {
  console.log("Updating player statistics...");

  // Clear existing statistics
  await connection.query("TRUNCATE TABLE kz_player_statistics");

  // Build new statistics
  const [result] = await connection.query(`
        INSERT INTO kz_player_statistics 
        (player_id, total_records, total_maps, total_playtime, avg_teleports)
        SELECT 
            r.player_id,
            COUNT(*) as total_records,
            COUNT(DISTINCT r.map_id) as total_maps,
            SUM(r.time) as total_playtime,
            AVG(r.teleports) as avg_teleports
        FROM kz_records r
        GROUP BY r.player_id
    `);

  console.log(`✓ Updated ${result.affectedRows} player statistics entries`);
}

async function updateWorldRecords(connection) {
  console.log("Updating world record holders in map statistics...");

  // Update world record player_id for each map/mode/stage combination
  const [result] = await connection.query(`
        UPDATE kz_map_statistics ms
        JOIN (
            SELECT 
                map_id,
                mode,
                stage,
                player_id,
                time,
                ROW_NUMBER() OVER (PARTITION BY map_id, mode, stage ORDER BY time ASC) as rn
            FROM kz_records
        ) wr ON ms.map_id = wr.map_id 
            AND ms.mode = wr.mode 
            AND ms.stage = wr.stage
            AND wr.rn = 1
        SET ms.world_record_player_id = wr.player_id,
            ms.world_record_time = wr.time
    `);

  console.log(`✓ Updated world record holders`);
}

async function countWorldRecords(connection) {
  console.log("Counting world records per player...");

  // Count WRs per player
  const [result] = await connection.query(`
        UPDATE kz_player_statistics ps
        JOIN (
            SELECT 
                world_record_player_id,
                COUNT(*) as wr_count
            FROM kz_map_statistics
            WHERE world_record_player_id IS NOT NULL
            GROUP BY world_record_player_id
        ) wr ON ps.player_id = wr.world_record_player_id
        SET ps.world_records = wr.wr_count
    `);

  console.log(`✓ Updated world record counts`);
}

async function analyzeTables(connection) {
  console.log("Analyzing tables for query optimization...");

  await connection.query("ANALYZE TABLE kz_records");
  await connection.query("ANALYZE TABLE kz_players");
  await connection.query("ANALYZE TABLE kz_maps");
  await connection.query("ANALYZE TABLE kz_servers");
  await connection.query("ANALYZE TABLE kz_map_statistics");
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
    console.log(
      `  ${table_name.padEnd(30)} ${size_mb.toLocaleString().padStart(10)} MB`,
    );
    totalSize += parseFloat(size_mb);
  });
  console.log(
    `  ${"TOTAL".padEnd(30)} ${totalSize.toFixed(2).padStart(10)} MB`,
  );

  // Top 10 players by records
  console.log("\nTop 10 Players by Record Count:");
  const [topPlayers] = await connection.query(`
        SELECT 
            p.player_name,
            ps.total_records,
            ps.world_records,
            ROUND(ps.total_playtime / 3600, 2) as total_hours
        FROM kz_player_statistics ps
        JOIN kz_players p ON ps.player_id = p.id
        ORDER BY ps.total_records DESC
        LIMIT 10
    `);

  topPlayers.forEach((player, index) => {
    console.log(
      `  ${(index + 1).toString().padStart(2)}. ${player.player_name.padEnd(25)} ` +
        `Records: ${player.total_records.toLocaleString().padStart(7)} | ` +
        `WRs: ${player.world_records.toString().padStart(4)} | ` +
        `Hours: ${player.total_hours.toLocaleString()}`,
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
        WHERE ms.mode = 'kz_timer' AND ms.stage = 0
        ORDER BY ms.total_records DESC
        LIMIT 10
    `);

  topMaps.forEach((map, index) => {
    console.log(
      `  ${(index + 1).toString().padStart(2)}. ${map.map_name.padEnd(30)} ` +
        `Records: ${map.total_records.toLocaleString().padStart(6)} | ` +
        `Players: ${map.unique_players.toLocaleString().padStart(5)} | ` +
        `WR: ${map.world_record_time.toFixed(3)}s`,
    );
  });

  console.log("\n" + "=".repeat(60) + "\n");
}

async function main() {
  console.log("KZ Records Statistics Update");
  console.log(`Database: ${DB_CONFIG.host}/${DB_CONFIG.database}\n`);

  const pool = await mysql.createPool(DB_CONFIG);
  const connection = await pool.getConnection();

  try {
    const startTime = Date.now();

    await updateMapStatistics(connection);
    await updatePlayerStatistics(connection);
    await updateWorldRecords(connection);
    await countWorldRecords(connection);
    await analyzeTables(connection);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n✓ All statistics updated successfully in ${elapsed}s`);

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
  updatePlayerStatistics,
  updateWorldRecords,
  countWorldRecords,
  showStatistics,
};
