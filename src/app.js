/**
 * Middleware order matters: body parsing before compression,
 * compression before rate limiting so the limiter sees compressed sizes, errorHandler last.
 *
 * adminAuth is applied at mount time for /servers/status, /admin and /chat;
 * /kofi, /links and /vip apply it per-route instead.
 */

const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const swaggerUi = require("swagger-ui-express");
const swaggerSpec = require("./config/swagger");
const compression = require("compression");
const app = express();

const serverStatusRouter = require("./api/serverStatus");
const serversRouter = require("./api/servers");
const playersRouter = require("./api/players");
const mapsRouter = require("./api/maps");
const healthRouter = require("./api/health");
const historyRouter = require("./api/history");
const adminRouter = require("./api/admin");
const globalRecordsRouter = require("./api/global/records");
const globalPlayersRouter = require("./api/global/players");
const globalMapsRouter = require("./api/global/maps");
const globalServersRouter = require("./api/global/servers");
const globalBansRouter = require("./api/global/bans");
const localGokzRouter = require("./api/local/gokz");
const localCs2kzRouter = require("./api/local/cs2kz");
const chatRouter = require("./api/chat");
const kofiRouter = require("./api/kofi");
const linksRouter = require("./api/links");
const vipRouter = require("./api/vip");
const errorHandler = require("./utils/errorHandler");
const logger = require("./utils/logger");
const {
  adminAuth,
  shouldSkipRateLimit,
  apiKeyMiddleware,
  TRUST_PROXY,
  TRUST_PROXY_HOPS,
} = require("./utils/auth");

// Hop count rather than `true`, which would trust client-prepended X-Forwarded-For entries.
// See TRUST_PROXY_HOPS in utils/auth.js.
if (TRUST_PROXY) {
  app.set("trust proxy", TRUST_PROXY_HOPS);
  logger.info(
    `Trust proxy enabled - running behind ${TRUST_PROXY_HOPS} reverse proxy hop(s)`,
  );
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

app.use("/servers/status", adminAuth, serverStatusRouter);
app.use("/servers", serversRouter);
app.use("/players", playersRouter);
app.use("/maps", mapsRouter);
app.use("/health", healthRouter);
app.use("/history", historyRouter);
app.use("/admin", adminAuth, adminRouter);

app.use("/chat", adminAuth, chatRouter);

// Ko-fi webhooks + donation tracking (router applies adminAuth per-route,
// the public /kofi/webhook is verified by Ko-fi's verification_token)
app.use("/kofi", kofiRouter);

// Player contact linking (email verification + discord), private/admin-authed
app.use("/links", linksRouter);

// VIP status, gift-token redemption, self-serve custom role/tag (admin-authed)
app.use("/vip", vipRouter);

// GlobalAPI mirror (gokz)
app.use("/global/records", globalRecordsRouter);
app.use("/global/players", globalPlayersRouter);
app.use("/global/maps", globalMapsRouter);
app.use("/global/servers", globalServersRouter);
app.use("/global/bans", globalBansRouter);

// Local timer databases, one per game
app.use("/local/gokz", localGokzRouter);
app.use("/local/cs2kz", localCs2kzRouter);

app.use(errorHandler);

module.exports = app;
