#!/usr/bin/env node
/**
 * Sanitize Map Names Script
 *
 * This script sanitizes map names in the database by:
 * 1. Removing workshop paths (workshop/123456/mapname -> mapname)
 * 2. Decoding URL encoding (workshop%2F123%2Fmap -> map)
 * 3. Consolidating duplicate maps with different paths
 * 4. Merging playtime and metadata
 *
 * Usage:
 *   node scripts/sanitize-map-names.js [--dry-run] [--game=csgo|counterstrike2]
 */

require("dotenv").config();
const pool = require("../src/db");
const { sanitizeMapName } = require("../src/utils/validators");
const logger = require("../src/utils/logger");

async function sanitizeMapNames(dryRun = false, gameFilter = null) {
  try {
    logger.info("Starting map name sanitization...");
    logger.info(`Dry run: ${dryRun}`);
    logger.info(`Game filter: ${gameFilter || "all"}`);

    // Get all maps
    let query =
      "SELECT id, name, game, playtime, server_ip, server_port, last_played, globalInfo, globalInfo_updated_at FROM maps";
    const params = [];

    if (gameFilter) {
      query += " WHERE game = ?";
      params.push(gameFilter);
    }

    query += " ORDER BY game, name";

    const [maps] = await pool.query(query, params);
    logger.info(`Found ${maps.length} maps to process`);

    const changes = [];
    const duplicates = new Map(); // Key: sanitized_name:game, Value: array of map records

    // First pass: identify changes and duplicates
    for (const map of maps) {
      const sanitized = sanitizeMapName(map.name);

      if (sanitized !== map.name) {
        changes.push({
          id: map.id,
          oldName: map.name,
          newName: sanitized,
          game: map.game,
        });

        const key = `${sanitized}:${map.game}`;
        if (!duplicates.has(key)) {
          duplicates.set(key, []);
        }
        duplicates.get(key).push({ ...map, sanitizedName: sanitized });
      }
    }

    logger.info(`Found ${changes.length} maps needing sanitization`);

    if (changes.length === 0) {
      logger.info("No maps need sanitization. Database is clean!");
      return;
    }

    // Show sample changes
    logger.info("\nSample changes (first 10):");
    changes.slice(0, 10).forEach((change) => {
      logger.info(
        `  [${change.game}] "${change.oldName}" -> "${change.newName}"`,
      );
    });

    if (dryRun) {
      logger.info("\n=== DRY RUN - No changes made ===");
      logger.info(`Would sanitize ${changes.length} map names`);

      // Check for duplicates that would be created
      const wouldCreateDuplicates = Array.from(duplicates.entries()).filter(
        ([, maps]) => maps.length > 1,
      );

      if (wouldCreateDuplicates.length > 0) {
        logger.info(
          `\nWould create ${wouldCreateDuplicates.length} duplicate map entries that need consolidation:`,
        );
        wouldCreateDuplicates.slice(0, 5).forEach(([key, maps]) => {
          const [name, game] = key.split(":");
          logger.info(
            `  ${name} (${game}): ${maps.length} entries would be merged`,
          );
          logger.info(
            `    Total playtime: ${maps.reduce((sum, m) => sum + (m.playtime || 0), 0)} seconds`,
          );
        });
      }

      return;
    }

    // Actually perform the sanitization
    logger.info("\nApplying changes...");

    let sanitized = 0;
    let consolidated = 0;

    // Group all maps by their sanitized name and game
    const mapGroups = new Map(); // Key: sanitized_name:game, Value: array of map records

    for (const map of maps) {
      const sanitized = sanitizeMapName(map.name);
      const key = `${sanitized}:${map.game}`;

      if (!mapGroups.has(key)) {
        mapGroups.set(key, []);
      }
      mapGroups.get(key).push({ ...map, sanitizedName: sanitized });
    }

    // Process each group
    for (const [key, mapGroup] of mapGroups.entries()) {
      const [sanitizedName, game] = key.split(":");

      // Skip if all maps already have the correct name
      const needsChange = mapGroup.some((m) => m.name !== sanitizedName);
      if (!needsChange) {
        continue;
      }

      if (mapGroup.length === 1) {
        // Single map, just rename if needed
        const map = mapGroup[0];
        if (map.name !== sanitizedName) {
          await pool.query("UPDATE maps SET name = ? WHERE id = ?", [
            sanitizedName,
            map.id,
          ]);
          sanitized++;
          logger.debug(`Renamed: ${map.name} -> ${sanitizedName} (${game})`);
        }
      } else {
        // Multiple maps with same sanitized name - need to consolidate
        // Sort by playtime descending to keep the one with most playtime as base
        mapGroup.sort((a, b) => (b.playtime || 0) - (a.playtime || 0));

        const primary = mapGroup[0];
        const duplicatesToMerge = mapGroup.slice(1);

        // Sum up playtime from all duplicates
        const totalPlaytime = mapGroup.reduce(
          (sum, m) => sum + (m.playtime || 0),
          0,
        );

        // Use the most recent last_played
        const lastPlayed = mapGroup.reduce((latest, m) => {
          return !latest || (m.last_played && m.last_played > latest)
            ? m.last_played
            : latest;
        }, null);

        // Keep globalInfo from the one that has it (prefer primary)
        const globalInfo =
          mapGroup.find((m) => m.globalInfo)?.globalInfo || null;
        const globalInfoUpdatedAt =
          mapGroup.find((m) => m.globalInfo_updated_at)
            ?.globalInfo_updated_at || null;

        // Delete duplicate records first
        for (const dup of duplicatesToMerge) {
          await pool.query("DELETE FROM maps WHERE id = ?", [dup.id]);
        }

        // Then update primary record with consolidated data and sanitized name
        await pool.query(
          `UPDATE maps 
           SET name = ?, 
               playtime = ?, 
               last_played = ?,
               globalInfo = ?,
               globalInfo_updated_at = ?
           WHERE id = ?`,
          [
            sanitizedName,
            totalPlaytime,
            lastPlayed,
            globalInfo,
            globalInfoUpdatedAt,
            primary.id,
          ],
        );

        consolidated += duplicatesToMerge.length;
        sanitized++;

        logger.info(
          `Consolidated: ${sanitizedName} (${game}) - merged ${mapGroup.length} entries, total playtime: ${totalPlaytime}s`,
        );
      }
    }

    logger.info("\n=== Sanitization Complete ===");
    logger.info(`Sanitized: ${sanitized} unique maps`);
    logger.info(`Consolidated: ${consolidated} duplicate entries`);
    logger.info(`Total maps processed: ${changes.length}`);
  } catch (error) {
    logger.error(`Map sanitization failed: ${error.message}`);
    logger.error(error.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const gameArg = args.find((arg) => arg.startsWith("--game="));
const gameFilter = gameArg ? gameArg.split("=")[1] : null;

// Validate game filter
if (gameFilter && !["csgo", "counterstrike2"].includes(gameFilter)) {
  console.error(
    "Invalid game filter. Use --game=csgo or --game=counterstrike2",
  );
  process.exit(1);
}

// Run the script
sanitizeMapNames(dryRun, gameFilter);
