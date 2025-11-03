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
        url: "https://api.femboy.kz",
        description: "Production server",
      },
    ],
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
    ],
  },
  // Path to the API routes with JSDoc comments
  apis: ["./src/api/*.js", "./src/app.js"],
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;
