/**
 * One-shot migration: fix steamid64 values in kz_players that were stored
 * incorrectly due to float64 precision loss when parsing large JSON numbers.
 *
 * For each affected player:
 *   1. Compute the correct steamid64 from steam_id (authoritative string)
 *   2. If a player with the correct steamid64 already exists (duplicate pair):
 *      a. Reassign all records/PBs from ghost → real player
 *      b. Delete ghost player_statistics and PB conflicts
 *      c. Delete the ghost kz_players row
 *   3. Update remaining kz_players rows with no conflict
 *   4. Sync steamid64 in kz_records_partitioned and kz_player_map_pbs
 *
 * Usage:
 *   node scripts/fix-steamid64.js [--dry-run]
 */

require("dotenv").config();
const mysql = require("mysql2/promise");

const DRY_RUN = process.argv.includes("--dry-run");

const pool = mysql.createPool({
  host: process.env.KZ_DB_HOST || "localhost",
  port: parseInt(process.env.KZ_DB_PORT) || 3308,
  user: process.env.KZ_DB_USER,
  password: process.env.KZ_DB_PASSWORD,
  database: process.env.KZ_DB_NAME,
  connectionLimit: 5,
  multipleStatements: false,
});

/** Convert STEAM_X:Y:Z → steamid64 string using BigInt (no precision loss) */
function steamId2ToSteamId64(steamId) {
  const match = steamId && steamId.match(/^STEAM_\d+:(\d+):(\d+)$/);
  if (!match) return null;
  const authBit = BigInt(match[1]);
  const accountId = BigInt(match[2]);
  return String(76561197960265728n + accountId * 2n + authBit);
}

async function run() {
  const conn = await pool.getConnection();
  console.log(`Mode: ${DRY_RUN ? "DRY RUN (no changes)" : "LIVE"}`);

  try {
    // Increase lock wait timeout and reduce isolation for this session
    await conn.query(`SET SESSION innodb_lock_wait_timeout = 120`);
    await conn.query(`SET SESSION transaction_isolation = 'READ-COMMITTED'`);

    // 1. Find all players with wrong steamid64
    console.log("\n[1/6] Finding affected players...");
    const [affected] = await conn.query(
      `SELECT id, steamid64, steam_id, player_name
       FROM kz_players
       WHERE steam_id LIKE 'STEAM_1:%'
         AND steam_id != 'STEAM_0:0:0'
         AND CAST(SUBSTRING_INDEX(steam_id, ':', -1) AS UNSIGNED) > 0`,
    );

    const toFix = affected
      .filter((p) => {
        const correct = steamId2ToSteamId64(p.steam_id);
        return correct && correct !== String(p.steamid64);
      })
      .map((p) => ({ ...p, correct: steamId2ToSteamId64(p.steam_id) }));

    console.log(`  Found ${toFix.length} players with incorrect steamid64`);
    if (toFix.length === 0) {
      console.log("Nothing to do.");
      return;
    }

    // 2. Split into: needs-merge (correct steamid64 already exists) vs simple-update
    console.log("\n[2/6] Checking for duplicate pairs (ghost + real)...");
    const [existingRows] = await conn.query(
      `SELECT id, steamid64 FROM kz_players WHERE steamid64 IN (?)`,
      [toFix.map((p) => p.correct)],
    );
    const existingMap = new Map(
      existingRows.map((r) => [String(r.steamid64), r.id]),
    );

    const merges = toFix.filter((p) => existingMap.has(p.correct));
    const simpleUpdates = toFix.filter((p) => !existingMap.has(p.correct));
    console.log(
      `  ${merges.length} need merge (ghost → real), ${simpleUpdates.length} are simple updates`,
    );

    // 3. Process merges using a temp mapping table for fast JOIN updates
    if (merges.length > 0) {
      console.log(
        `\n[3/6] Merging ${merges.length} ghost players via temp table...`,
      );

      if (!DRY_RUN) {
        // Create temp mapping table
        await conn.query(`
          CREATE TEMPORARY TABLE _ghost_map (
            ghost_id INT UNSIGNED NOT NULL,
            real_id  INT UNSIGNED NOT NULL,
            correct_steamid64 VARCHAR(20) NOT NULL,
            PRIMARY KEY (ghost_id),
            INDEX idx_real (real_id)
          ) ENGINE=MEMORY
        `);

        // Insert mappings in chunks of 10000 to stay under max_allowed_packet
        const values = merges.map((p) => [
          p.id,
          existingMap.get(p.correct),
          p.correct,
        ]);
        const INSERT_CHUNK = 10000;
        for (let i = 0; i < values.length; i += INSERT_CHUNK) {
          await conn.query(
            `INSERT INTO _ghost_map (ghost_id, real_id, correct_steamid64) VALUES ?`,
            [values.slice(i, i + INSERT_CHUNK)],
          );
          process.stdout.write(
            `\r  Loading temp table: ${Math.min(i + INSERT_CHUNK, values.length)}/${values.length}   `,
          );
        }
        console.log(`\n  Temp table loaded with ${values.length} mappings`);

        let errors = 0;
        try {
          process.stdout.write(`  Reassigning records...`);
          const [r1] = await conn.query(`
            UPDATE kz_records_partitioned r
            INNER JOIN _ghost_map m ON r.player_id = m.ghost_id
            SET r.player_id = m.real_id, r.steamid64 = m.correct_steamid64
          `);
          console.log(` ${r1.affectedRows} rows updated`);

          process.stdout.write(`  Deleting conflicting PBs...`);
          const [r2] = await conn.query(`
            DELETE g FROM kz_player_map_pbs g
            INNER JOIN _ghost_map m ON g.player_id = m.ghost_id
            INNER JOIN kz_player_map_pbs r
              ON r.player_id = m.real_id AND r.map_id = g.map_id AND r.mode = g.mode AND r.stage = g.stage
          `);
          console.log(` ${r2.affectedRows} rows deleted`);

          process.stdout.write(`  Reassigning remaining PBs...`);
          const [r3] = await conn.query(`
            UPDATE kz_player_map_pbs pb
            INNER JOIN _ghost_map m ON pb.player_id = m.ghost_id
            SET pb.player_id = m.real_id, pb.steamid64 = m.correct_steamid64
          `);
          console.log(` ${r3.affectedRows} rows updated`);

          process.stdout.write(`  Deleting ghost stats + players...`);
          await conn.query(`SET foreign_key_checks = 0`);
          const [r4] = await conn.query(
            `DELETE ps FROM kz_player_statistics ps INNER JOIN _ghost_map m ON ps.player_id = m.ghost_id`,
          );
          const [r5] = await conn.query(
            `DELETE p FROM kz_players p INNER JOIN _ghost_map m ON p.id = m.ghost_id`,
          );
          await conn.query(`SET foreign_key_checks = 1`);
          console.log(
            ` ${r4.affectedRows} stats, ${r5.affectedRows} players deleted`,
          );
        } catch (err) {
          errors++;
          console.error(`\n  ERROR: ${err.message}`);
        }

        await conn.query(`DROP TEMPORARY TABLE IF EXISTS _ghost_map`);
        console.log(
          `\n  Done: ${errors === 0 ? "all merged" : "completed with errors"}`,
        );
      } else {
        merges
          .slice(0, 5)
          .forEach((p) =>
            console.log(
              `  [DRY] ghost id=${p.id} → real id=${existingMap.get(p.correct)} (${p.correct})`,
            ),
          );
        console.log(`  [DRY] Would merge ${merges.length} ghost players`);
      }
    } else {
      console.log("\n[3/6] No merges needed, skipping.");
    }

    // 4. Simple updates: no conflict, just fix steamid64 in kz_players
    if (simpleUpdates.length > 0) {
      console.log(
        `\n[4/6] Updating ${simpleUpdates.length} players (no conflict)...`,
      );
      if (!DRY_RUN) {
        for (let i = 0; i < simpleUpdates.length; i += 500) {
          const chunk = simpleUpdates.slice(i, i + 500);
          for (const p of chunk) {
            await conn.query(
              `UPDATE kz_players SET steamid64 = ? WHERE id = ?`,
              [p.correct, p.id],
            );
          }
          process.stdout.write(
            `\r  ...updated ${Math.min(i + 500, simpleUpdates.length)}/${simpleUpdates.length}   `,
          );
          await new Promise((r) => setTimeout(r, 50));
        }
        console.log();
      } else {
        console.log(
          `  [DRY] Would update ${simpleUpdates.length} kz_players rows`,
        );
      }
    } else {
      console.log("\n[4/6] No simple updates needed, skipping.");
    }

    // 5. Sync kz_records_partitioned steamid64 (simple-updated players)
    console.log("\n[5/6] Syncing kz_records_partitioned steamid64...");
    if (!DRY_RUN) {
      const [res1] = await conn.query(
        `UPDATE kz_records_partitioned r
         INNER JOIN kz_players p ON p.id = r.player_id
         SET r.steamid64 = p.steamid64
         WHERE r.steamid64 != p.steamid64`,
      );
      console.log(
        `  Updated ${res1.affectedRows} rows in kz_records_partitioned`,
      );
    } else {
      const [[cnt]] = await conn.query(
        `SELECT COUNT(*) as cnt FROM kz_records_partitioned r
         INNER JOIN kz_players p ON p.id = r.player_id
         WHERE r.steamid64 != p.steamid64`,
      );
      console.log(
        `  [DRY] Would update ${cnt.cnt} rows in kz_records_partitioned`,
      );
    }

    // 6. Sync kz_player_map_pbs steamid64
    console.log("\n[6/6] Syncing kz_player_map_pbs steamid64...");
    if (!DRY_RUN) {
      const [res2] = await conn.query(
        `UPDATE kz_player_map_pbs pb
         INNER JOIN kz_players p ON p.id = pb.player_id
         SET pb.steamid64 = p.steamid64
         WHERE pb.steamid64 != p.steamid64`,
      );
      console.log(`  Updated ${res2.affectedRows} rows in kz_player_map_pbs`);
    } else {
      const [[cnt]] = await conn.query(
        `SELECT COUNT(*) as cnt FROM kz_player_map_pbs pb
         INNER JOIN kz_players p ON p.id = pb.player_id
         WHERE pb.steamid64 != p.steamid64`,
      );
      console.log(`  [DRY] Would update ${cnt.cnt} rows in kz_player_map_pbs`);
    }

    console.log(
      "\nDone! Run POST /admin/refresh-kz-statistics and POST /admin/cache/invalidate after this.",
    );
  } finally {
    conn.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
