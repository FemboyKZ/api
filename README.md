# server-api

FKZ API for tracking game servers - A robust server tracking API that polls game servers via GameDig and RCON, storing detailed status, player, and map data in MySQL.

## API Documentation

Interactive API documentation is available at `/docs` when the server is running:

- **Local**: http://localhost:3000/docs
- **Production**: https://api.femboy.kz/docs

The documentation is automatically generated from JSDoc comments in the code using Swagger/OpenAPI 3.0.

### Available Endpoints

- `GET /servers` - List all servers
- `GET /servers/:ip` - Get server by IP
- `GET /players` - List all players with pagination
- `GET /players/:steamid` - Get player by Steam ID
- `GET /maps` - List all maps with pagination
- `GET /health` - Health check endpoint

## Features

- **Real-time game server monitoring** via GameDig
- **RCON integration** for detailed player data including Steam IDs (CS:GO and CS2)
- **Player tracking and statistics** with Steam ID support
- **Map playtime analytics** separated by game type
- **Parallel server queries** for fast updates across multiple servers
- **Automatic polling** at 30-second intervals
- **RESTful API** with filtering, pagination, and sorting
- **Per-game statistics** - Player and map data separated by CS:GO vs CS2
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
- Extended server information (hostname, OS, secure status)
- Bot count tracking
- Server owner Steam ID

## Usage

Start the server:

```bash
node src/server.js
```

The API will be available at `http://localhost:3000` (or your configured PORT).

The server will:
- Query all configured servers in parallel every 30 seconds
- Use GameDig for basic server info (status, map, player count)
- Use RCON (if configured) for detailed player data with Steam IDs
- Store historical data for players, maps, and server status
- Automatically detect CS:GO vs CS2 based on version number

## API Documentation

### Base URL

```txt
http://localhost:3000/api
```

---

### Servers

### List All Servers

```http
GET /servers
```

**Query Parameters:**

- `game` (optional) - Filter by game type (e.g., `csgo`, `counterstrike2`)
- `status` (optional) - Filter by status (0 = offline, 1 = online)

**Example Request:**

```bash
curl http://localhost:3000/servers?game=counterstrike2
```

**Example Response:**

```json
{
  "playersTotal": 45,
  "serversOnline": 3,
  "1.2.3.4:27015": {
    "ip": "1.2.3.4",
    "port": 27015,
    "game": "counterstrike2",
    "status": 1,
    "map": "de_dust2",
    "players": 15,
    "maxplayers": 20,
    "version": "1.41.1.7",
    "hostname": "My CS2 Server",
    "os": "Linux",
    "secure": true,
    "steamid": "85568392932669237",
    "botCount": 0,
    "playersList": [
      {
        "name": "PlayerName",
        "steamid": "85568392932669237",
        "time": "12:34",
        "ping": 45,
        "loss": 0,
        "state": "active",
        "bot": false
      }
    ]
  }
}
```

#### Get Servers by IP

```http
GET /servers/:ip
```

**Parameters:**

- `ip` (required) - Server IP address

**Example Request:**

```bash
curl http://localhost:3000/servers/1.2.3.4
```

**Example Response:**

```json
[
  {
    "id": 1,
    "ip": "1.2.3.4",
    "port": 27015,
    "game": "counterstrike2",
    "status": 1,
    "map": "de_dust2",
    "player_count": 15,
    "version": "1.0.0",
    "last_update": "2025-10-25T10:30:00.000Z"
  }
]
```

---

### Players

### List All Players

```http
GET /players
```

**Query Parameters:**

- `page` (optional, default: 1) - Page number
- `limit` (optional, default: 10, max: 100) - Results per page
- `sort` (optional, default: `total_playtime`) - Sort field (`total_playtime`, `steamid`)
- `order` (optional, default: `desc`) - Sort order (`asc`, `desc`)
- `name` (optional) - Filter by player name (partial match)
- `game` (optional) - Filter by game type (`csgo`, `counterstrike2`)

**Note:** Player statistics are separated by game type. A player's CS:GO and CS2 playtime are tracked independently.

**Example Request:**

```bash
curl "http://localhost:3000/players?page=1&limit=20&sort=total_playtime&order=desc"
```

**Example Response:**

```json
{
  "data": [
    {
      "steamid": "76561198012345678",
      "total_playtime": 36000
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "totalPages": 8
  }
}
```

#### Get Player Details

```http
GET /players/:steamid
```

**Parameters:**

- `steamid` (required) - Player's SteamID (SteamID64, SteamID3, or SteamID2 format)

**Example Request:**

```bash
curl http://localhost:3000/players/76561198012345678
```

**Example Response:**

```json
{
  "steamid": "76561198012345678",
  "total_playtime": 36000,
  "last_seen": "2025-10-25T10:30:00.000Z",
  "sessions": [
    {
      "id": 1,
      "steamid": "76561198012345678",
      "name": "PlayerName",
      "playtime": 3600,
      "server_ip": "37.27.107.76",
      "server_port": 27015,
      "last_seen": "2025-10-25T10:30:00.000Z"
    }
  ]
}
```

---

### Maps

### List All Maps

```http
GET /maps
```

**Query Parameters:**

- `page` (optional, default: 1) - Page number
- `limit` (optional, default: 10, max: 100) - Results per page
- `sort` (optional, default: `total_playtime`) - Sort field (`total_playtime`, `name`)
- `order` (optional, default: `desc`) - Sort order (`asc`, `desc`)
- `server` (optional) - Filter by server (format: `ip:port`)
- `name` (optional) - Filter by map name (partial match)
- `game` (optional) - Filter by game type (`csgo`, `counterstrike2`)

**Note:** Map statistics are separated by game type. The same map played on CS:GO and CS2 servers has separate playtime tracking.

**Example Request:**

```bash
curl "http://localhost:3000/maps?page=1&limit=10&sort=total_playtime"
```

**Example Response:**

```json
{
  "data": [
    {
      "name": "de_dust2",
      "total_playtime": 120000
    },
    {
      "name": "de_mirage",
      "total_playtime": 95000
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 45,
    "totalPages": 5
  }
}
```

---

### Health & Stats

#### Health Check

```http
GET /health
```

**Example Response:**

```json
{
  "status": "ok",
  "timestamp": "2025-10-25T10:30:00.000Z",
  "database": "connected"
}
```

#### API Statistics

```http
GET /stats
```

**Example Response:**

```json
{
  "servers": {
    "total": 20,
    "online": 15,
    "offline": 5
  },
  "players": {
    "total": 1250,
    "active_24h": 320
  },
  "maps": {
    "total": 45
  },
  "uptime": 86400
}
```

---

## Error Responses

All endpoints return errors in the following format:

```json
{
  "error": "Error message description"
}
```

**Common HTTP Status Codes:**

- `200` - Success
- `400` - Bad Request (invalid input)
- `404` - Not Found
- `500` - Internal Server Error

---

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
- Server hostname, OS, and security status
- Server owner Steam ID
- Bot count
- Extended player details (connection time, ping, packet loss)

**CS2 vs CS:GO Detection:**

The system automatically detects CS2 vs CS:GO based on the server version:
- CS:GO: version 1.38.x.x
- CS2: version 1.40.x.x or higher

For CS2 servers, the `status_json` RCON command is used to retrieve Steam IDs.

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
├── config/           # Server configuration files
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

### Logging

Logs are written to:

- Console (all levels)
- `app.log` file (info and error levels)

### Database Schema

See `db/schema.sql` for the complete database structure. Main tables:

- `servers` - Server status and information (includes RCON data: hostname, os, secure, steamid, bot_count)
- `players` - Player activity and playtime (separated by game with unique constraint on steamid+game)
- `maps` - Map playtime statistics (separated by game with unique constraint on name+game)
- `server_history` - Historical snapshots of server status
- `player_sessions` - Player join/leave tracking with Steam IDs
- `map_history` - Map rotation tracking with player count metrics

**Key Features:**

- Players and maps use composite unique keys (steamid+game, name+game) for per-game statistics
- JSON storage for players_list with automatic parsing
- Session tracking requires RCON for Steam IDs

---

## License

See LICENSE file for details.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request
