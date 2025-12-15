#!/usr/bin/env node
/**
 * Import Map Mode Filters
 *
 * This script imports mode-specific map filters from text files.
 * Maps in these files will ONLY be tracked for the specified mode.
 *
 * Usage:
 *   node scripts/import-map-mode-filters.js --file=devonly/csgo-vnl-maps.txt --mode=kz_vanilla
 *   node scripts/import-map-mode-filters.js --file=devonly/csgo-vnl-maps.txt --mode=kz_vanilla --dry-run
 *
 * File format:
 *   One map name per line, empty lines and lines starting with # are ignored
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

// Parse command line arguments
const args = process.argv.slice(2).reduce((acc, arg) => {
  const [key, value] = arg.replace(/^--/, "").split("=");
  acc[key] = value ?? true;
  return acc;
}, {});

const DB_CONFIG = {
  host: process.env.KZ_DB_HOST || process.env.DB_HOST || "localhost",
  port: process.env.KZ_DB_PORT || process.env.DB_PORT || 3306,
  user: process.env.KZ_DB_USER || process.env.DB_USER || "root",
  password: process.env.KZ_DB_PASSWORD || process.env.DB_PASSWORD || "",
  database: process.env.KZ_DB_NAME || "kz_records",
  charset: "utf8mb4",
};

async function main() {
  const filePath = args.file;
  const mode = args.mode;
  const dryRun = args["dry-run"] === true;
  const clearExisting = args["clear"] === true;

  if (!filePath || !mode) {
    console.error(
      "Usage: node scripts/import-map-mode-filters.js --file=<path> --mode=<mode>",
    );
    console.error(
      "  --file     Path to text file with map names (one per line)",
    );
    console.error(
      "  --mode     Mode to restrict maps to (kz_timer, kz_simple, kz_vanilla)",
    );
    console.error(
      "  --dry-run  Show what would be done without making changes",
    );
    console.error(
      "  --clear    Clear existing filters for this mode before importing",
    );
    process.exit(1);
  }

  const validModes = ["kz_timer", "kz_simple", "kz_vanilla"];
  if (!validModes.includes(mode)) {
    console.error(
      `Invalid mode: ${mode}. Must be one of: ${validModes.join(", ")}`,
    );
    process.exit(1);
  }

  const fullPath = path.resolve(filePath);
  if (!fs.existsSync(fullPath)) {
    console.error(`File not found: ${fullPath}`);
    process.exit(1);
  }

  console.log(`Importing map mode filters from: ${fullPath}`);
  console.log(`Mode: ${mode}`);
  console.log(`Dry run: ${dryRun}`);
  console.log();

  // Read and parse file
  const content = fs.readFileSync(fullPath, "utf8");
  const mapNames = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  console.log(`Found ${mapNames.length} map names in file`);

  const pool = mysql.createPool(DB_CONFIG);

  try {
    // Check if table exists
    const [tables] = await pool.query(
      "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'kz_map_mode_filters'",
      [DB_CONFIG.database],
    );

    if (tables.length === 0) {
      console.error(
        "Table kz_map_mode_filters does not exist. Run the migration first:",
      );
      console.error(
        "  mysql -u root -p kz_records < db/migrations/add_map_mode_filters.sql",
      );
      process.exit(1);
    }

    // Clear existing if requested
    if (clearExisting && !dryRun) {
      const [result] = await pool.query(
        "DELETE FROM kz_map_mode_filters WHERE mode = ?",
        [mode],
      );
      console.log(
        `Cleared ${result.affectedRows} existing filters for mode ${mode}`,
      );
    }

    // Get existing map IDs
    const [maps] = await pool.query(
      "SELECT id, map_name FROM kz_maps WHERE map_name IN (?)",
      [mapNames],
    );
    const mapNameToId = new Map(maps.map((m) => [m.map_name, m.id]));

    console.log(`Found ${maps.length} maps in database matching file`);

    const notFound = mapNames.filter((name) => !mapNameToId.has(name));
    if (notFound.length > 0) {
      console.log(`\nMaps not found in database (${notFound.length}):`);
      notFound.slice(0, 20).forEach((name) => console.log(`  - ${name}`));
      if (notFound.length > 20) {
        console.log(`  ... and ${notFound.length - 20} more`);
      }
    }

    if (dryRun) {
      console.log("\n[DRY RUN] Would insert filters for:");
      maps
        .slice(0, 20)
        .forEach((m) => console.log(`  - ${m.map_name} -> ${mode}`));
      if (maps.length > 20) {
        console.log(`  ... and ${maps.length - 20} more`);
      }
    } else {
      // Batch insert
      let inserted = 0;
      let skipped = 0;

      for (const map of maps) {
        try {
          await pool.query(
            "INSERT IGNORE INTO kz_map_mode_filters (map_id, mode) VALUES (?, ?)",
            [map.id, mode],
          );
          inserted++;
        } catch (err) {
          if (err.code === "ER_DUP_ENTRY") {
            skipped++;
          } else {
            throw err;
          }
        }
      }

      console.log(`\nInserted ${inserted} map mode filters`);
      if (skipped > 0) {
        console.log(`Skipped ${skipped} duplicates`);
      }
    }

    // Show summary
    const [summary] = await pool.query(`
      SELECT mode, COUNT(*) as count 
      FROM kz_map_mode_filters 
      GROUP BY mode 
      ORDER BY mode
    `);

    console.log("\nCurrent filter summary:");
    for (const row of summary) {
      console.log(`  ${row.mode}: ${row.count} maps`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
