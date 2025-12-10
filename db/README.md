# Database Setup

This directory contains SQL scripts for setting up the MySQL database.

## Files

- **`schema.sql`** - Creates the database tables (servers, players, maps)
- **`seed.sql`** - Inserts sample data for testing

## Setup Instructions

### 1. Create Database

```sql
CREATE DATABASE IF NOT EXISTS server_api;
USE server_api;
```

### 2. Import Schema

```bash
# Using mysql command-line client
mysql -u your_user -p server_api < db/schema.sql

# Or from within mysql
mysql> USE server_api;
mysql> SOURCE /path/to/server-api/db/schema.sql;
```

### 3. (Optional) Load Sample Data

```bash
mysql -u your_user -p server_api < db/seed.sql
```

## Environment Configuration

Create a `.env` file in the project root with your database credentials:

```env
DB_HOST=localhost
DB_USER=your_user
DB_PASSWORD=your_password
DB_NAME=server_api
PORT=3000
```

## Table Structures

### servers

- Tracks game server status, current map, player count
- Unique constraint on `(ip, port)` for ON DUPLICATE KEY UPDATE
- Automatically updates `last_update` timestamp

### players

- Stores player activity with playtime tracking
- Indexed on `steamid` for aggregation queries
- Can have multiple entries per player (per server/session)

### maps

- Aggregates map playtime statistics
- Indexed on `name` and `playtime` for ranking queries
- Tracks last played timestamp

## Notes

- All tables use `utf8mb4` charset for emoji and international character support
- Timestamps are managed automatically by MySQL
- Playtime is stored in seconds (convert to hours/minutes in application layer)
