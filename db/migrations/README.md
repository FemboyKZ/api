# Database Migrations

## Running Migrations

To apply a migration, run it against your database:

```bash
mysql -u your_user -p your_database < db/migrations/migration_file.sql
```

## Available Migrations

### sanitize_map_names.sql / sanitize-map-names.js

**Purpose:** Cleans up map names that contain workshop paths or URL encoding

**Problem:** Maps stored as `workshop%2F793414645%2Fkz_synergy_x` or `workshop/123/kz_grotto`

**Solution:** Extracts the actual map name (e.g., `kz_synergy_x`, `kz_grotto`)

**Options:**

1. **SQL Migration** (basic):
```bash
mysql -u your_user -p your_database < db/migrations/sanitize_map_names.sql
```

2. **Node.js Script** (recommended - handles deduplication):

```bash
# Dry run to see what would change
node scripts/sanitize-map-names.js --dry-run

# Apply changes
node scripts/sanitize-map-names.js

# Only process CS:GO maps
node scripts/sanitize-map-names.js --game=csgo

# Only process CS2 maps
node scripts/sanitize-map-names.js --game=counterstrike2
```

**Note:** After running this migration, future map names will automatically be sanitized by the updater service.

### add_player_avatars.sql

**Purpose:** Adds Steam avatar URL columns to players table

**To apply:**
```bash
mysql -u your_user -p your_database < db/migrations/add_player_avatars.sql
```

### add_map_global_info.sql

**Purpose:** Adds globalInfo JSON column for GOKZ/CS2KZ API data

**To apply:**
```bash
mysql -u your_user -p your_database < db/migrations/add_map_global_info.sql
```

### add_region_domain_to_servers.sql

**Purpose:** Adds region and domain columns to servers table

**To apply:**
```bash
mysql -u your_user -p your_database < db/migrations/add_region_domain_to_servers.sql
```

### add_api_identifiers.sql

**Purpose:** Adds API identifiers (apiId, kztId, tickrate) to servers table

**Changes:**
- Adds `api_id` column for CS2KZ API server identification
- Adds `kzt_id` column for GlobalKZ API server identification  
- Adds `tickrate` column for server tickrate (64, 128, etc.)

**To apply:**
```bash
mysql -u your_user -p your_database < db/migrations/add_api_identifiers.sql
```

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
2. `add_region_domain_to_servers.sql`
3. `add_api_identifiers.sql`
4. `add_game_to_players_with_dedup.sql`
5. `add_game_to_maps_with_dedup.sql`
6. `add_player_history_tracking.sql`
7. `add_player_avatars.sql`
8. `add_map_global_info.sql`
9. `sanitize_map_names.sql` (or run `scripts/sanitize-map-names.js`)
10. `remove_server_steamid.sql` (optional cleanup)
11. `fix_playtime_historical_data.sql` (only if data was tracked before playtime fix)
