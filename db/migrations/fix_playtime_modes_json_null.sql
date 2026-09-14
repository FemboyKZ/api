-- Strip poisoned JSON-null entries from players.playtime_modes.
-- Run: mysql -u user -p database < db/migrations/fix_playtime_modes_json_null.sql
--
-- src/api/serverStatus.js used to write JSON null for a mode key with no delta
-- this interval. JSON_EXTRACT on that key returns the literal 'null' rather
-- than SQL NULL, so COALESCE(..., 0) passed it straight through and the
-- next `+ ?` on a following report threw (invalid cast to DOUBLE), 500ing
-- every status report from a server with an affected player online.
-- The write path no longer stores nulls (only real deltas); this repairs
-- rows already poisoned by the old code.
UPDATE players SET playtime_modes = JSON_REMOVE(playtime_modes, '$."kz_vanilla"')
  WHERE JSON_TYPE(JSON_EXTRACT(playtime_modes, '$."kz_vanilla"')) = 'NULL';
UPDATE players SET playtime_modes = JSON_REMOVE(playtime_modes, '$."kz_simple"')
  WHERE JSON_TYPE(JSON_EXTRACT(playtime_modes, '$."kz_simple"')) = 'NULL';
UPDATE players SET playtime_modes = JSON_REMOVE(playtime_modes, '$."kz_timer"')
  WHERE JSON_TYPE(JSON_EXTRACT(playtime_modes, '$."kz_timer"')) = 'NULL';
UPDATE players SET playtime_modes = JSON_REMOVE(playtime_modes, '$."cs2kz_vnl"')
  WHERE JSON_TYPE(JSON_EXTRACT(playtime_modes, '$."cs2kz_vnl"')) = 'NULL';
UPDATE players SET playtime_modes = JSON_REMOVE(playtime_modes, '$."cs2kz_ckz"')
  WHERE JSON_TYPE(JSON_EXTRACT(playtime_modes, '$."cs2kz_ckz"')) = 'NULL';
