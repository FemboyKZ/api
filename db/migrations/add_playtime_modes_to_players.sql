-- Add per-gamemode playtime tracking to players
-- Run: mysql -u user -p database < db/migrations/add_playtime_modes_to_players.sql
--
-- `playtime` remains the total across all modes. `playtime_modes` holds the
-- per-mode breakdown in seconds, e.g. {"kz_vanilla":123,"kz_simple":45,"kz_timer":6}.
-- Populated from the gokz status plugin; null for cs2kz servers (no mode data yet).

ALTER TABLE players
ADD COLUMN playtime_modes JSON DEFAULT NULL
  COMMENT 'Per-gamemode playtime in seconds {kz_vanilla, kz_simple, kz_timer}; null for cs2kz'
AFTER playtime;
