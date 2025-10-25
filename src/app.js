const express = require("express");
const app = express();

const serversRouter = require("./api/servers");
const playersRouter = require("./api/players");
const mapsRouter = require("./api/maps");
const errorHandler = require("./utils/errorHandler");

app.use(express.json());

app.use("/api/servers", serversRouter);
app.use("/api/players", playersRouter);
app.use("/api/maps", mapsRouter);

app.use(errorHandler);

module.exports = app;
