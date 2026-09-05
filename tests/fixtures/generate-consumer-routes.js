#!/usr/bin/env node
/**
 * Regenerates consumer-routes.json from the plugin sources.
 *
 * Run after changing an API path in mm-fkz-api or sm-fkz-api, on a machine with both repos checked out beside this one.
 */
const fs = require("fs");
const path = require("path");

const { CONSUMER_SOURCES, scanConsumerCalls } = require("./consumers");

const missing = CONSUMER_SOURCES.filter((f) => !fs.existsSync(f));
if (missing.length) {
  console.error("Plugin sources not found:");
  for (const f of missing) console.error("  " + f);
  process.exit(1);
}

const calls = scanConsumerCalls();
const out = path.join(__dirname, "consumer-routes.json");
fs.writeFileSync(out, JSON.stringify(calls, null, 2) + "\n");
console.log(
  `wrote ${calls.length} calls to ${path.relative(process.cwd(), out)}`,
);
