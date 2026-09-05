/**
 * Keeps the services tree from drifting back into a flat pile.
 *
 * Every service belongs to exactly one folder, and the folder supplies the
 * context - so a file inside kz/ should not repeat "kz" in its own name.
 */
const fs = require("fs");
const path = require("path");

const SERVICES = path.join(__dirname, "..", "src", "services");
const FOLDERS = ["servers", "kz", "vip", "comms"];

const entries = fs.readdirSync(SERVICES, { withFileTypes: true });

describe("services layout", () => {
  it("has only the agreed folders at the top level", () => {
    const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    expect(dirs.sort()).toEqual([...FOLDERS].sort());
  });

  it("keeps no loose service files outside a folder", () => {
    const loose = entries
      .filter((e) => e.isFile() && e.name.endsWith(".js"))
      .map((e) => e.name);
    expect(loose).toEqual([]);
  });

  it("does not repeat the folder name in a filename", () => {
    const stutter = [];
    for (const folder of FOLDERS) {
      for (const file of fs.readdirSync(path.join(SERVICES, folder))) {
        if (file.toLowerCase().startsWith(folder.toLowerCase())) {
          stutter.push(`${folder}/${file}`);
        }
      }
    }
    expect(stutter).toEqual([]);
  });

  it("every service is required by something", () => {
    const orphans = [];
    for (const folder of FOLDERS) {
      for (const file of fs.readdirSync(path.join(SERVICES, folder))) {
        const base = file.replace(/\.js$/, "");
        // Siblings import as "./name"; everything else as ".../folder/name".
        const referenced =
          isRequiredAs(`/${base}"`) || isRequiredAs(`"./${base}"`);
        if (!referenced) orphans.push(`${folder}/${file}`);
      }
    }
    expect(orphans).toEqual([]);
  });
});

/** True when any file under src/ has a require ending in the given fragment. */
function isRequiredAs(needle) {
  const stack = [path.join(__dirname, "..", "src")];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.name.endsWith(".js")) {
        if (fs.readFileSync(full, "utf8").includes(needle)) return true;
      }
    }
  }
  return false;
}
