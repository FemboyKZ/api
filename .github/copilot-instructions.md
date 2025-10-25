# Server API - AI Coding Instructions

## Architecture Overview

This is a game server tracking API built with Express that polls game servers via GameDig and stores status/player/map data in MySQL.

**Data Flow:**

1. `src/server.js` starts the Express app and initiates background update loop (30s interval)
2. `src/services/updater.js` reads `config/servers.json`, queries each server via `serverQuery.js`, and upserts status to MySQL
3. REST API endpoints (`src/api/*`) expose aggregated server/player/map statistics from the database

**Key Components:**

- `src/app.js` - Express app with `/servers`, `/players`, `/maps` routes
- `src/services/updater.js` - Background polling loop that reloads `config/servers.json` on each iteration
- `src/services/serverQuery.js` - GameDig wrapper with CS2 → CSGO type mapping
- `src/db/index.js` - MySQL2 connection pool (promise-based)

## Critical Patterns

### Database Operations

- Use `pool.query()` from `src/db/index.js` (returns `[rows, fields]` tuple)
- Destructure results: `const [rows] = await pool.query(...)`
- All API routes catch errors and return `{ error: "message" }` with 500 status

### Server Configuration

- `config/servers.json` is reloaded on each update loop iteration (hot-reload without restart)
- GameDig type mapping: `counterstrike2` → `csgo` (see `serverQuery.js`)
- Server identity is `ip:port` composite (used as object keys in `/servers` response)

### Response Formats

- `/servers` returns custom format with `playersTotal`, `serversOnline` top-level keys, then server objects keyed by `ip:port`
- API routes use inline error handling (try/catch) instead of next(error) pattern
- Player and map aggregations use `SUM(playtime)` and `GROUP BY`

## Environment & Dependencies

**Required .env variables:**

- `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` (MySQL connection)
- `PORT` (optional, defaults to 3000)

**External Dependencies:**

- `gamedig` - Server query library (3s socket timeout)
- `mysql2/promise` - Database driver (connection pool with 10 max connections)
- `winston` - Logging to console + `app.log` file

## Development Workflow

**Starting the server:**

```bash
node src/server.js
```

**Linting:**

- Uses flat ESLint config (`eslint.config.js`) with semi and prefer-const rules
- No scripts defined in package.json - run linters manually if needed

**Configuration:**

- Copy `config/servers.example.json` to `config/servers.json` before running
- Each server object needs: `ip`, `port`, `game` (e.g., `csgo`, `counterstrike2`)

## Important Notes

- Update loop runs immediately on startup, then every 30 seconds
- Server status uses ON DUPLICATE KEY UPDATE (requires unique index on ip+port)
- GameDig queries timeout at 3s; failed queries mark server status=0
- Logger uses `winston` - prefer `logger.info()` and `logger.error()` over console methods
- No authentication/authorization implemented - endpoints are public
