#!/usr/bin/env node

/**
 * Fix Player Names Script
 *
 * This script connects to the database and properly sanitizes all player names
 * using the same sanitizePlayerName() function the API uses.
 *
 * This is more reliable than SQL REGEXP_REPLACE which can mangle Unicode characters.
 *
 * Usage:
 *   node scripts/fix-player-names.js [--dry-run]
 *
 * Options:
 *   --dry-run  Show what would be changed without actually updating the database
 */

require("dotenv").config();
const pool = require("../src/db");
const { sanitizePlayerName } = require("../src/utils/validators");

const DRY_RUN = process.argv.includes("--dry-run");

async function fixPlayerNames() {
  console.log("🔧 Player Name Sanitization Script");
  console.log(
    `Mode: ${DRY_RUN ? "DRY RUN (no changes)" : "LIVE (will update database)"}`,
  );
  console.log("");

  try {
    // Initialize database connection
    const { initDatabase } = require("../src/db");
    await initDatabase();

    // Process players table
    console.log("📋 Processing players table...");
    const [players] = await pool.query(
      "SELECT steamid, latest_name, game FROM players WHERE latest_name IS NOT NULL",
    );

    let playersUpdated = 0;
    let playersSkipped = 0;

    for (const player of players) {
      const original = player.latest_name;
      const cleaned = sanitizePlayerName(original);

      if (cleaned !== original) {
        console.log(`  ✓ Player ${player.steamid} (${player.game})`);
        console.log(`    Before: "${original}"`);
        console.log(`    After:  "${cleaned}"`);

        if (!DRY_RUN) {
          await pool.query(
            "UPDATE players SET latest_name = ? WHERE steamid = ? AND game = ?",
            [cleaned, player.steamid, player.game],
          );
        }
        playersUpdated++;
      } else {
        playersSkipped++;
      }
    }

    console.log(
      `\n✅ Players: ${playersUpdated} updated, ${playersSkipped} unchanged\n`,
    );

    // Process player_sessions table
    console.log("📋 Processing player_sessions table...");
    const [sessions] = await pool.query(
      "SELECT id, steamid, name FROM player_sessions WHERE name IS NOT NULL ORDER BY id DESC LIMIT 1000",
    );

    let sessionsUpdated = 0;
    let sessionsSkipped = 0;

    for (const session of sessions) {
      const original = session.name;
      const cleaned = sanitizePlayerName(original) || "Unknown";

      if (cleaned !== original) {
        console.log(`  ✓ Session ${session.id} (${session.steamid})`);
        console.log(`    Before: "${original}"`);
        console.log(`    After:  "${cleaned}"`);

        if (!DRY_RUN) {
          await pool.query("UPDATE player_sessions SET name = ? WHERE id = ?", [
            cleaned,
            session.id,
          ]);
        }
        sessionsUpdated++;
      } else {
        sessionsSkipped++;
      }
    }

    console.log(
      `\n✅ Sessions: ${sessionsUpdated} updated, ${sessionsSkipped} unchanged\n`,
    );

    // Summary
    console.log("═══════════════════════════════════════");
    console.log("📊 Summary:");
    console.log(`   Players: ${playersUpdated} cleaned`);
    console.log(`   Sessions: ${sessionsUpdated} cleaned`);
    if (DRY_RUN) {
      console.log("\n⚠️  DRY RUN - No changes were made");
      console.log("   Run without --dry-run to apply changes");
    } else {
      console.log("\n✅ Database updated successfully");
    }
    console.log("═══════════════════════════════════════");
  } catch (error) {
    console.error("❌ Error:", error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    // Close database connection
    const { closeDatabase } = require("../src/db");
    await closeDatabase();
    process.exit(0);
  }
}

// Run the script
fixPlayerNames();
