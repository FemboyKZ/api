-- Add per-gamemode playtime tracking to players
-- Run: mysql -u user -p database < db/migrations/add_playtime_modes_to_players.sql
--
-- `playtime` remains the total across all modes. `playtime_modes` holds the
-- per-mode breakdown in seconds. gokz (csgo): {"kz_vanilla":123,"kz_simple":45,"kz_timer":6}.
-- cs2kz (cs2): {"vnl":null,"ckz":null}
ALTER TABLE players
ADD COLUMN playtime_modes JSON DEFAULT NULL
  COMMENT 'Per-gamemode playtime in seconds. gokz: {kz_vanilla,kz_simple,kz_timer}; cs2kz: {cs2kz_vnl,cs2kz_ckz}'
AFTER playtime;
