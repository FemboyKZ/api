# server-api

FKZ API for tracking game servers - A robust server tracking API that polls game servers via GameDig and stores status, player, and map data in MySQL.

## Features

- Real-time game server monitoring via GameDig
- Player tracking and statistics
- Map playtime analytics
- Automatic polling at 30-second intervals
- RESTful API with filtering, pagination, and sorting
- Input validation and error handling
- Rate limiting and CORS protection

## Prerequisites

- Node.js (v14 or higher)
- MySQL/MariaDB database
- Game servers to monitor (CS:GO, CS2, etc.)

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

## Usage

Start the server:

```bash
node src/server.js
```

The API will be available at `http://localhost:3000` (or your configured PORT).

## API Documentation

### Base URL

```txt
http://localhost:3000/api
```

---

### Servers

#### Get All Servers

```http
GET /api/servers
```

**Query Parameters:**

- `game` (optional) - Filter by game type (e.g., `csgo`, `counterstrike2`)
- `status` (optional) - Filter by status (0 = offline, 1 = online)

**Example Request:**

```bash
curl http://localhost:3000/api/servers?game=counterstrike2
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
    "version": "1.0.0"
  }
}
```

#### Get Servers by IP

```http
GET /api/servers/:ip
```

**Parameters:**

- `ip` (required) - Server IP address

**Example Request:**

```bash
curl http://localhost:3000/api/servers/1.2.3.4
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

#### Get All Players

```http
GET /api/players
```

**Query Parameters:**

- `page` (optional, default: 1) - Page number
- `limit` (optional, default: 10, max: 100) - Results per page
- `sort` (optional, default: `total_playtime`) - Sort field (`total_playtime`, `steamid`)
- `order` (optional, default: `desc`) - Sort order (`asc`, `desc`)
- `name` (optional) - Filter by player name (partial match)

**Example Request:**

```bash
curl "http://localhost:3000/api/players?page=1&limit=20&sort=total_playtime&order=desc"
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

#### Get Player by SteamID

```http
GET /api/players/:steamid
```

**Parameters:**

- `steamid` (required) - Player's SteamID (SteamID64, SteamID3, or SteamID2 format)

**Example Request:**

```bash
curl http://localhost:3000/api/players/76561198012345678
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

#### Get All Maps

```http
GET /api/maps
```

**Query Parameters:**

- `page` (optional, default: 1) - Page number
- `limit` (optional, default: 10, max: 100) - Results per page
- `sort` (optional, default: `total_playtime`) - Sort field (`total_playtime`, `name`)
- `order` (optional, default: `desc`) - Sort order (`asc`, `desc`)
- `server` (optional) - Filter by server (format: `ip:port`)
- `name` (optional) - Filter by map name (partial match)

**Example Request:**

```bash
curl "http://localhost:3000/api/maps?page=1&limit=10&sort=total_playtime"
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
GET /api/health
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
GET /api/stats
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
    "game": "counterstrike2"
  }
]
```

**Supported Games:**

- `csgo` - Counter-Strike: Global Offensive
- `counterstrike2` - Counter-Strike 2 (automatically mapped to csgo query type)
- Any game type supported by [GameDig](https://github.com/gamedig/node-gamedig#games-list)

### Update Interval

The default polling interval is 30 seconds. To change this, modify `src/server.js`:

```javascript
startUpdateLoop(30 * 1000); // 30 seconds
```

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

- `servers` - Server status and information
- `players` - Player activity and playtime
- `maps` - Map playtime statistics

---

## License

See LICENSE file for details.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request
