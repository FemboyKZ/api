# Database Migrations

## Running Migrations

To apply a migration, run it against your database:

```bash
mysql -u your_user -p your_database < db/migrations/migration_file.sql
```

## Available Migrations

### add_player_history_tracking.sql

**Purpose:** Adds player name and IP tracking functionality

**Changes:**
- Adds `latest_name` column to `players` table
- Adds `latest_ip` column to `players` table (PRIVATE - not exposed via API)
- Creates `player_names` table to track all names a player has used
- Creates `player_ips` table to track all IP addresses a player has used (PRIVATE)
- Migrates existing player data to history tables

**Privacy Note:** 
- Player IP addresses are collected for administrative/moderation purposes only
- IPs are NOT exposed through any public API endpoints
- Access to IP data is restricted to database administrators only

**To apply:**
```bash
mysql -u your_user -p your_database < db/migrations/add_player_history_tracking.sql
```

### add_game_to_players_with_dedup.sql

**Purpose:** Adds game column to players table and deduplicates entries

**To apply:**
```bash
mysql -u your_user -p your_database < db/migrations/add_game_to_players_with_dedup.sql
```

### add_game_to_maps_with_dedup.sql

**Purpose:** Adds game column to maps table and deduplicates entries

**To apply:**
```bash
mysql -u your_user -p your_database < db/migrations/add_game_to_maps_with_dedup.sql
```

### add_server_details.sql

**Purpose:** Adds RCON-sourced server details columns

**To apply:**
```bash
mysql -u your_user -p your_database < db/migrations/add_server_details.sql
```

## Migration Order

If starting fresh, run migrations in this order:

1. `add_server_details.sql`
2. `add_game_to_players_with_dedup.sql`
3. `add_game_to_maps_with_dedup.sql`
4. `add_player_history_tracking.sql`
5. `remove_server_steamid.sql` (optional cleanup)
