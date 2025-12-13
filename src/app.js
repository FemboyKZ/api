const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const swaggerUi = require("swagger-ui-express");
const swaggerSpec = require("./config/swagger");
const compression = require("compression");
const app = express();

const serversRouter = require("./api/servers");
const playersRouter = require("./api/players");
const mapsRouter = require("./api/maps");
const healthRouter = require("./api/health");
const historyRouter = require("./api/history");
const adminRouter = require("./api/admin");
const kzRecordsRouter = require("./api/kzRecords");
const kzPlayersRouter = require("./api/kzPlayers");
const kzMapsRouter = require("./api/kzMaps");
const kzServersRouter = require("./api/kzServers");
const kzBansRouter = require("./api/kzBans");
const kzLocalRouter = require("./api/kzLocal");
const kzLocalCS2Router = require("./api/kzLocalCS2");
const errorHandler = require("./utils/errorHandler");
const logger = require("./utils/logger");
const {
  adminAuth,
  shouldSkipRateLimit,
  apiKeyMiddleware,
} = require("./utils/auth");

// Trust proxy - only when binding to localhost (behind reverse proxy like Apache, Nginx, etc.)
// This allows Express to read the real client IP from X-Forwarded-For header
const isUsingProxy =
  process.env.HOST === "127.0.0.1" || process.env.HOST === "localhost";
if (isUsingProxy) {
  app.set("trust proxy", true);
  logger.info("Trust proxy enabled - running behind reverse proxy");
}

// CORS configuration
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "*",
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

// Request logging middleware
app.use((req, res, next) => {
  const startTime = Date.now();
  res.on("finish", () => {
    logger.logRequest(req, res, Date.now() - startTime);
  });
  next();
});

// Body parsing - must come before compression
app.use(express.json());

// Response compression - compress responses > 1KB
// Place before rate limiting so rate limiter sees compressed response sizes
app.use(
  compression({
    level: 6,
    threshold: 1024, // Only compress responses > 1KB
    filter: (req, res) => {
      if (req.headers["x-no-compression"]) {
        return false;
      }
      return compression.filter(req, res);
    },
  }),
);

// Rate limiting - 500 requests per 5 minutes per IP
// Skips rate limiting for authenticated requests (API key, IP whitelist, localhost in dev)
const limiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 500,
  message: { error: "Too many requests, please try again later." },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  validate: { trustProxy: false },
  // Skip rate limiting in test environment or for authenticated requests
  skip: (req) => process.env.NODE_ENV === "test" || shouldSkipRateLimit(req),
});

app.use("/", limiter);

// API Key middleware - sets req.apiAuth for authenticated requests
app.use(apiKeyMiddleware);

// API Documentation
app.use(
  "/docs",
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, {
    customCss: ".swagger-ui .topbar { display: none }",
    customSiteTitle: "Server API Documentation",
  }),
);

app.use("/servers", serversRouter);
app.use("/players", playersRouter);
app.use("/maps", mapsRouter);
app.use("/health", healthRouter);
app.use("/history", historyRouter);
app.use("/admin", adminAuth, adminRouter);

// KZ Global endpoints
app.use("/kzglobal/records", kzRecordsRouter);
app.use("/kzglobal/players", kzPlayersRouter);
app.use("/kzglobal/maps", kzMapsRouter);
app.use("/kzglobal/servers", kzServersRouter);
app.use("/kzglobal/bans", kzBansRouter);

// KZ Local endpoints (CSGO 128/64 tick servers)
app.use("/kzlocal", kzLocalRouter);

// KZ Local CS2 endpoints (CS2 servers)
app.use("/kzlocal-cs2", kzLocalCS2Router);

app.use(errorHandler);

module.exports = app;
