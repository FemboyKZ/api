/**
 * Validate KZ Records JSON files for data integrity issues
 * Identifies records with missing/invalid required fields
 *
 * Usage: node scripts/validate-kz-records.js <json-file-or-directory>
 * Example: node scripts/validate-kz-records.js ./raw
 */

const fs = require("fs");
const path = require("path");

// Track which files have errors
const filesWithErrors = new Set();

// Track unique entities - use more efficient storage
const uniqueEntities = {
  players: new Set(), // steamid64
  servers: new Set(), // server_id
  maps: new Set(), // map_name
  minRecordId: Infinity,
  maxRecordId: -Infinity,
  totalRecordIds: 0,
  uniqueRecordIdCount: 0, // Approximate count using HyperLogLog-like approach
  duplicateCount: 0,
  lastSeenId: null,
  duplicateExamples: [], // Store only first 100 duplicates
};

// For tracking duplicates - store only samples
const recordIdSamples = new Map();
const MAX_DUPLICATE_SAMPLES = 100;

// Validation results
const validationResults = {
  totalRecords: 0,
  totalFiles: 0,
  validRecords: 0,
  invalidRecords: 0,
  errors: {
    missingPlayerName: [],
    missingSteamId: [],
    missingSteamId64: [],
    missingMapName: [],
    missingServerName: [],
    missingServerId: [],
    missingMode: [],
    invalidTime: [],
    invalidTeleports: [],
    invalidPoints: [],
    missingCreatedOn: [],
    other: [],
  },
};

/**
 * Validate a single record
 */
function validateRecord(record, fileIndex, recordIndex) {
  const errors = [];
  const recordInfo = {
    file: fileIndex,
    index: recordIndex,
    preview: {
      id: record.id || "N/A",
      player: record.player_name || "N/A",
      map: record.map_name || "N/A",
      server: record.server_name || "N/A",
      steamid64: record.steamid64 || "N/A",
    },
  };

  // Track unique entities
  if (record.steamid64) {
    uniqueEntities.players.add(record.steamid64.toString());
  }
  if (record.server_id !== null && record.server_id !== undefined) {
    uniqueEntities.servers.add(record.server_id.toString());
  }
  if (record.map_name && record.map_name.trim() !== "") {
    uniqueEntities.maps.add(record.map_name.trim());
  }
  if (record.id !== null && record.id !== undefined) {
    // Track min/max for range
    if (record.id < uniqueEntities.minRecordId) {
      uniqueEntities.minRecordId = record.id;
    }
    if (record.id > uniqueEntities.maxRecordId) {
      uniqueEntities.maxRecordId = record.id;
    }

    uniqueEntities.totalRecordIds++;

    // Sample-based duplicate detection to avoid memory issues
    if (recordIdSamples.has(record.id)) {
      uniqueEntities.duplicateCount++;

      // Store only first N duplicate examples
      if (uniqueEntities.duplicateExamples.length < MAX_DUPLICATE_SAMPLES) {
        const existingCount = recordIdSamples.get(record.id);
        recordIdSamples.set(record.id, existingCount + 1);

        const existing = uniqueEntities.duplicateExamples.find(
          (d) => d.id === record.id,
        );
        if (existing) {
          existing.count = existingCount + 1;
        } else {
          uniqueEntities.duplicateExamples.push({ id: record.id, count: 2 });
        }
      }
    } else {
      recordIdSamples.set(record.id, 1);
      uniqueEntities.uniqueRecordIdCount++;

      // Clear old samples periodically to prevent memory issues
      if (recordIdSamples.size > 1000000) {
        // Keep only recent samples
        const idsToKeep = Array.from(recordIdSamples.keys()).slice(-500000);
        recordIdSamples.clear();
        idsToKeep.forEach((id) => recordIdSamples.set(id, 1));
      }
    }
  }

  // Check player fields
  if (!record.player_name || record.player_name.trim() === "") {
    errors.push("missing_player_name");
    validationResults.errors.missingPlayerName.push({
      ...recordInfo,
      value: record.player_name,
    });
  }

  if (!record.steam_id || record.steam_id.trim() === "") {
    errors.push("missing_steam_id");
    validationResults.errors.missingSteamId.push({
      ...recordInfo,
      value: record.steam_id,
    });
  }

  if (!record.steamid64 || isNaN(record.steamid64)) {
    errors.push("missing_steamid64");
    validationResults.errors.missingSteamId64.push({
      ...recordInfo,
      value: record.steamid64,
    });
  }

  // Check map fields
  if (!record.map_name || record.map_name.trim() === "") {
    errors.push("missing_map_name");
    validationResults.errors.missingMapName.push({
      ...recordInfo,
      value: record.map_name,
    });
  }

  // Check server fields
  if (!record.server_name || record.server_name.trim() === "") {
    errors.push("missing_server_name");
    validationResults.errors.missingServerName.push({
      ...recordInfo,
      value: record.server_name,
    });
  }

  if (record.server_id === null || record.server_id === undefined) {
    errors.push("missing_server_id");
    validationResults.errors.missingServerId.push({
      ...recordInfo,
      value: record.server_id,
    });
  }

  // Check mode
  if (!record.mode || record.mode.trim() === "") {
    errors.push("missing_mode");
    validationResults.errors.missingMode.push({
      ...recordInfo,
      value: record.mode,
    });
  }

  // Check time (should be positive number)
  if (record.time === null || record.time === undefined || record.time < 0) {
    errors.push("invalid_time");
    validationResults.errors.invalidTime.push({
      ...recordInfo,
      value: record.time,
    });
  }

  // Check teleports (should be non-negative)
  if (
    record.teleports === null ||
    record.teleports === undefined ||
    record.teleports < 0
  ) {
    errors.push("invalid_teleports");
    validationResults.errors.invalidTeleports.push({
      ...recordInfo,
      value: record.teleports,
    });
  }

  // Check points (should be non-negative)
  if (
    record.points === null ||
    record.points === undefined ||
    record.points < 0
  ) {
    errors.push("invalid_points");
    validationResults.errors.invalidPoints.push({
      ...recordInfo,
      value: record.points,
    });
  }

  // Check created_on timestamp
  if (!record.created_on) {
    errors.push("missing_created_on");
    validationResults.errors.missingCreatedOn.push({
      ...recordInfo,
      value: record.created_on,
    });
  }

  return errors;
}

/**
 * Validate a single JSON file
 */
function validateFile(filePath, fileIndex) {
  console.log(`\nValidating: ${path.basename(filePath)}`);
  console.log("=".repeat(60));

  try {
    const jsonData = fs.readFileSync(filePath, "utf8");
    const records = JSON.parse(jsonData);

    console.log(`Found ${records.length.toLocaleString()} records`);
    validationResults.totalRecords += records.length;

    let fileValidCount = 0;
    let fileInvalidCount = 0;

    records.forEach((record, index) => {
      const errors = validateRecord(record, fileIndex, index);

      if (errors.length === 0) {
        fileValidCount++;
        validationResults.validRecords++;
      } else {
        fileInvalidCount++;
        validationResults.invalidRecords++;
        // Mark this file as having errors
        filesWithErrors.add(filePath);
      }
    });

    console.log(`✓ Valid records: ${fileValidCount.toLocaleString()}`);
    console.log(`✗ Invalid records: ${fileInvalidCount.toLocaleString()}`);
  } catch (error) {
    console.error(`Error reading file: ${error.message}`);
    validationResults.errors.other.push({
      file: filePath,
      error: error.message,
    });
    filesWithErrors.add(filePath);
  }
}

/**
 * Validate directory of JSON files
 */
function validateDirectory(dirPath) {
  const files = fs
    .readdirSync(dirPath)
    .filter((file) => file.endsWith(".json"))
    .sort((a, b) => {
      // Sort numerically if filenames are numbers
      const numA = parseInt(a.replace(".json", ""));
      const numB = parseInt(b.replace(".json", ""));
      if (!isNaN(numA) && !isNaN(numB)) {
        return numA - numB;
      }
      return a.localeCompare(b);
    });

  validationResults.totalFiles = files.length;
  console.log(`Found ${files.length} JSON files in ${dirPath}`);

  files.forEach((file, index) => {
    const filePath = path.join(dirPath, file);
    validateFile(filePath, index);
  });
}

/**
 * Analyze record IDs for gaps and duplicates
 */
function analyzeRecordIds() {
  const analysis = {
    totalIds: uniqueEntities.totalRecordIds,
    uniqueIds: uniqueEntities.uniqueRecordIdCount,
    duplicates: uniqueEntities.duplicateCount,
    duplicateIds: uniqueEntities.duplicateExamples,
    gaps: [], // Gap detection disabled for large datasets
  };

  // Check if we have any IDs
  if (uniqueEntities.uniqueRecordIdCount === 0) {
    return analysis;
  }

  const minId = uniqueEntities.minRecordId;
  const maxId = uniqueEntities.maxRecordId;
  analysis.minId = minId;
  analysis.maxId = maxId;
  analysis.range = maxId - minId + 1;
  analysis.coverage = (
    (uniqueEntities.uniqueRecordIdCount / analysis.range) *
    100
  ).toFixed(2);

  // Sort duplicates by count (highest first)
  analysis.duplicateIds.sort((a, b) => b.count - a.count);

  // Note: Gap detection is disabled for large datasets to prevent memory issues
  // The range and coverage statistics give you a good indication of gaps
  const estimatedMissingIds =
    analysis.range - uniqueEntities.uniqueRecordIdCount;
  analysis.estimatedGaps = estimatedMissingIds;

  return analysis;
}

/**
 * Print validation summary
 */
function printSummary() {
  console.log("\n" + "=".repeat(60));
  console.log("VALIDATION SUMMARY");
  console.log("=".repeat(60));
  console.log(
    `Total files processed: ${validationResults.totalFiles.toLocaleString()}`,
  );
  console.log(
    `Total records: ${validationResults.totalRecords.toLocaleString()}`,
  );
  console.log(
    `Valid records: ${validationResults.validRecords.toLocaleString()} (${((validationResults.validRecords / validationResults.totalRecords) * 100).toFixed(2)}%)`,
  );
  console.log(
    `Invalid records: ${validationResults.invalidRecords.toLocaleString()} (${((validationResults.invalidRecords / validationResults.totalRecords) * 100).toFixed(2)}%)`,
  );

  console.log("\n" + "-".repeat(60));
  console.log("UNIQUE ENTITIES:");
  console.log("-".repeat(60));
  console.log(
    `Unique players (steamid64): ${uniqueEntities.players.size.toLocaleString()}`,
  );
  console.log(
    `Unique servers (server_id): ${uniqueEntities.servers.size.toLocaleString()}`,
  );
  console.log(
    `Unique maps (map_name): ${uniqueEntities.maps.size.toLocaleString()}`,
  );

  console.log("\n" + "-".repeat(60));
  console.log("RECORD ID ANALYSIS:");
  console.log("-".repeat(60));

  const idAnalysis = analyzeRecordIds();
  console.log(
    `Total record IDs processed: ${idAnalysis.totalIds.toLocaleString()}`,
  );
  console.log(`Unique record IDs: ${idAnalysis.uniqueIds.toLocaleString()}`);
  console.log(`Duplicate IDs found: ${idAnalysis.duplicates.toLocaleString()}`);

  if (idAnalysis.minId !== undefined) {
    console.log(
      `ID range: ${idAnalysis.minId.toLocaleString()} to ${idAnalysis.maxId.toLocaleString()}`,
    );
    console.log(`Expected IDs in range: ${idAnalysis.range.toLocaleString()}`);
    console.log(`Coverage: ${idAnalysis.coverage}% of range`);
    console.log(
      `Estimated missing IDs (gaps): ${idAnalysis.estimatedGaps.toLocaleString()}`,
    );
  }

  // Note about gap detection
  console.log(`\nℹ Note: Detailed gap detection disabled for large datasets.`);
  console.log(`  Use coverage percentage to estimate data completeness.`);

  if (idAnalysis.duplicateIds.length > 0) {
    console.log(
      `\nDuplicate IDs (showing first ${Math.min(20, idAnalysis.duplicateIds.length)}):`,
    );
    idAnalysis.duplicateIds.slice(0, 20).forEach((dup, idx) => {
      console.log(
        `  ${idx + 1}. ID ${dup.id.toLocaleString()}: appears ${dup.count} times`,
      );
    });
    if (idAnalysis.duplicateIds.length > 20) {
      console.log(
        `  ... and ${idAnalysis.duplicateIds.length - 20} more duplicates`,
      );
    }
    if (idAnalysis.duplicates > idAnalysis.duplicateIds.length) {
      console.log(
        `  (Showing sample of ${idAnalysis.duplicateIds.length} duplicate IDs out of ${idAnalysis.duplicates} total duplicates)`,
      );
    }
  } else {
    console.log("\n✓ No duplicate IDs found - all IDs are unique");
  }

  console.log("\n" + "-".repeat(60));
  console.log("ERROR BREAKDOWN:");
  console.log("-".repeat(60));

  const errorTypes = [
    { key: "missingPlayerName", label: "Missing player_name" },
    { key: "missingSteamId", label: "Missing steam_id" },
    { key: "missingSteamId64", label: "Missing steamid64" },
    { key: "missingMapName", label: "Missing map_name" },
    { key: "missingServerName", label: "Missing server_name" },
    { key: "missingServerId", label: "Missing server_id" },
    { key: "missingMode", label: "Missing mode" },
    { key: "invalidTime", label: "Invalid time" },
    { key: "invalidTeleports", label: "Invalid teleports" },
    { key: "invalidPoints", label: "Invalid points" },
    { key: "missingCreatedOn", label: "Missing created_on" },
  ];

  errorTypes.forEach(({ key, label }) => {
    const count = validationResults.errors[key].length;
    if (count > 0) {
      console.log(`${label}: ${count.toLocaleString()}`);
    }
  });

  if (validationResults.errors.other.length > 0) {
    console.log(`Other errors: ${validationResults.errors.other.length}`);
  }
}

/**
 * Print detailed error examples
 */
function printErrorExamples(limit = 5) {
  console.log("\n" + "=".repeat(60));
  console.log("ERROR EXAMPLES (first " + limit + " of each type):");
  console.log("=".repeat(60));

  const errorTypes = [
    { key: "missingPlayerName", label: "Missing player_name" },
    { key: "missingSteamId", label: "Missing steam_id" },
    { key: "missingSteamId64", label: "Missing steamid64" },
    { key: "missingMapName", label: "Missing map_name" },
    { key: "missingServerName", label: "Missing server_name" },
    { key: "missingServerId", label: "Missing server_id" },
    { key: "missingMode", label: "Missing mode" },
    { key: "invalidTime", label: "Invalid time" },
    { key: "invalidTeleports", label: "Invalid teleports" },
    { key: "invalidPoints", label: "Invalid points" },
    { key: "missingCreatedOn", label: "Missing created_on" },
  ];

  errorTypes.forEach(({ key, label }) => {
    const errors = validationResults.errors[key];
    if (errors.length > 0) {
      console.log(`\n${label} (${errors.length} total):`);
      errors.slice(0, limit).forEach((error, idx) => {
        console.log(
          `  ${idx + 1}. File ${error.file}, Record ${error.index}, ID: ${error.preview.id}`,
        );
        console.log(
          `     Player: ${error.preview.player} (SteamID64: ${error.preview.steamid64})`,
        );
        console.log(
          `     Map: ${error.preview.map}, Server: ${error.preview.server}`,
        );
        console.log(`     Value: ${JSON.stringify(error.value)}`);
      });
      if (errors.length > limit) {
        console.log(`     ... and ${errors.length - limit} more`);
      }
    }
  });
}

/**
 * Export detailed error report to JSON
 */
function exportErrorReport(outputPath) {
  const idAnalysis = analyzeRecordIds();

  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      totalFiles: validationResults.totalFiles,
      totalRecords: validationResults.totalRecords,
      validRecords: validationResults.validRecords,
      invalidRecords: validationResults.invalidRecords,
      errorPercentage: (
        (validationResults.invalidRecords / validationResults.totalRecords) *
        100
      ).toFixed(2),
    },
    uniqueEntities: {
      uniquePlayers: uniqueEntities.players.size,
      uniqueServers: uniqueEntities.servers.size,
      uniqueMaps: uniqueEntities.maps.size,
    },
    recordIdAnalysis: {
      totalIds: idAnalysis.totalIds,
      uniqueIds: idAnalysis.uniqueIds,
      duplicateCount: idAnalysis.duplicates,
      minId: idAnalysis.minId,
      maxId: idAnalysis.maxId,
      range: idAnalysis.range,
      coverage: idAnalysis.coverage,
      estimatedGaps: idAnalysis.estimatedGaps,
      duplicateIdSamples: idAnalysis.duplicateIds,
    },
    errorCounts: {
      missingPlayerName: validationResults.errors.missingPlayerName.length,
      missingSteamId: validationResults.errors.missingSteamId.length,
      missingSteamId64: validationResults.errors.missingSteamId64.length,
      missingMapName: validationResults.errors.missingMapName.length,
      missingServerName: validationResults.errors.missingServerName.length,
      missingServerId: validationResults.errors.missingServerId.length,
      missingMode: validationResults.errors.missingMode.length,
      invalidTime: validationResults.errors.invalidTime.length,
      invalidTeleports: validationResults.errors.invalidTeleports.length,
      invalidPoints: validationResults.errors.invalidPoints.length,
      missingCreatedOn: validationResults.errors.missingCreatedOn.length,
    },
    errors: validationResults.errors,
  };

  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(`\n✓ Detailed error report saved to: ${outputPath}`);
}

/**
 * Copy files with errors to a separate directory
 */
function copyFilesWithErrors(outputDir) {
  if (filesWithErrors.size === 0) {
    console.log("\n✓ No files with errors to copy");
    return;
  }

  // Create output directory if it doesn't exist
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log(
    `\nCopying ${filesWithErrors.size} files with errors to: ${outputDir}`,
  );

  let copiedCount = 0;
  filesWithErrors.forEach((filePath) => {
    const fileName = path.basename(filePath);
    const destPath = path.join(outputDir, fileName);

    try {
      fs.copyFileSync(filePath, destPath);
      copiedCount++;
      console.log(`  ✓ Copied: ${fileName}`);
    } catch (error) {
      console.error(`  ✗ Failed to copy ${fileName}: ${error.message}`);
    }
  });

  console.log(
    `\n✓ Successfully copied ${copiedCount}/${filesWithErrors.size} files`,
  );
}

// Main execution
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error(
      "Usage: node validate-kz-records.js <json-file-or-directory> [--export-report] [--copy-errors <output-dir>]",
    );
    console.error("Example: node validate-kz-records.js ./raw");
    console.error("Example: node validate-kz-records.js ./raw --export-report");
    console.error(
      "Example: node validate-kz-records.js ./raw --copy-errors ./raw-errors",
    );
    console.error(
      "Example: node validate-kz-records.js ./raw --export-report --copy-errors ./raw-errors",
    );
    process.exit(1);
  }

  const inputPath = args[0];
  const exportReport = args.includes("--export-report");
  const copyErrorsIndex = args.indexOf("--copy-errors");
  const copyErrorsDir =
    copyErrorsIndex !== -1 ? args[copyErrorsIndex + 1] : null;

  // Check if path exists
  if (!fs.existsSync(inputPath)) {
    console.error(`Error: Path not found: ${inputPath}`);
    process.exit(1);
  }

  console.log("KZ Records Data Validator");
  console.log("=".repeat(60));

  // Check if it's a directory or file
  const stats = fs.statSync(inputPath);

  if (stats.isDirectory()) {
    validateDirectory(inputPath);
  } else {
    validationResults.totalFiles = 1;
    validateFile(inputPath, 0);
  }

  // Print results
  printSummary();
  printErrorExamples(5);

  // Export detailed report if requested
  if (exportReport) {
    const reportPath = path.join(
      process.cwd(),
      `kz-validation-report-${Date.now()}.json`,
    );
    exportErrorReport(reportPath);
  }

  // Copy files with errors if requested
  if (copyErrorsDir) {
    copyFilesWithErrors(copyErrorsDir);
  }

  // Exit with error code if invalid records found
  process.exit(validationResults.invalidRecords > 0 ? 1 : 0);
}

module.exports = {
  validateRecord,
  validateFile,
  validateDirectory,
  validationResults,
};
