/**
 * Guards the generated OpenAPI spec.
 */
const fs = require("fs");
const path = require("path");

const spec = require("../src/config/swagger");

const API_DIR = path.join(__dirname, "..", "src", "api");

function routerFiles(dir, prefix = "") {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory())
      return routerFiles(path.join(dir, entry.name), rel);
    return entry.name.endsWith(".js") ? [rel] : [];
  });
}

const files = routerFiles(API_DIR);

describe("swagger spec", () => {
  it("documents every route in every router", () => {
    const gaps = files
      .map((file) => {
        const src = fs.readFileSync(path.join(API_DIR, file), "utf8");
        const routes = (
          src.match(/^router\.(get|post|put|delete|patch)\(/gm) || []
        ).length;
        const blocks = (src.match(/@swagger/g) || []).length;
        return { file, routes, blocks };
      })
      .filter(({ routes, blocks }) => routes > 0 && blocks < routes);

    expect(gaps).toEqual([]);
  });

  it("every tag used is declared", () => {
    const declared = new Set((spec.tags || []).map((t) => t.name));
    const used = new Set();
    for (const item of Object.values(spec.paths || {})) {
      for (const op of Object.values(item)) {
        (op.tags || []).forEach((t) => used.add(t));
      }
    }
    expect([...used].filter((t) => !declared.has(t))).toEqual([]);
  });

  it("every declared security scheme exists", () => {
    const schemes = new Set(
      Object.keys(spec.components?.securitySchemes || {}),
    );
    const referenced = new Set();
    for (const item of Object.values(spec.paths || {})) {
      for (const op of Object.values(item)) {
        for (const entry of op.security || []) {
          Object.keys(entry).forEach((k) => referenced.add(k));
        }
      }
    }
    expect([...referenced].filter((k) => !schemes.has(k))).toEqual([]);
  });

  it("keeps the KZ paths in the spec", () => {
    const paths = Object.keys(spec.paths || {});
    expect(paths.filter((p) => p.startsWith("/global")).length).toBeGreaterThan(
      20,
    );
    expect(paths.filter((p) => p.startsWith("/local")).length).toBeGreaterThan(
      15,
    );
  });
});
