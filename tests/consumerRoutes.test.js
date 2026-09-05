/**
 * Every endpoint the game-server plugins call must still exist.
 *
 * fixtures/consumer-routes.json is the committed record of those calls,
 * so this runs in CI where mm-fkz-api and sm-fkz-api are not checked out.
 * When those repos are present beside this one, a second test re-reads them and fails if the record has drifted.
 * Regenerate with:
 *   node tests/fixtures/generate-consumer-routes.js
 *
 * Only 404 counts as failure: 401/403/500 all prove the route matched.
 */
const fs = require("fs");
const path = require("path");
const request = require("supertest");

const app = require("../src/app");
const { CONSUMER_SOURCES, scanConsumerCalls } = require("./fixtures/consumers");

const recorded = require("./fixtures/consumer-routes.json");

/** Plugins substitute these at call time. */
const concrete = (p) => p.replace(/%d/g, "1").replace(/%s/g, "sample");

describe("routes the plugins depend on", () => {
  it("has a non-empty recorded call list", () => {
    expect(recorded.length).toBeGreaterThan(30);
  });

  it.each(recorded.map((c) => [c.method, c.path]))(
    "%s %s is routed",
    async (method, p) => {
      const res = await request(app)[method.toLowerCase()](concrete(p));
      expect(res.status).not.toBe(404);
    },
  );
});

const sourcesPresent = CONSUMER_SOURCES.every((f) => fs.existsSync(f));

// Only meaningful on a machine with the plugin repos checked out beside this one.
const describeIfSources = sourcesPresent ? describe : describe.skip;

describeIfSources("recorded calls match the plugin sources", () => {
  it("is in step with mm-fkz-api and sm-fkz-api", () => {
    expect(scanConsumerCalls()).toEqual(recorded);
  });
});

if (!sourcesPresent) {
  const missing = CONSUMER_SOURCES.filter((f) => !fs.existsSync(f)).map((f) =>
    path.basename(f),
  );
  console.log(
    `[consumerRoutes] plugin sources not found (${missing.join(", ")}), ` +
      "drift check skipped; the recorded calls were still verified.",
  );
}
