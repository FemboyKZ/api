module.exports = {
  testEnvironment: "node",
  coverageDirectory: "coverage",
  collectCoverageFrom: [
    "src/**/*.js",
    "!src/server.js",
    "!src/services/updater.js",
  ],
  testMatch: ["**/tests/**/*.test.js"],
  setupFiles: ["<rootDir>/tests/setup.js"],
  testTimeout: 10000,
  verbose: true,
  // db/kzRecords, db/kzLocal and db/redis are not mocked in tests/setup.js,
  // so requiring them opens real pools at module load that never close.
  // TODO: fix
  forceExit: true,
};
