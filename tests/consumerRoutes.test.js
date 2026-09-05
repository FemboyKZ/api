/**
 * Every endpoint the game-server plugins call must still exist.
 *
 * The paths are read straight out of the plugin sources,
 * so renaming a route here without updating mm-fkz-api and sm-fkz-api fails this test.
 *
 * Only 404 is treated as failure: 401/403/500 all prove the route matched.
 */
const fs = require("fs");
const path = require("path");
const request = require("supertest");

const app = require("../src/app");

const CONSUMERS = [
  "../../mm-fkz-api/src/api.cpp",
  "../../mm-fkz-api/src/cross_chat.cpp",
  "../../sm-fkz-api/scripting/fkz-api/natives.sp",
  "../../sm-fkz-api/scripting/fkz-api/chat.sp",
];

/** API paths the plugins build, with printf placeholders filled in. */
function consumerPaths() {
  const found = new Set();
  for (const rel of CONSUMERS) {
    const file = path.join(__dirname, rel);
    if (!fs.existsSync(file)) continue;
    const src = fs.readFileSync(file, "utf8");
    for (const [, literal] of src.matchAll(/"(\/[A-Za-z0-9/:%_.-]+)"/g)) {
      if (!/^\/(global|local|servers|players|maps|health|chat)/.test(literal)) {
        continue;
      }
      // %s and %d are filled by the plugin at call time.
      found.add(literal.replace(/%d/g, "1").replace(/%s/g, "sample"));
    }
  }
  return [...found].sort();
}

const paths = consumerPaths();

describe("routes the plugins depend on", () => {
  it("finds the plugin sources", () => {
    expect(paths.length).toBeGreaterThan(30);
  });

  it.each(paths)("GET %s is routed", async (p) => {
    const res = await request(app).get(p);
    expect(res.status).not.toBe(404);
  });
});
