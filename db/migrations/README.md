# Database Migrations

This directory contains SQL migration scripts for schema changes.

## How to Apply Migrations

Migrations should be applied manually using the MySQL command line:

```bash
mysql -u username -p database_name < db/migrations/migration_file.sql
```

Or if using Docker:

```bash
docker exec -i container_name mysql -u username -p database_name < db/migrations/migration_file.sql
```

## Available Migrations

### `simplify_avatars.sql`

**Purpose**: Removes redundant avatar size columns from the `players` table.

**Why**: Steam avatars are the same image with different size suffixes (_medium.jpg, _full.jpg). Storing all three URLs is redundant and wastes space.

**Changes**:
- Drops `avatar_medium` column
- Drops `avatar_full` column  
- Renames `avatar_small` to `avatar`

**Important**: After running this migration, avatar URLs will be in the format:
- Base (32x32): `https://avatars.steamstatic.com/hash.jpg`
- Medium (64x64): Append `_medium` before `.jpg`
- Full (184x184): Append `_full` before `.jpg`

The API will continue to work - the `steamAvatars.js` service and `players.js` API have been updated to use the single `avatar` field.

## Migration Order

If applying multiple migrations, run them in chronological order based on the filename or creation date.
