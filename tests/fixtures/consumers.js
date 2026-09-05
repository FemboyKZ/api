/**
 * Locates the game-server plugin sources and extracts the API calls they make.
 *
 * The repos sit beside this one and are not checked out in CI, so callers must handle them being absent.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");

const CONSUMER_SOURCES = [
  path.join(ROOT, "mm-fkz-api", "src", "api.cpp"),
  path.join(ROOT, "mm-fkz-api", "src", "cross_chat.cpp"),
  path.join(ROOT, "sm-fkz-api", "scripting", "fkz-api", "natives.sp"),
  path.join(ROOT, "sm-fkz-api", "scripting", "fkz-api", "chat.sp"),
];

const API_PATH = /^\/(global|local|servers|players|maps|health|chat)/;

// The plugins spell a non-GET call as `"POST", "/path"` on one line;
// every other call goes through a GET helper that takes the path alone.
const WITH_METHOD =
  /"(GET|POST|PUT|DELETE|PATCH)"\s*,\s*"(\/[A-Za-z0-9/:%_.-]+)"/g;
const BARE_PATH = /"(\/[A-Za-z0-9/:%_.-]+)"/g;

/**
 * Sorted {method, path} calls found in the plugin sources, printf placeholders left intact.
 */
function scanConsumerCalls() {
  const byPath = new Map();

  for (const file of CONSUMER_SOURCES) {
    if (!fs.existsSync(file)) continue;
    const src = fs.readFileSync(file, "utf8");

    // Explicit method first, so it wins over the GET default below.
    for (const [, method, p] of src.matchAll(WITH_METHOD)) {
      if (API_PATH.test(p)) byPath.set(p, method);
    }
    for (const [, p] of src.matchAll(BARE_PATH)) {
      if (API_PATH.test(p) && !byPath.has(p)) byPath.set(p, "GET");
    }
  }

  return [...byPath.entries()]
    .map(([p, method]) => ({ method, path: p }))
    .sort(
      (a, b) =>
        a.path.localeCompare(b.path) || a.method.localeCompare(b.method),
    );
}

module.exports = { CONSUMER_SOURCES, scanConsumerCalls };
