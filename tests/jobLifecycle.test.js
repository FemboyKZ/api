/**
 * Every start*Job must ship a matching stop, and server.js must call it -
 * otherwise the timer keeps the process alive through gracefulShutdown.
 */
const fs = require("fs");
const path = require("path");

const SERVICES = path.join(__dirname, "..", "src", "services");

// service file -> [start export, stop export]
const JOBS = [
  ["servers/updateLoop.js", "startUpdateLoop", "stopUpdateLoop"],
  [
    "kz/worldRecordsCache.js",
    "startWorldRecordsCacheJob",
    "stopWorldRecordsCacheJob",
  ],
  [
    "kz/mapGlobalInfoSync.js",
    "startMapGlobalInfoSyncJob",
    "stopMapGlobalInfoSyncJob",
  ],
  ["comms/chat.js", "startChatCleanupJob", "stopChatCleanupJob"],
  ["kz/recordsScraper.js", "startScraperJob", "stopScraperJob"],
  ["kz/banStatus.js", "startBanCleanupJob", "stopBanCleanupJob"],
  ["kz/statistics.js", "startStatisticsJob", "stopStatisticsJobs"],
  [
    "kz/worldRecordsSync.js",
    "startWorldRecordsSyncJob",
    "stopWorldRecordsSyncJob",
  ],
  ["kz/pbsCache.js", "startPlayerPBsCacheJob", "stopPlayerPBsCacheJob"],
];

describe("background job lifecycle", () => {
  const serverSrc = fs.readFileSync(
    path.join(__dirname, "..", "src", "server.js"),
    "utf8",
  );

  it.each(JOBS)("%s exports both %s and %s", (file, start, stop) => {
    const mod = require(path.join(SERVICES, file));
    expect(typeof mod[start]).toBe("function");
    expect(typeof mod[stop]).toBe("function");
  });

  it.each(JOBS)("server.js calls %s's %s on shutdown", (file, start, stop) => {
    expect(serverSrc).toContain(`${stop}()`);
  });

  it("every service that schedules a job timer can also clear it", () => {
    const offenders = [];
    for (const [file] of JOBS) {
      const src = fs.readFileSync(path.join(SERVICES, file), "utf8");
      const clears =
        src.includes("clearInterval(") || src.includes("clearTimeout(");
      if (!clears) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
