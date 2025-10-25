# Server API Documentation

## Table of Contents

- [Overview](#overview)
- [Authentication](#authentication)
- [Rate Limiting](#rate-limiting)
- [Response Format](#response-format)
- [Error Handling](#error-handling)
- [Endpoints](#endpoints)
  - [Servers](#servers)
  - [Players](#players)
  - [Maps](#maps)
  - [History & Trends](#history--trends)
  - [Health](#health)

---

## Overview

The Server API provides real-time and historical data about game servers, players, and maps. The API polls game servers every 30 seconds and stores status, player, and map information.

**Base URL:** `http://localhost:3000/api`

**Content Type:** `application/json`

**Supported Games:**

- Counter-Strike 2 (`counterstrike2`)
- Counter-Strike: Global Offensive (`csgo`)

---

## Authentication

Currently, the API does not require authentication. All endpoints are publicly accessible.

---

## Rate Limiting

- **Default Limit:** 100 requests per 15 minutes per IP address
- **Configurable:** Set `RATE_LIMIT_MAX` environment variable

**Rate Limit Headers:**

```txt
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 99
X-RateLimit-Reset: 1234567890
```

**Rate Limit Exceeded Response:**

```json
{
  "error": "Too many requests, please try again later."
}
```

---

## Response Format

### Success Response

All successful responses return JSON with appropriate data structure.

```json
{
  "data": {},
  "meta": {}
}
```

### Pagination

Paginated endpoints return:

```json
{
  "page": 1,
  "limit": 10,
  "total": 100,
  "totalPages": 10,
  "data": []
}
```

---

## Error Handling

### Error Response Format

```json
{
  "error": "Error message description"
}
```

### HTTP Status Codes

| Code | Description                                      |
| ---- | ------------------------------------------------ |
| 200  | Success                                          |
| 400  | Bad Request - Invalid parameters                 |
| 404  | Not Found - Resource doesn't exist               |
| 429  | Too Many Requests - Rate limit exceeded          |
| 500  | Internal Server Error                            |
| 503  | Service Unavailable - Database connection failed |

---

## Endpoints

### Servers

#### Get All Servers

```http
GET /servers
```

Returns all tracked servers with their current status.

**Query Parameters:**

| Parameter | Type    | Default | Description                                |
| --------- | ------- | ------- | ------------------------------------------ |
| `game`    | string  | -       | Filter by game type (csgo, counterstrike2) |
| `status`  | integer | 1       | Filter by status (0=offline, 1=online)     |

**Response:**

```json
{
  "playersTotal": 45,
  "serversOnline": 3,
  "37.27.107.76:27015": {
    "ip": "37.27.107.76",
    "port": 27015,
    "game": "counterstrike2",
    "status": 1,
    "map": "de_dust2",
    "players": 12,
    "maxplayers": 32,
    "playersList": [
      {
        "name": "Player1",
        "id": "STEAM_0:1:12345"
      }
    ]
  }
}
```

**Example:**

```bash
curl http://localhost:3000/servers?game=csgo&status=1
```

---

#### Get Server by IP

```http
GET /servers/:ip
```

Returns all servers with the specified IP address.

**Path Parameters:**

| Parameter | Type   | Required | Description                      |
| --------- | ------ | -------- | -------------------------------- |
| `ip`      | string | Yes      | Server IP address (IPv4 or IPv6) |

**Response:**

```json
[
  {
    "id": 1,
    "ip": "37.27.107.76",
    "port": 27015,
    "game": "counterstrike2",
    "status": 1,
    "map": "de_dust2",
    "player_count": 12,
    "maxplayers": 32,
    "version": "1.0.0",
    "last_update": "2025-10-25T12:00:00.000Z"
  }
]
```

**Example:**

```bash
curl http://localhost:3000/servers/37.27.107.76
```

---

### Players

#### Get All Players

```http
GET /players
```

Returns aggregated player statistics.

**Query Parameters:**

| Parameter | Type    | Default  | Description                            |
| --------- | ------- | -------- | -------------------------------------- |
| `page`    | integer | 1        | Page number                            |
| `limit`   | integer | 10       | Results per page (max 100)             |
| `sort`    | string  | playtime | Sort field (playtime, last_seen, name) |
| `order`   | string  | desc     | Sort order (asc, desc)                 |
| `name`    | string  | -        | Search by player name (partial match)  |

**Response:**

```json
{
  "page": 1,
  "limit": 10,
  "total": 150,
  "totalPages": 15,
  "players": [
    {
      "steamid": "76561198000000000",
      "name": "PlayerName",
      "total_playtime": 3600,
      "server_ip": "37.27.107.76",
      "server_port": 27015,
      "last_seen": "2025-10-25T12:00:00.000Z"
    }
  ]
}
```

**Example:**

```bash
curl http://localhost:3000/players?page=1&limit=20&sort=playtime&order=desc
curl http://localhost:3000/players?name=john
```

---

#### Get Player by SteamID

```http
GET /players/:steamid
```

Returns detailed information about a specific player.

**Path Parameters:**

| Parameter | Type   | Required | Description                   |
| --------- | ------ | -------- | ----------------------------- |
| `steamid` | string | Yes      | Player's SteamID (any format) |

**Response:**

```json
{
  "steamid": "76561198000000000",
  "name": "PlayerName",
  "playtime": 3600,
  "server_ip": "37.27.107.76",
  "server_port": 27015,
  "last_seen": "2025-10-25T12:00:00.000Z",
  "created_at": "2025-10-20T10:00:00.000Z"
}
```

**Example:**

```bash
curl http://localhost:3000/players/76561198000000000
curl http://localhost:3000/players/STEAM_0:1:12345
curl http://localhost:3000/players/[U:1:12345]
```

---

### Maps

#### Get All Maps

```http
GET /maps
```

Returns aggregated map statistics.

**Query Parameters:**

| Parameter | Type    | Default  | Description                              |
| --------- | ------- | -------- | ---------------------------------------- |
| `page`    | integer | 1        | Page number                              |
| `limit`   | integer | 10       | Results per page (max 100)               |
| `sort`    | string  | playtime | Sort field (playtime, last_played, name) |
| `order`   | string  | desc     | Sort order (asc, desc)                   |
| `server`  | string  | -        | Filter by server (format: ip:port)       |
| `name`    | string  | -        | Search by map name (partial match)       |

**Response:**

```json
{
  "page": 1,
  "limit": 10,
  "total": 50,
  "totalPages": 5,
  "maps": [
    {
      "name": "de_dust2",
      "total_playtime": 86400,
      "server_ip": "37.27.107.76",
      "server_port": 27015,
      "last_played": "2025-10-25T12:00:00.000Z"
    }
  ]
}
```

**Example:**

```bash
curl http://localhost:3000/maps?page=1&limit=20
curl http://localhost:3000/maps?server=37.27.107.76:27015
curl http://localhost:3000/maps?name=dust
```

---

### History & Trends

#### Get Server History

```http
GET /history/servers/:ip/:port
```

Returns historical data for a specific server.

**Path Parameters:**

| Parameter | Type    | Required | Description       |
| --------- | ------- | -------- | ----------------- |
| `ip`      | string  | Yes      | Server IP address |
| `port`    | integer | Yes      | Server port       |

**Query Parameters:**

| Parameter  | Type    | Default | Description                       |
| ---------- | ------- | ------- | --------------------------------- |
| `hours`    | integer | 24      | Hours of history (max 168)        |
| `interval` | integer | 60      | Data interval in seconds (min 30) |

**Response:**

```json
{
  "server": "37.27.107.76:27015",
  "hours": 24,
  "interval": 60,
  "dataPoints": 144,
  "history": [
    {
      "server_ip": "37.27.107.76",
      "server_port": 27015,
      "status": 1,
      "map": "de_dust2",
      "player_count": 12,
      "maxplayers": 32,
      "recorded_at": "2025-10-25T12:00:00.000Z"
    }
  ]
}
```

**Example:**

```bash
curl http://localhost:3000/history/servers/37.27.107.76/27015?hours=48&interval=120
```

---

#### Get Player Session History

```http
GET /history/players/:steamid
```

Returns session history for a specific player.

**Path Parameters:**

| Parameter | Type   | Required | Description      |
| --------- | ------ | -------- | ---------------- |
| `steamid` | string | Yes      | Player's SteamID |

**Query Parameters:**

| Parameter | Type    | Default | Description      |
| --------- | ------- | ------- | ---------------- |
| `page`    | integer | 1       | Page number      |
| `limit`   | integer | 10      | Results per page |

**Response:**

```json
{
  "steamid": "76561198000000000",
  "page": 1,
  "limit": 10,
  "total": 50,
  "totalPages": 5,
  "sessions": [
    {
      "steamid": "76561198000000000",
      "name": "PlayerName",
      "server_ip": "37.27.107.76",
      "server_port": 27015,
      "joined_at": "2025-10-25T10:00:00.000Z",
      "left_at": "2025-10-25T12:00:00.000Z",
      "duration": 7200
    }
  ]
}
```

**Example:**

```bash
curl http://localhost:3000/history/players/76561198000000000?page=1&limit=20
```

---

#### Get Map History

```http
GET /history/maps
```

Returns map rotation history across all servers.

**Query Parameters:**

| Parameter | Type    | Default | Description                |
| --------- | ------- | ------- | -------------------------- |
| `page`    | integer | 1       | Page number                |
| `limit`   | integer | 10      | Results per page           |
| `server`  | string  | -       | Filter by server (ip:port) |
| `map`     | string  | -       | Search by map name         |

**Response:**

```json
{
  "page": 1,
  "limit": 10,
  "total": 200,
  "totalPages": 20,
  "maps": [
    {
      "id": 1,
      "server_ip": "37.27.107.76",
      "server_port": 27015,
      "map_name": "de_dust2",
      "started_at": "2025-10-25T10:00:00.000Z",
      "ended_at": "2025-10-25T11:00:00.000Z",
      "duration": 3600,
      "player_count_avg": 15,
      "player_count_peak": 24
    }
  ]
}
```

**Example:**

```bash
curl http://localhost:3000/history/maps?server=37.27.107.76:27015
curl http://localhost:3000/history/maps?map=dust2
```

---

#### Get Daily Trends

```http
GET /history/trends/daily
```

Returns daily aggregated statistics.

**Query Parameters:**

| Parameter | Type    | Default | Description                |
| --------- | ------- | ------- | -------------------------- |
| `days`    | integer | 7       | Number of days (max 90)    |
| `server`  | string  | -       | Filter by server (ip:port) |

**Response:**

```json
{
  "days": 7,
  "dataPoints": 21,
  "stats": [
    {
      "stat_date": "2025-10-25",
      "server_ip": "37.27.107.76",
      "server_port": 27015,
      "total_players": 150,
      "unique_players": 45,
      "peak_players": 32,
      "avg_players": 18.5,
      "uptime_minutes": 1440,
      "total_maps_played": 24
    }
  ]
}
```

**Example:**

```bash
curl http://localhost:3000/history/trends/daily?days=30
curl http://localhost:3000/history/trends/daily?server=37.27.107.76:27015
```

---

#### Get Hourly Trends

```http
GET /history/trends/hourly
```

Returns hourly player count trends.

**Query Parameters:**

| Parameter | Type    | Default | Description                |
| --------- | ------- | ------- | -------------------------- |
| `hours`   | integer | 24      | Number of hours (max 168)  |
| `server`  | string  | -       | Filter by server (ip:port) |

**Response:**

```json
{
  "hours": 24,
  "dataPoints": 24,
  "trends": [
    {
      "hour": "2025-10-25 12:00:00",
      "server_ip": "37.27.107.76",
      "server_port": 27015,
      "avg_players": 18.5,
      "peak_players": 28,
      "min_players": 8
    }
  ]
}
```

**Example:**

```bash
curl http://localhost:3000/history/trends/hourly?hours=48
curl http://localhost:3000/history/trends/hourly?server=37.27.107.76:27015
```

---

### Health

#### Health Check

```http
GET /health
```

Returns API health status and database connectivity.

**Response:**

```json
{
  "status": "healthy",
  "timestamp": "2025-10-25T12:00:00.000Z",
  "database": "connected",
  "redis": "connected",
  "websocket": "active",
  "uptime": 86400
}
```

**Example:**

```bash
curl http://localhost:3000/health
```

---

#### Health Statistics

```http
GET /health/stats
```

Returns comprehensive API statistics.

**Response:**

```json
{
  "uptime": 86400,
  "servers": {
    "total": 10,
    "online": 8,
    "offline": 2
  },
  "players": {
    "total": 150,
    "active": 45
  },
  "maps": {
    "total": 50,
    "mostPlayed": "de_dust2"
  },
  "websocket": {
    "clients": 5,
    "rooms": ["server:all", "player:updates"]
  },
  "cache": {
    "enabled": true,
    "hits": 1250,
    "misses": 48
  }
}
```

**Example:**

```bash
curl http://localhost:3000/health/stats
```

---

## WebSocket Real-Time Updates

### Connection

```javascript
const socket = io("http://localhost:3000");
```

### Events

#### Server Update

```javascript
socket.on("server:update", (data) => {
  console.log(data);
  // { ip, port, game, status, map, players, version }
});
```

#### Server Status Change

```javascript
socket.on("server:status", (data) => {
  console.log(data);
  // { ip, port, status, statusChange: 'online'|'offline' }
});
```

#### Player Update

```javascript
socket.on("player:update", (data) => {
  console.log(data);
  // { steamid, name, server }
});
```

#### Map Update

```javascript
socket.on("map:update", (data) => {
  console.log(data);
  // { server, oldMap, newMap }
});
```

### Channel Subscription

```javascript
// Subscribe to specific channels
socket.emit("subscribe", "server:updates");
socket.emit("subscribe", "player:updates");
socket.emit("subscribe", "map:updates");

// Unsubscribe
socket.emit("unsubscribe", "server:updates");
```

---

## Caching

The API uses Redis for caching responses:

- **Servers:** 30 seconds
- **Players:** 30 seconds
- **Maps:** 30 seconds
- **Server History:** 60 seconds
- **Player History:** 60 seconds
- **Daily Trends:** 300 seconds (5 minutes)
- **Hourly Trends:** 60 seconds

Caches are automatically invalidated when server data is updated.

---

## Data Retention

- **Server History:** Unlimited (recommended: cleanup after 30 days)
- **Player Sessions:** Unlimited (recommended: cleanup after 90 days)
- **Map History:** Unlimited (recommended: cleanup after 90 days)
- **Daily Stats:** Unlimited (recommended: cleanup after 1 year)

---

## Best Practices

1. **Use Caching:** Responses are cached - make use of it for better performance
2. **Pagination:** Always use pagination for large datasets
3. **Filtering:** Use query parameters to reduce response size
4. **Rate Limits:** Respect rate limits to avoid being blocked
5. **WebSockets:** Use WebSockets for real-time data instead of polling
6. **Error Handling:** Always check for error responses
7. **Date Ranges:** Limit historical queries to reasonable time ranges

---

## Examples

### JavaScript/Node.js

```javascript
const axios = require("axios");

async function getServers() {
  try {
    const response = await axios.get("http://localhost:3000/servers");
    console.log(response.data);
  } catch (error) {
    console.error("Error:", error.response.data);
  }
}
```

### Python

```python
import requests

def get_servers():
    try:
        response = requests.get('http://localhost:3000/servers')
        response.raise_for_status()
        print(response.json())
    except requests.exceptions.HTTPError as error:
        print(f'Error: {error}')
```

### cURL

```bash
# Get all online servers
curl http://localhost:3000/servers?status=1

# Get server history for the last 48 hours
curl http://localhost:3000/history/servers/37.27.107.76/27015?hours=48

# Get top 20 players by playtime
curl http://localhost:3000/players?limit=20&sort=playtime&order=desc

# Get daily trends for the last 30 days
curl http://localhost:3000/history/trends/daily?days=30
```

---

## Support

For issues or questions:

- Check logs: `logs/error.log`
- Health endpoint: `/health`
- GitHub Issues: (your repository URL)
