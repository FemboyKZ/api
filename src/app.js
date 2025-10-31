const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const swaggerUi = require("swagger-ui-express");
const swaggerSpec = require("./config/swagger");
const app = express();

const serversRouter = require("./api/servers");
const serversSteamRouter = require("./api/servers-steam");
const playersRouter = require("./api/players");
const mapsRouter = require("./api/maps");
const healthRouter = require("./api/health");
const historyRouter = require("./api/history");
const adminRouter = require("./api/admin");
const errorHandler = require("./utils/errorHandler");
const logger = require("./utils/logger");

// Trust proxy - only when binding to localhost (behind reverse proxy like Apache, Nginx, etc.)
// This allows Express to read the real client IP from X-Forwarded-For header
const isUsingProxy = process.env.HOST === '127.0.0.1' || process.env.HOST === 'localhost';
if (isUsingProxy) {
  app.set('trust proxy', true);
  logger.info('Trust proxy enabled - running behind reverse proxy');
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

// Rate limiting - 100 requests per 15 minutes per IP
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 100,
  message: { error: "Too many requests, please try again later." },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  // Skip rate limiting in test environment
  skip: () => process.env.NODE_ENV === 'test',
});

app.use("/", limiter);

app.use(express.json());

// API Documentation
app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: "Server API Documentation",
}));

app.use("/servers", serversRouter);
// app.use("/servers-steam", serversSteamRouter);
app.use("/players", playersRouter);
app.use("/maps", mapsRouter);
app.use("/health", healthRouter);
app.use("/history", historyRouter);
app.use("/admin", adminRouter);

app.use(errorHandler);

module.exports = app;
