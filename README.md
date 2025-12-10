# FKZ API

For tracking game servers, players and more.

## API Documentation

Interactive API documentation is available at `/docs` when the server is running:

- **Production**: [api.femboy.kz/docs](https://api.femboy.kz/docs)

The documentation is automatically generated from JSDoc comments in the code using Swagger/OpenAPI 3.0.

## Prerequisites

- Node.js (v20 or higher)
- MySQL/MariaDB database
- Game servers to monitor (CS:GO, CS2, etc.)
- RCON access to servers (optional, for Steam IDs and extended data)
- Docker is recommended

## Project Structure

```txt
server-api/
├── config/          # Server configuration files
├── db/              # Database schemas and migrations
├── src/
│   ├── api/         # API route handlers
│   ├── db/          # Database connection
│   ├── services/    # Business logic (updater, queries)
│   ├── utils/       # Utilities (logger, validators, error handling)
│   ├── app.js       # Express app configuration
│   └── server.js    # Server entry point
└── package.json
```

## License

See LICENSE file for details.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request
