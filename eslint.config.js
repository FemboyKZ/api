const { defineConfig, globalIgnores } = require("eslint/config");

module.exports = defineConfig([
  {
    rules: {
      semi: "error",
      "prefer-const": "error",
    },
  },
  globalIgnores(["coverage/*"]),
]);
