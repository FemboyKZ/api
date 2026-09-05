/**
 * Scans @swagger blocks under src/api/; served at /docs from app.js.
 */

const swaggerJsdoc = require("swagger-jsdoc");

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Server API Documentation",
      version: "1.0.0",
      description:
        "Game server monitoring API - tracks CS:GO and CS2 server status, players, and maps",
      contact: {
        name: "API Support",
      },
    },
    servers: [
      {
        url: "http://localhost:3000",
        description: "Development server",
      },
      {
        url: "https://api.femboykz.com",
        description: "Production server",
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "Admin API key as `Authorization: Bearer <key>`",
        },
        apiKeyHeader: {
          type: "apiKey",
          in: "header",
          name: "X-API-Key",
          description: "Admin API key as an `X-API-Key` header",
        },
      },
    },
    tags: [
      {
        name: "Servers",
        description: "Server status and information endpoints",
      },
      {
        name: "Players",
        description: "Player statistics and tracking endpoints",
      },
      {
        name: "Maps",
        description: "Map statistics and playtime endpoints",
      },
      {
        name: "History",
        description: "Historical data and trends endpoints",
      },
      {
        name: "Health",
        description: "Liveness and runtime statistics",
      },
      {
        name: "Chat",
        description: "Cross-server chat relay",
      },
      {
        name: "Admin",
        description: "Operator-only maintenance endpoints",
      },
      {
        name: "Links",
        description: "Player email and Discord account linking",
      },
      {
        name: "VIP",
        description: "VIP status, gift tokens and custom cosmetics",
      },
      {
        name: "Ko-fi",
        description: "Ko-fi donation webhook and transactions",
      },
      {
        name: "KZ Global",
        description:
          "GlobalAPI mirror (gokz records, players, maps, servers, bans)",
      },
      {
        name: "KZ Local",
        description: "CS:GO KZ local server data (128/64 tick)",
      },
      {
        name: "KZ Local CS2",
        description: "CS2 KZ local server data (cs2kz-metamod plugin)",
      },
    ],
  },
  // Path to the API routes with JSDoc comments
  apis: ["./src/api/**/*.js", "./src/app.js"],
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;
