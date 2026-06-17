-- Migration: store the server each PB was set on (for the profile finishes list)
--
-- Adds pro_server_id / tp_server_id to kz_player_map_pbs, populated by the PB
-- sync from kz_records_partitioned.server_id. Resolved to a name via kz_servers
-- at read time. Existing rows backfill on their next sync.
--
-- Apply: mysql -u user -p kz_database < db/migrations/add_pb_server_id.sql

ALTER TABLE kz_player_map_pbs
  ADD COLUMN IF NOT EXISTS pro_server_id INT UNSIGNED NULL AFTER pro_created_on,
  ADD COLUMN IF NOT EXISTS tp_server_id INT UNSIGNED NULL AFTER tp_created_on;
