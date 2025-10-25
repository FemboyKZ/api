const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const app = express();

const serversRouter = require("./api/servers");
const playersRouter = require("./api/players");
const mapsRouter = require("./api/maps");
const healthRouter = require("./api/health");
const errorHandler = require("./utils/errorHandler");

// CORS configuration
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "*",
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

// Rate limiting - 100 requests per 15 minutes per IP
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 100,
  message: { error: "Too many requests, please try again later." },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

app.use("/api/", limiter);

app.use(express.json());

app.use("/api/servers", serversRouter);
app.use("/api/players", playersRouter);
app.use("/api/maps", mapsRouter);
app.use("/api/health", healthRouter);

app.use(errorHandler);

module.exports = app;
