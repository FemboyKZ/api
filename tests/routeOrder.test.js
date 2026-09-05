// Express matches in registration order,
// so a parameterised route registered before a static sibling makes the static one unreachable.

const fs = require("fs");
const path = require("path");

const API_DIR = path.join(__dirname, "..", "src", "api");

function routesOf(file) {
  const source = fs.readFileSync(path.join(API_DIR, file), "utf8");
  return [
    ...source.matchAll(/router\.(get|post|put|delete)\(\s*"([^"]+)"/g),
  ].map(([, method, route]) => ({ method, route }));
}

/** Routes that can never be reached because an earlier one swallows them. */
function shadowedRoutes(file) {
  const shadowed = [];
  const seen = [];

  for (const { method, route } of routesOf(file)) {
    const segments = route.replace(/^\/|\/$/g, "").split("/");
    const isStatic = (s) => !s.startsWith(":");

    for (const earlier of seen) {
      if (earlier.method !== method) continue;
      const earlierSegments = earlier.route.replace(/^\/|\/$/g, "").split("/");
      if (earlierSegments.length !== segments.length) continue;
      // Only a route with a wildcard segment can swallow a more specific one.
      if (earlierSegments.every(isStatic)) continue;

      const swallows = earlierSegments.every(
        (seg, i) => !isStatic(seg) || seg === segments[i],
      );
      if (swallows && segments.some(isStatic)) {
        shadowed.push(`${method.toUpperCase()} ${route} <- ${earlier.route}`);
      }
    }
    seen.push({ method, route });
  }
  return shadowed;
}

/** Router files, including those nested under global/ and local/. */
function apiFilesIn(dir, prefix = "") {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return apiFilesIn(path.join(dir, entry.name), rel);
    return entry.name.endsWith(".js") ? [rel] : [];
  });
}

const apiFiles = apiFilesIn(API_DIR);

describe("route registration order", () => {
  it.each(apiFiles)("%s registers no unreachable routes", (file) => {
    expect(shadowedRoutes(file)).toEqual([]);
  });

  it("keeps /mode-filters ahead of /:mapname", () => {
    const routes = routesOf("global/maps.js").map((r) => r.route);
    expect(routes.indexOf("/mode-filters")).toBeGreaterThan(-1);
    expect(routes.indexOf("/mode-filters")).toBeLessThan(
      routes.indexOf("/:mapname"),
    );
  });

  it("detects shadowing when it is present", () => {
    // Guards the detector itself: without this, an always-empty result would
    // make every assertion above pass vacuously.
    const detect = (routes) => {
      const seen = [];
      const out = [];
      for (const { method, route } of routes) {
        const segs = route.replace(/^\/|\/$/g, "").split("/");
        for (const e of seen) {
          if (e.method !== method) continue;
          const es = e.route.replace(/^\/|\/$/g, "").split("/");
          if (es.length !== segs.length) continue;
          if (es.every((s) => !s.startsWith(":"))) continue;
          if (
            es.every((s, i) => s.startsWith(":") || s === segs[i]) &&
            segs.some((s) => !s.startsWith(":"))
          ) {
            out.push(route);
          }
        }
        seen.push({ method, route });
      }
      return out;
    };

    expect(
      detect([
        { method: "get", route: "/:mapname" },
        { method: "get", route: "/mode-filters" },
      ]),
    ).toEqual(["/mode-filters"]);
  });
});
