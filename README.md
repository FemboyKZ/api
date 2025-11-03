# server-api

FKZ API for tracking game servers - A robust server tracking API that polls game servers via GameDig and RCON, storing detailed status, player, and map data in MySQL.

## API Documentation

Interactive API documentation is available at `/docs` when the server is running:

- **Local**: [localhost:3000/docs](http://localhost:3000/docs)
- **Production**: [api.femboy.kz/docs](https://api.femboy.kz/docs)

The documentation is automatically generated from JSDoc comments in the code using Swagger/OpenAPI 3.0.

### Available Endpoints

- `GET /servers` - List all servers
- `GET /servers/:ip` - Get server by IP
- `GET /players` - List all players with pagination
- `GET /players/:steamid` - Get player by Steam ID
- `GET /maps` - List all maps with pagination
- `GET /health` - Health check endpoint

## Features

- **Real-time game server monitoring** via GameDig and RCON
- **RCON integration** for detailed player data including Steam IDs (CS:GO and CS2)
- **Player tracking and statistics** with Steam ID support and name history
- **Map playtime analytics** separated by game type
- **Parallel server queries** for fast updates across multiple servers
- **Automatic polling** at 30-second intervals
- **RESTful API** with filtering, pagination, and sorting
- **Per-game statistics** - Player and map data separated by CS:GO vs CS2
- **Player history tracking** - All names and IPs used by each player (IPs private)
- **Interactive API documentation** at `/docs` using Swagger/OpenAPI
- **Reverse proxy support** with proper client IP detection
- **Production-ready logging** with file rotation and environment-based levels
- Input validation and error handling
- Rate limiting and CORS protection

## Prerequisites

- Node.js (v14 or higher)
- MySQL/MariaDB database
- Game servers to monitor (CS:GO, CS2, etc.)
- RCON access to servers (optional, for Steam IDs and extended data)

## Installation

1. Clone the repository:

   ```bash
   git clone <repository-url>
   cd server-api
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Create your environment configuration:

   ```bash
   cp .env.example .env
   ```

4. Configure your `.env` file:

   ```env
   DB_HOST=localhost
   DB_USER=your_db_user
   DB_PASSWORD=your_db_password
   DB_NAME=your_db_name
   PORT=3000
   ```

5. Set up the database:

   ```bash
   # Run the schema SQL file in your MySQL database
   mysql -u your_user -p your_database < db/schema.sql
   ```

6. Configure servers to monitor:

```bash
cp config/servers.example.json config/servers.json
# Edit config/servers.json with your server list
```

**Server Configuration Format:**

```json
[
  {
    "ip": "37.27.107.76",
    "port": 27015,
    "game": "csgo",
    "rconPort": 27015,
    "rconPassword": "your_rcon_password"
  },
  {
    "ip": "169.150.198.105",
    "port": 25126,
    "game": "counterstrike2",
    "rconPort": 25126,
    "rconPassword": "your_rcon_password"
  }
]
```

**Note:** RCON configuration is optional but highly recommended for:

- Steam ID tracking (required for player statistics)
- Player IP tracking (private, for moderation)
- Player name history tracking
- Extended server information (hostname, OS, secure status)
- Bot count tracking

Without RCON, you'll only get basic server status (map, player count) without individual player data.

## Usage

### Starting the Server

Start the server:

```bash
node src/server.js
```

The API will be available at `http://localhost:3000` (or your configured PORT).

### How it Works

The server will:

- Query all configured servers in parallel every 30 seconds
- Use RCON (if configured) for detailed player data with Steam IDs
- Fall back to GameDig for basic server info if RCON is unavailable
- Store historical data for players, maps, and server status
- Track all player names and IPs (IPs kept private)
- Automatically detect CS:GO vs CS2 based on version number (1.40+ = CS2)

### Production Configuration

For production deployment behind Apache/Nginx:

1. Set `HOST=127.0.0.1` in `.env` to bind only to localhost
2. Set `NODE_ENV=production` for optimized logging
3. Configure reverse proxy with `X-Forwarded-For` header
4. The app automatically trusts proxy headers for correct client IP logging

## Configuration

### Server Configuration

Edit `config/servers.json` to add or remove servers to monitor:

```json
[
  {
    "ip": "37.27.107.76",
    "port": 27015,
    "game": "csgo",
    "rconPort": 27015,
    "rconPassword": "your_rcon_password"
  },
  {
    "ip": "169.150.198.105",
    "port": 25126,
    "game": "counterstrike2",
    "rconPort": 25126,
    "rconPassword": "your_rcon_password"
  }
]
```

**Configuration Fields:**

- `ip` (required) - Server IP address
- `port` (required) - Server game port
- `game` (required) - Game type identifier
- `rconPort` (optional) - RCON port (often same as game port)
- `rconPassword` (optional) - RCON password for authentication

**Supported Games:**

- `csgo` - Counter-Strike: Global Offensive
- `counterstrike2` - Counter-Strike 2 (automatically mapped to csgo query type for GameDig)
- Any game type supported by [GameDig](https://github.com/gamedig/node-gamedig#games-list)

**RCON Benefits:**

When RCON is configured, the API can retrieve:

- Player Steam IDs (required for player tracking)
- Player IP addresses (collected privately, not exposed)
- Player connection time, ping, and packet loss statistics
- Server hostname, OS, and VAC security status
- Bot count
- Complete player name history

Without RCON, only basic GameDig data is available (server status, map, player count).

**CS2 vs CS:GO Detection:**

The system automatically detects CS2 vs CS:GO based on the server version:

- CS:GO: version 1.38.x.x
- CS2: version 1.40.x.x or higher

For CS2 servers, the custom plugin `css_status` RCON command is used to retrieve Steam IDs.

### Update Interval

The default polling interval is 30 seconds. All servers are queried in parallel for fast updates.

To change the interval, modify `src/server.js`:

```javascript
startUpdateLoop(30 * 1000); // 30 seconds
```

**Performance:**

With parallel queries, update time is determined by the slowest server response, not the total number of servers:

- 10 servers × 3 seconds each = ~3 seconds total (parallel)
- vs. ~30 seconds if sequential

---

## Development

### Project Structure

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

### Privacy & Security

**Player IP Addresses:**

- Collected from RCON for administrative/moderation purposes
- Stored in `player_ips` table with complete history
- **Never exposed** through public API endpoints
- Automatically stripped from `playersList` before API response
- Only accessible via direct database access

**Rate Limiting:**

- 100 requests per 15 minutes per IP (configurable via `RATE_LIMIT_MAX`)
- Applies to all endpoints

**Input Validation:**

- All inputs sanitized and validated
- SQL injection protection via parameterized queries
- Steam ID format validation (supports SteamID64, SteamID3, SteamID2)

---

## License

See LICENSE file for details.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request
