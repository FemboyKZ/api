-- Sample data for testing the Server API
-- This provides realistic test data matching both server-api and kz-records schemas

-- =============================================================================
-- SERVER API DATABASE SEED DATA (server_api)
-- =============================================================================

-- Insert sample servers with region, domain, and other fields
INSERT INTO servers (ip, port, game, status, map, player_count, maxplayers, bot_count, version, hostname, os, secure, region, domain, players_list) VALUES
-- CS2 Servers
('37.27.107.76', 27015, 'counterstrike2', 1, 'kz_synergy_x', 5, 32, 0, '1.0.0.1', 'FemboyKZ | EU #1', 'Linux', 1, 'eu', 'eu.femboy.kz', '[]'),
('37.27.107.76', 27016, 'counterstrike2', 1, 'kz_beachworld', 3, 32, 0, '1.0.0.1', 'FemboyKZ | EU #2', 'Linux', 1, 'eu', 'eu.femboy.kz', '[]'),
('54.39.52.5', 27015, 'counterstrike2', 1, 'kz_beginnerblock_go', 7, 32, 0, '1.0.0.1', 'FemboyKZ | NA #1', 'Linux', 1, 'na', 'na.femboy.kz', '[]'),
('54.39.52.5', 27016, 'counterstrike2', 1, 'kz_synergy_x', 4, 32, 0, '1.0.0.1', 'FemboyKZ | NA #2', 'Linux', 1, 'na', 'na.femboy.kz', '[]'),
('149.40.54.210', 26532, 'counterstrike2', 1, 'kz_azure', 2, 32, 0, '1.0.0.1', 'FemboyKZ | AS', 'Linux', 1, 'as', 'as.femboy.kz', '[]'),
('121.127.47.34', 25064, 'counterstrike2', 0, '', 0, 32, 0, '1.0.0.1', 'FemboyKZ | AU', 'Linux', 1, 'au', 'au.femboy.kz', '[]'),

-- CS:GO Servers
('37.27.107.76', 27025, 'csgo', 1, 'kz_synergy_x', 8, 32, 0, '1.38.8.1', 'FemboyKZ | EU #1 [CS:GO]', 'Linux', 1, 'eu', 'eu.femboy.kz', '[]'),
('37.27.107.76', 27030, 'csgo', 1, 'kz_minimum', 6, 32, 0, '1.38.8.1', 'FemboyKZ | EU #2 [CS:GO]', 'Linux', 1, 'eu', 'eu.femboy.kz', '[]'),
('54.39.52.5', 27025, 'csgo', 1, 'kz_rockclimb', 4, 32, 0, '1.38.8.1', 'FemboyKZ | NA #1 [CS:GO]', 'Linux', 1, 'na', 'na.femboy.kz', '[]'),
('54.39.52.5', 27030, 'csgo', 0, '', 0, 32, 0, '1.38.8.1', 'FemboyKZ | NA #2 [CS:GO]', 'Linux', 1, 'na', 'na.femboy.kz', '[]');

-- Insert sample players with game separation, avatars, and realistic playtimes
-- Player 1 plays both CS:GO and CS2
INSERT INTO players (steamid, latest_name, game, playtime, server_ip, server_port, avatar, avatar_updated_at) VALUES
('76561198000000001', 'remulian', 'csgo', 18900, '37.27.107.76', 27025, 
 'https://avatars.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb.jpg',
 NOW()),
('76561198000000001', 'remulian', 'counterstrike2', 25200, '37.27.107.76', 27015,
 'https://avatars.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb.jpg',
 NOW()),

-- Player 2 only plays CS2
('76561198000000002', 'kz_pro_player', 'counterstrike2', 43200, '54.39.52.5', 27015,
 'https://avatars.steamstatic.com/b5bd56c1aa4644a474a2e4972be27ef9e82e517e.jpg',
 NOW()),

-- Player 3 plays both games
('76561198000000003', 'casual_gamer', 'csgo', 12600, '37.27.107.76', 27025,
 'https://avatars.steamstatic.com/c5d56249ee5d28a07db4ac9f7f60af961fab5426.jpg',
 NOW()),
('76561198000000003', 'casual_gamer', 'counterstrike2', 16200, '37.27.107.76', 27016,
 'https://avatars.steamstatic.com/c5d56249ee5d28a07db4ac9f7f60af961fab5426.jpg',
 NOW()),

-- Player 4 only plays CS:GO
('76561198000000004', 'old_school_player', 'csgo', 36000, '54.39.52.5', 27025,
 'https://avatars.steamstatic.com/fe3bb3eef3bb8fe4f3f3bb3eef3bb8fe4f3f3bb3.jpg',
 NOW()),

-- Player 5 CS2 beginner
('76561198000000005', 'newbie_kz', 'counterstrike2', 5400, '149.40.54.210', 26532,
 NULL, NULL);

-- Insert sample map data with game separation
INSERT INTO maps (name, game, playtime, server_ip, server_port) VALUES
-- CS2 Maps
('kz_synergy_x', 'counterstrike2', 86400, '37.27.107.76', 27015),
('kz_beachworld', 'counterstrike2', 64800, '37.27.107.76', 27016),
('kz_beginnerblock_go', 'counterstrike2', 54000, '54.39.52.5', 27015),
('kz_azure', 'counterstrike2', 32400, '149.40.54.210', 26532),

-- CS:GO Maps
('kz_synergy_x', 'csgo', 108000, '37.27.107.76', 27025),
('kz_minimum', 'csgo', 72000, '37.27.107.76', 27030),
('kz_rockclimb', 'csgo', 45000, '54.39.52.5', 27025),
('kz_toxic', 'csgo', 36000, '37.27.107.76', 27025);

-- Note: Playtime values are in seconds (30-second intervals from updater)
-- Examples:
-- 5,400 seconds = 1.5 hours
-- 18,900 seconds = 5.25 hours
-- 43,200 seconds = 12 hours
-- 86,400 seconds = 24 hours

-- =============================================================================
-- KZ RECORDS DATABASE SEED DATA (kz_records)
-- =============================================================================

-- Insert sample KZ players
INSERT INTO kz_players (steamid64, steam_id, player_name, is_banned, total_records) VALUES
('76561198000000001', 'STEAM_1:1:19999500', 'remulian', FALSE, 150),
('76561198000000002', 'STEAM_1:0:19999501', 'kz_pro_player', FALSE, 500),
('76561198000000003', 'STEAM_1:1:19999502', 'casual_gamer', FALSE, 75),
('76561198000000004', 'STEAM_1:0:19999503', 'old_school_player', FALSE, 320),
('76561198000000005', 'STEAM_1:1:19999504', 'newbie_kz', FALSE, 25),
('76561198000000006', 'STEAM_1:0:19999505', 'banned_cheater', TRUE, 0);

-- Insert sample KZ maps
INSERT INTO kz_maps (map_id, map_name, filesize, validated, difficulty, workshop_url, download_url, global_created_on, global_updated_on) VALUES
(100, 'kz_synergy_x', 45000000, TRUE, 5, 'https://steamcommunity.com/sharedfiles/filedetails/?id=3070194623', 'https://kzgo.eu/maps/kz_synergy_x.bsp', '2023-01-15 10:00:00', '2024-11-01 15:30:00'),
(101, 'kz_beachworld', 38000000, TRUE, 4, 'https://steamcommunity.com/sharedfiles/filedetails/?id=3070194001', 'https://kzgo.eu/maps/kz_beachworld.bsp', '2023-02-20 12:00:00', '2024-10-15 09:20:00'),
(102, 'kz_beginnerblock_go', 12000000, TRUE, 1, 'https://steamcommunity.com/sharedfiles/filedetails/?id=3070193500', 'https://kzgo.eu/maps/kz_beginnerblock_go.bsp', '2022-05-10 08:00:00', '2024-09-01 14:45:00'),
(103, 'kz_azure', 52000000, TRUE, 6, 'https://steamcommunity.com/sharedfiles/filedetails/?id=3070195200', 'https://kzgo.eu/maps/kz_azure.bsp', '2023-08-05 16:30:00', '2024-12-10 11:15:00'),
(104, 'kz_minimum', 28000000, TRUE, 2, 'https://steamcommunity.com/sharedfiles/filedetails/?id=3070192800', NULL, '2021-03-12 10:00:00', '2024-08-20 13:00:00'),
(105, 'kz_rockclimb', 35000000, TRUE, 3, NULL, 'https://kzgo.eu/maps/kz_rockclimb.bsp', '2020-11-25 14:00:00', '2024-07-15 10:30:00'),
(106, 'kz_toxic', 41000000, FALSE, 7, NULL, NULL, '2024-01-10 09:00:00', '2024-01-10 09:00:00');

-- Insert sample KZ servers
INSERT INTO kz_servers (server_id, api_key, port, server_name, ip, owner_steamid64, created_on, updated_on, approval_status, approved_by_steamid64) VALUES
(123, 'api_key_eu1', 27015, 'FemboyKZ | EU #1', '37.27.107.76', '76561198000000001', '2024-01-01 00:00:00', '2025-01-15 12:00:00', 1, '76561198000000001'),
(124, 'api_key_eu2', 27016, 'FemboyKZ | EU #2', '37.27.107.76', '76561198000000001', '2024-01-01 00:00:00', '2025-01-15 12:00:00', 1, '76561198000000001'),
(125, 'api_key_na1', 27015, 'FemboyKZ | NA #1', '54.39.52.5', '76561198000000002', '2024-02-01 00:00:00', '2025-01-14 10:00:00', 1, '76561198000000001'),
(126, 'api_key_na2', 27016, 'FemboyKZ | NA #2', '54.39.52.5', '76561198000000002', '2024-02-01 00:00:00', '2025-01-14 10:00:00', 1, '76561198000000001'),
(127, 'api_key_as', 26532, 'FemboyKZ | AS', '149.40.54.210', '76561198000000004', '2024-03-15 00:00:00', '2025-01-13 08:00:00', 1, '76561198000000001');

-- Insert sample KZ modes
INSERT INTO kz_modes (id, name, description, latest_version, latest_version_description, website, repo, contact_steamid64, supported_tickrates, created_on, updated_on, updated_by_id) VALUES
(1, 'kz_timer', 'KZTimer - Classic KZ mode with timer functionality', 200, 'v2.00', 'https://bitbucket.org/kztimerglobal/kztimerglobal', 'https://bitbucket.org/kztimerglobal/kztimerglobal', '76561198000000001', '64,102.4,128', '2020-01-01 00:00:00', '2024-11-01 12:00:00', '76561198000000001'),
(2, 'kz_simple', 'SimpleKZ - Simplified KZ mode focused on pure movement', 180, 'v1.80', 'https://github.com/zer0k-z/gokz-hybrid', 'https://github.com/zer0k-z/gokz-hybrid', '76561198000000002', '64,102.4,128', '2020-01-01 00:00:00', '2024-10-15 10:00:00', '76561198000000002'),
(3, 'kz_vanilla', 'Vanilla KZ - Original CS:GO movement mechanics', 175, 'v1.75', 'https://github.com/zer0k-z/gokz-hybrid', 'https://github.com/zer0k-z/gokz-hybrid', '76561198000000002', '64,102.4,128', '2020-01-01 00:00:00', '2024-09-20 09:00:00', '76561198000000002');

-- Insert sample KZ records (mix of different modes, maps, and players)
INSERT INTO kz_records (original_id, player_id, map_id, server_id, mode, stage, time, teleports, points, tickrate, record_filter_id, replay_id, updated_by, created_on, updated_on) VALUES
-- remulian's records
(1000, '76561198000000001', 1, 1, 'kz_timer', 0, 125.456, 0, 50, 128, 1, 1000, 0, '2025-01-15 12:00:00', '2025-01-15 12:00:00'),
(1001, '76561198000000001', 1, 1, 'kz_timer', 1, 35.123, 0, 15, 128, 2, 1001, 0, '2025-01-15 12:05:00', '2025-01-15 12:05:00'),
(1002, '76561198000000001', 2, 2, 'kz_simple', 0, 89.234, 5, 42, 128, 3, 1002, 0, '2025-01-14 15:30:00', '2025-01-14 15:30:00'),
(1003, '76561198000000001', 3, 3, 'kz_timer', 0, 45.789, 0, 48, 128, 4, 1003, 0, '2025-01-13 10:15:00', '2025-01-13 10:15:00'),

-- kz_pro_player's records (world record holder)
(1004, '76561198000000002', 1, 1, 'kz_timer', 0, 120.123, 0, 52, 128, 1, 1004, 0, '2025-01-16 10:00:00', '2025-01-16 10:00:00'),
(1005, '76561198000000002', 2, 2, 'kz_timer', 0, 82.456, 0, 45, 128, 5, 1005, 0, '2025-01-16 11:00:00', '2025-01-16 11:00:00'),
(1006, '76561198000000002', 4, 5, 'kz_simple', 0, 310.789, 0, 38, 128, 6, 1006, 0, '2025-01-15 09:00:00', '2025-01-15 09:00:00'),
(1007, '76561198000000002', 5, 1, 'kz_timer', 0, 65.234, 0, 46, 128, 7, 1007, 0, '2025-01-14 14:20:00', '2025-01-14 14:20:00'),

-- casual_gamer's records (with teleports)
(1008, '76561198000000003', 1, 1, 'kz_timer', 0, 180.567, 15, 25, 128, 1, 1008, 0, '2025-01-12 16:45:00', '2025-01-12 16:45:00'),
(1009, '76561198000000003', 3, 3, 'kz_simple', 0, 58.901, 8, 30, 128, 8, 1009, 0, '2025-01-11 13:30:00', '2025-01-11 13:30:00'),

-- old_school_player's records
(1010, '76561198000000004', 6, 1, 'kz_vanilla', 0, 220.345, 0, 35, 102, 9, 1010, 0, '2025-01-10 11:00:00', '2025-01-10 11:00:00'),
(1011, '76561198000000004', 5, 1, 'kz_vanilla', 0, 70.123, 0, 44, 102, 10, 1011, 0, '2025-01-09 15:45:00', '2025-01-09 15:45:00'),

-- newbie_kz's records (beginner map)
(1012, '76561198000000005', 3, 3, 'kz_timer', 0, 90.678, 25, 10, 128, 4, 1012, 0, '2025-01-08 12:00:00', '2025-01-08 12:00:00');

-- Insert sample KZ record filters
INSERT INTO kz_record_filters (id, map_id, stage, mode_id, tickrate, has_teleports, created_on, updated_on, updated_by_id) VALUES
(1, 1, 0, 1, 128, FALSE, '2024-01-01 00:00:00', '2024-01-01 00:00:00', NULL),
(2, 1, 1, 1, 128, FALSE, '2024-01-01 00:00:00', '2024-01-01 00:00:00', NULL),
(3, 2, 0, 2, 128, TRUE, '2024-01-01 00:00:00', '2024-01-01 00:00:00', NULL),
(4, 3, 0, 1, 128, FALSE, '2024-01-01 00:00:00', '2024-01-01 00:00:00', NULL),
(5, 2, 0, 1, 128, FALSE, '2024-01-01 00:00:00', '2024-01-01 00:00:00', NULL),
(6, 4, 0, 2, 128, FALSE, '2024-01-01 00:00:00', '2024-01-01 00:00:00', NULL),
(7, 5, 0, 1, 128, FALSE, '2024-01-01 00:00:00', '2024-01-01 00:00:00', NULL),
(8, 3, 0, 2, 128, TRUE, '2024-01-01 00:00:00', '2024-01-01 00:00:00', NULL),
(9, 6, 0, 3, 102, FALSE, '2024-01-01 00:00:00', '2024-01-01 00:00:00', NULL),
(10, 5, 0, 3, 102, FALSE, '2024-01-01 00:00:00', '2024-01-01 00:00:00', NULL);

-- Insert sample KZ bans
INSERT INTO kz_bans (id, ban_type, expires_on, steamid64, player_name, steam_id, notes, server_id, updated_by_id, created_on, updated_on) VALUES
(1, 'Bhop Hack', NULL, '76561198000000006', 'banned_cheater', 'STEAM_1:0:19999505', 'Detected bhop script - permanent ban', 123, '76561198000000001', '2025-01-10 10:00:00', '2025-01-10 10:00:00'),
(2, 'Strafe Hack', '2025-06-01 00:00:00', '76561198000000007', 'temp_banned_player', 'STEAM_1:1:19999506', 'Suspicious strafing pattern - 6 month ban', 124, '76561198000000001', '2024-12-01 14:30:00', '2024-12-01 14:30:00'),
(3, 'Inappropriate Name', '2025-02-15 00:00:00', '76561198000000008', 'offensive_name', 'STEAM_1:0:19999507', 'Offensive username', 125, '76561198000000002', '2025-01-15 09:00:00', '2025-01-15 09:00:00');

-- Insert sample KZ jumpstats
INSERT INTO kz_jumpstats (id, server_id, steamid64, player_name, steam_id, jump_type, distance, tickrate, msl_count, strafe_count, is_crouch_bind, is_forward_bind, is_crouch_boost, updated_by_id, created_on, updated_on) VALUES
(1, 123, '76561198000000002', 'kz_pro_player', 'STEAM_1:0:19999501', 1, 285.5, 128, 0, 8, 0, 0, 0, NULL, '2025-01-16 12:00:00', '2025-01-16 12:00:00'),
(2, 123, '76561198000000001', 'remulian', 'STEAM_1:1:19999500', 1, 278.3, 128, 0, 7, 0, 0, 0, NULL, '2025-01-15 14:30:00', '2025-01-15 14:30:00'),
(3, 124, '76561198000000004', 'old_school_player', 'STEAM_1:0:19999503', 2, 265.8, 102, 1, 6, 0, 0, 0, NULL, '2025-01-14 11:15:00', '2025-01-14 11:15:00');

-- Insert sample world records cache
INSERT INTO kz_worldrecords_cache (map_id, mode, stage, teleports, player_id, time, points, server_id, created_on) VALUES
(1, 'kz_timer', 0, 0, '76561198000000002', 120.123, 52, 123, '2025-01-16 10:00:00'),
(1, 'kz_timer', 1, 0, '76561198000000001', 35.123, 15, 123, '2025-01-15 12:05:00'),
(2, 'kz_timer', 0, 0, '76561198000000002', 82.456, 45, 124, '2025-01-16 11:00:00'),
(2, 'kz_simple', 0, 1, '76561198000000001', 89.234, 42, 124, '2025-01-14 15:30:00'),
(3, 'kz_timer', 0, 0, '76561198000000001', 45.789, 48, 125, '2025-01-13 10:15:00'),
(4, 'kz_simple', 0, 0, '76561198000000002', 310.789, 38, 127, '2025-01-15 09:00:00'),
(5, 'kz_timer', 0, 0, '76561198000000002', 65.234, 46, 123, '2025-01-14 14:20:00');

-- Notes:
-- - Steam IDs use STEAM_1 format (legacy) which gets converted to SteamID64 in code
-- - Record times are in seconds with millisecond precision
-- - Teleports: 0 = pro run, >0 = TP run
-- - Points awarded based on map difficulty and time
-- - Tickrate: 128 (CS2), 102.4 (CS:GO common), 64 (CS:GO alternative)
-- - Jump types: 1 = longjump, 2 = multibhop, etc.
-- - Ban types: Bhop Hack, Strafe Hack, Inappropriate Name, etc.
-- - World records cache updated via stored procedure (refresh_worldrecords_cache)

