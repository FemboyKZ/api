require("dotenv").config();
const app = require("./app");
const logger = require("./utils/logger");
const { startUpdateLoop } = require("./services/updater");

const port = process.env.PORT || 3000;

app.listen(port, () => {
  logger.info(`Server listening on port ${port}`);
  startUpdateLoop(30 * 1000);
});
