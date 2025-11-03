# Server API - AI Coding Instructions

## Architecture Overview

This is a game server tracking API built with Express that polls game servers via GameDig and RCON, storing status/player/map data in MySQL/MariaDB with optional Redis caching.

**Data Flow:**

1. `src/server.js` starts the Express app and initiates multiple background jobs:
   - Server polling (30s interval) via `updater.js` - queries all servers **in parallel**
   - Steam avatar fetching (1hr interval) via `steamAvatars.js`
   - Map metadata fetching (6hr interval) via `mapsQuery.js`
2. `src/services/updater.js` reads `config/servers.json`, queries each server via `serverQuery.js` + `rconQuery.js`, and upserts status to MySQL
3. REST API endpoints (`src/api/*`) expose aggregated server/player/map statistics with optional Redis caching
4. WebSocket server broadcasts real-time server status updates to connected clients
5. RCON integration provides Steam IDs, player IPs (private), and extended server metadata

**Key Components:**

- `src/app.js` - Express app with routes: `/servers`, `/players`, `/maps`, `/records`, `/history`, `/health`, `/admin`, `/docs` (Swagger)
- `src/server.js` - HTTP server initialization, background job startup, graceful shutdown handling with signals (SIGTERM, SIGINT)
- `src/services/updater.js` - Background polling loop that reloads `config/servers.json` on each iteration, invalidates cache after **all** updates complete
- `src/services/serverQuery.js` - GameDig wrapper with CS2 → CSGO type mapping
- `src/services/rconQuery.js` - RCON client for Steam IDs, player IPs, extended server metadata (hostname, OS, secure status)
- `src/services/steamAvatars.js` - Fetches Steam profile avatars via Steam Web API, processes 100 players per hour
- `src/services/mapsQuery.js` - Fetches map metadata from GlobalKZ API (CS:GO) and CS2KZ API (CS2)
- `src/services/websocket.js` - Socket.IO server for real-time updates (broadcasts status changes only)
- `src/db/index.js` - MySQL2 connection pool (promise-based, 10 max connections)
- `src/db/redis.js` - Optional Redis client for response caching and pattern-based cache invalidation
- `src/utils/validators.js` - Input validation and map name sanitization (strips workshop paths)
- `src/utils/logger.js` - Winston logger with environment-based configuration
- `src/config/swagger.js` - Swagger/OpenAPI 3.0 configuration for interactive API docs at `/docs`

## Critical Patterns

### Database Operations

- Use `pool.query()` from `src/db/index.js` (returns `[rows, fields]` tuple)
- Destructure results: `const [rows] = await pool.query(...)`
- All API routes catch errors and return `{ error: "message" }` with 500 status
- JSON columns store complex data: `globalInfo` (maps), `players_list` (servers)
- Playtime tracking increments by `UPDATE_INTERVAL_SECONDS` (30 seconds) per cycle

### Server Configuration

- `config/servers.json` is reloaded on each update loop iteration (hot-reload without restart)
- GameDig type mapping: `counterstrike2` → `csgo` (see `serverQuery.js`)
- Server identity is `ip:port` composite (used as object keys in `/servers` response)
- Server metadata includes: `region`, `domain`, `maxplayers`, `players_list` JSON array, `apiId` (CS2), `kztId` (CS:GO), `tickrate` (CS:GO)
- API identifiers: `apiId` for CS2KZ API server identification, `kztId` for GlobalKZ API server identification

### RCON Integration Patterns

- **CS:GO servers**: Execute `status` command to get Steam IDs (SteamID2 format → converted to SteamID64)
- **CS2 servers**: Execute both `status` (metadata + connection times) and `css_status` (custom CounterStrike Sharp plugin for Steam IDs)
  - Players matched between commands using normalized names for time correlation
  - `css_status` format: `slot playername steamid64 ip ping`
- RCON failures gracefully fallback to GameDig basic data (map, player count only)
- Player IPs collected via RCON but stripped from API responses for privacy (stored in `player_ips` table)
- RCON timeout: 5 seconds (configured in `rconQuery.js`)
- Extended server data from RCON: `hostname`, `os`, `secure` (VAC status), `bot_count`

### Response Formats

- `/servers` returns custom format with `playersTotal`, `serversOnline` top-level keys, then server objects keyed by `ip:port`
- API routes use inline error handling (try/catch) instead of next(error) pattern
- Player and map aggregations use `SUM(playtime)` and `GROUP BY` with game-specific separation
- Pagination format: `{ data: [...], pagination: { page, limit, total, totalPages } }`

### Caching Strategy

- Redis caching is optional (enabled via `REDIS_ENABLED=true`)
- Cache middleware uses key generators for consistent cache keys
- Cache invalidation after data updates: `invalidateCache('cache:servers:*')`
- TTL varies by endpoint: 30s (servers/players/maps), 60s (history), 300s (trends)
- Cache keys include query params: `cache:{endpoint}:{param1}:{param2}:...`

### Background Jobs

- All background services export `start{Name}Job(intervalMs)` functions
- Jobs run immediately on startup, then on interval
- Steam avatars: Batch processes 100 players per hour, 24-hour cache duration
- Map metadata: Processes ALL maps needing updates (no limit), 7-day cache duration
- Server updates: Queries servers **in parallel** via `Promise.all()`, invalidates cache once after **all** updates complete
- Update loop interval stored in `UPDATE_INTERVAL_SECONDS` global for playtime calculations

## Environment & Dependencies

**Required .env variables:**

- `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` (MySQL connection)
- `PORT` (optional, defaults to 3000)
- `HOST` (optional, use `127.0.0.1` with reverse proxy for security)

**Optional .env variables:**

- `STEAM_API_KEY` - Required for Steam avatar fetching and Steam Master Server queries
- `GOKZ_API_URL` - GlobalKZ API for CS:GO map metadata (default: `https://kztimerglobal.com/api/v2`)
- `CS2KZ_API_URL` - CS2KZ API for CS2 map metadata (default: `https://api.cs2kz.org/`)
- `REDIS_ENABLED` - Enable Redis caching (`true`/`false`, default: `false`)
- `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, `REDIS_DB` - Redis connection
- `CORS_ORIGIN` - Comma-separated allowed origins or `*`
- `RATE_LIMIT_MAX` - Max requests per 15-min window (default: 100)
- `NODE_ENV` - `production` or `development` (affects logging verbosity)

**External Dependencies:**

- `gamedig` - Server query library (3s socket timeout)
- `mysql2/promise` - Database driver (connection pool with 10 max connections)
- `winston` - Logging to console + `app.log` file
- `axios` - HTTP client for external APIs (Steam, GOKZ, CS2KZ)
- `socket.io` - WebSocket server for real-time updates
- `redis` - Optional caching layer
- `express-rate-limit` - Rate limiting middleware

## API Endpoints

### Core Endpoints

- `GET /servers` - List all servers with filters (game, status) - returns custom format with `playersTotal`, `serversOnline`, then server objects keyed by `ip:port`
- `GET /servers/:ip` - Individual server details by IP (may return multiple servers on different ports)
- `GET /players` - Player leaderboards with pagination (page, limit, sort, order, game, name filters)
- `GET /players/:steamid` - Individual player profile with game-specific stats
- `GET /maps` - Map statistics with filters (game, server, name, pagination)
- `GET /maps/:mapname` - Individual map details

### Additional Endpoints

- `GET /history/servers/:ip/:port` - Server historical data with player count trends
- `GET /history/players/:steamid` - Player historical playtime data
- `GET /history/maps` - Map popularity trends across servers
- `GET /history/trends/daily` - Daily player trends aggregated
- `GET /history/trends/hourly` - Hourly player trends for last 24 hours
- `GET /health` - Health check endpoint (database connectivity)
- `POST /admin/cache/invalidate` - Manual cache invalidation (requires auth header)
- `POST /admin/aggregate-daily` - Trigger manual daily aggregation
- `POST /admin/cleanup-history` - Remove old historical records (configurable days)

**Note:** `/servers-steam` endpoint exists but is currently commented out in `app.js`

## Development Workflow

**Starting the server:**

```bash
node src/server.js
```

**Running tests:**

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run test:coverage # Generate coverage report
```

**Linting:**

- Uses flat ESLint config (`eslint.config.js`) with semi and prefer-const rules
- Run: `npx eslint .`

**Configuration:**

- Copy `config/servers.example.json` to `config/servers.json` before running
- Each server object needs: `ip`, `port`, `game` (e.g., `csgo`, `counterstrike2`)
- Copy `.env.example` to `.env` and configure required variables

**Database Setup:**

```bash
# Create database and schema
mysql -u root -p < db/schema.sql

# Optional: Load seed data for testing
mysql -u root -p csmonitor < db/seed.sql
```

## Important Notes

### Performance & Reliability

- Update loop runs immediately on startup, then every 30 seconds
- Server status uses ON DUPLICATE KEY UPDATE (requires unique index on ip+port)
- GameDig queries timeout at 3s; failed queries mark server status=0
- Redis caching reduces database load for frequently accessed data
- WebSocket broadcasts limited to status changes only (prevents spam)

### Data Integrity

- Playtime stored in **seconds** (not minutes or hours)
- Playtime increments by 30 seconds per update cycle
- Player/map separation by game type (`csgo` vs `counterstrike2`)
- SteamID64 format for player identification (starts with 7656119...)
- Bot players have NULL steamid and are excluded from leaderboards

### Security & Best Practices

- Trust proxy only enabled when `HOST=localhost` or `127.0.0.1`
- Rate limiting applied to all endpoints (configurable)
- Input validation via `validators.js` (sanitizeString, isValidIP, isValidPort)
- Environment validation on startup via `envValidator.js`
- Graceful shutdown handling (closes Redis, DB, HTTP server in order)
- No authentication/authorization implemented - add before production use

### External API Integration

- **Steam Web API**: Used for avatar fetching and Master Server queries
  - Endpoint: `GetPlayerSummaries/v2` (avatars)
  - Rate limited to 100 players per hour to stay within limits
  - 24-hour cache to minimize API calls
- **GlobalKZ API (CS:GO)**: Fetches CS:GO map metadata
  - Endpoint: `/maps/name/{mapname}`
  - Data: workshop_url, difficulty, filesize, validated, created_on, updated_on, download_url, id
  - 7-day cache, processes ALL maps needing updates (no limit)
- **CS2KZ API (CS2)**: Fetches CS2 map metadata
  - Endpoint: `/maps/{mapname}`
  - Data: workshop_id, mappers (array), description, checksum, approved_at, courses (array), created_at, updated_at, id
  - Mappers stored as array of objects: `[{name: "Joee", id: 123}, ...]`
  - Courses stored as array with filters and difficulty per course
  - 7-day cache, processes ALL maps needing updates (no limit)

### Logging

- Logger uses `winston` - prefer `logger.info()` and `logger.error()` over console methods
- Production mode: Errors to console, info/debug to files
- Development mode: Verbose console logging with colors
- Log levels: error, warn, info, http, debug

### Code Quality

- Jest for unit testing with >80% coverage target
- Excludes `src/server.js` and `src/services/updater.js` from coverage (configured in `jest.config.js`)
- Swagger/OpenAPI documentation available at `/docs` endpoint
- ESLint for code style enforcement (flat config in `eslint.config.js`)
- Structured error handling with try/catch blocks

## Docker & Production Deployment

**Multi-stage Dockerfile:**

- Uses Node.js 22 Alpine for minimal image size
- Non-root user (`nodejs:nodejs`) for security
- `dumb-init` for proper signal handling (SIGTERM/SIGINT)
- Health check via `/health` endpoint
- Logs directory created with proper permissions

**Docker Compose Stack:**

- MySQL 8.0 with auto-initialization from `db/schema.sql` and `db/seed.sql`
- Redis 7 Alpine for caching (optional but recommended)
- API service with health checks and dependency ordering
- Volume mounts: `./config` (read-only), `./logs` (read-write)
- Default ports: 3000 (API), 3306 (MySQL), 6379 (Redis)

**Common Commands:**

```bash
# Development
npm run dev              # Nodemon with auto-reload

# Testing
npm test                 # Run all tests with coverage
npm run test:watch       # Watch mode for development
npm run test:ci          # CI mode (limited workers)

# Docker
npm run docker:compose        # Start all services
npm run docker:compose:down   # Stop all services
npm run docker:compose:logs   # View API logs
```

## Database Migrations

**Migration Pattern:**

- Located in `db/migrations/` with descriptive filenames
- Applied manually via `mysql -u user -p database < db/migrations/filename.sql`
- Common migration types:
  - Adding game-specific columns with deduplication (`add_game_to_players_with_dedup.sql`)
  - Adding server metadata (`add_server_details.sql`, `add_region_domain_to_servers.sql`)
  - Historical tracking (`add_historical_tables.sql`, `add_player_history_tracking.sql`)
  - Data cleanup (`sanitize_map_names.sql`, `fix_playtime_historical_data.sql`)

**Key Migration Examples:**

- `add_game_to_players_with_dedup.sql` - Adds `game` column with composite unique key, handles existing duplicates
- `add_player_history_tracking.sql` - Separates name/IP history into dedicated tables
- `add_players_list.sql` - Adds JSON column for storing RCON player data

## Environment & Configuration Validation

**Startup Sequence (src/server.js):**

1. Load `.env` via `dotenv.config()`
2. Validate required environment variables via `validateEnvironment()` (fails fast on missing vars)
3. Initialize database with retry logic
4. Initialize Redis (optional, logs warning if fails)
5. Create HTTP server for Socket.IO
6. Initialize WebSocket server
7. Start HTTP listener
8. Launch background jobs (updater, Steam avatars)

**Graceful Shutdown:**

- Handles SIGTERM/SIGINT signals
- 30-second timeout before forced exit
- Shutdown order: Redis → Database → HTTP server
- Logs each step for debugging

**Error Handling Philosophy:**

- `uncaughtException` and `unhandledRejection` log but don't exit (stateless API, process manager restarts)
- Known safe exceptions: RCON packet decoder errors, network timeouts, third-party library issues
- Comment in code explains when to enable shutdown on exceptions (cascading failures, memory leaks)
