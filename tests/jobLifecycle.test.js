/**
 * Every start*Job must ship a matching stop, and server.js must call it -
 * otherwise the timer keeps the process alive through gracefulShutdown.
 */
const fs = require("fs");
const path = require("path");

const SERVICES = path.join(__dirname, "..", "src", "services");

// service file -> [start export, stop export]
const JOBS = [
  ["updater.js", "startUpdateLoop", "stopUpdateLoop"],
  [
    "worldRecordsCache.js",
    "startWorldRecordsCacheJob",
    "stopWorldRecordsCacheJob",
  ],
  ["mapsQuery.js", "startGlobalInfoUpdateJob", "stopGlobalInfoUpdateJob"],
  ["crossChat.js", "startChatCleanupJob", "stopChatCleanupJob"],
  ["kzRecordsScraper.js", "startScraperJob", "stopScraperJob"],
  ["kzBanStatus.js", "startBanCleanupJob", "stopBanCleanupJob"],
  ["kzStatistics.js", "startStatisticsJob", "stopStatisticsJobs"],
  ["wrSync.js", "startWorldRecordsSyncJob", "stopWorldRecordsSyncJob"],
  ["playerPBsSync.js", "startPlayerPBsSyncJob", "stopPlayerPBsSyncJob"],
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
