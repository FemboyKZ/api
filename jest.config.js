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
};
