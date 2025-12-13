-- Sample data for testing the Server API
-- This provides realistic test data matching both server-api and kz-records schemas

-- =============================================================================
-- SERVER API DATABASE SEED DATA (server_api)
-- =============================================================================

-- Insert sample servers with region, domain, and other fields
INSERT INTO servers (ip, port, game, status, map, player_count, maxplayers, bot_count, version, hostname, os, secure, region, domain, players_list, api_id, kzt_id, tickrate) VALUES
-- CS2 Servers
('37.27.107.76', 27015, 'counterstrike2', 1, 'kz_synergy_x', 5, 32, 0, '1.0.0.1', 'FemboyKZ | EU #1', 'Linux', 1, 'eu', 'eu.femboy.kz', '[]', 1, NULL, 128),
('37.27.107.76', 27016, 'counterstrike2', 1, 'kz_beachworld', 3, 32, 0, '1.0.0.1', 'FemboyKZ | EU #2', 'Linux', 1, 'eu', 'eu.femboy.kz', '[]', 2, NULL, 128),
('54.39.52.5', 27015, 'counterstrike2', 1, 'kz_beginnerblock_go', 7, 32, 0, '1.0.0.1', 'FemboyKZ | NA #1', 'Linux', 1, 'na', 'na.femboy.kz', '[]', 3, NULL, 128),
('54.39.52.5', 27016, 'counterstrike2', 1, 'kz_synergy_x', 4, 32, 0, '1.0.0.1', 'FemboyKZ | NA #2', 'Linux', 1, 'na', 'na.femboy.kz', '[]', 4, NULL, 128),
('149.40.54.210', 26532, 'counterstrike2', 1, 'kz_azure', 2, 32, 0, '1.0.0.1', 'FemboyKZ | AS', 'Linux', 1, 'as', 'as.femboy.kz', '[]', 5, NULL, 128),
('121.127.47.34', 25064, 'counterstrike2', 0, '', 0, 32, 0, '1.0.0.1', 'FemboyKZ | AU', 'Linux', 1, 'au', 'au.femboy.kz', '[]', 6, NULL, 128),

-- CS:GO Servers
('37.27.107.76', 27025, 'csgo', 1, 'kz_synergy_x', 8, 32, 0, '1.38.8.1', 'FemboyKZ | EU #1 [CS:GO]', 'Linux', 1, 'eu', 'eu.femboy.kz', '[]', NULL, 123, 128),
('37.27.107.76', 27030, 'csgo', 1, 'kz_minimum', 6, 32, 0, '1.38.8.1', 'FemboyKZ | EU #2 [CS:GO]', 'Linux', 1, 'eu', 'eu.femboy.kz', '[]', NULL, 124, 128),
('54.39.52.5', 27025, 'csgo', 1, 'kz_rockclimb', 4, 32, 0, '1.38.8.1', 'FemboyKZ | NA #1 [CS:GO]', 'Linux', 1, 'na', 'na.femboy.kz', '[]', NULL, 125, 128),
('54.39.52.5', 27030, 'csgo', 0, '', 0, 32, 0, '1.38.8.1', 'FemboyKZ | NA #2 [CS:GO]', 'Linux', 1, 'na', 'na.femboy.kz', '[]', NULL, 126, 128);

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

-- Insert sample KZ players (must be inserted first due to FK constraints)
INSERT INTO kz_players (id, steamid64, steam_id, player_name, is_banned, total_records) VALUES
(1, '76561198000000001', 'STEAM_1:1:19999500', 'remulian', FALSE, 150),
(2, '76561198000000002', 'STEAM_1:0:19999501', 'kz_pro_player', FALSE, 500),
(3, '76561198000000003', 'STEAM_1:1:19999502', 'casual_gamer', FALSE, 75),
(4, '76561198000000004', 'STEAM_1:0:19999503', 'old_school_player', FALSE, 320),
(5, '76561198000000005', 'STEAM_1:1:19999504', 'newbie_kz', FALSE, 25),
(6, '76561198000000006', 'STEAM_1:0:19999505', 'banned_cheater', TRUE, 0),
(7, '76561198000000007', 'STEAM_1:1:19999506', 'temp_banned_player', FALSE, 10),
(8, '76561198000000008', 'STEAM_1:0:19999507', 'offensive_name', FALSE, 5);

-- Insert sample KZ maps
INSERT INTO kz_maps (id, map_id, map_name, filesize, validated, difficulty, workshop_url, download_url, global_created_on, global_updated_on) VALUES
(1, 100, 'kz_synergy_x', 45000000, TRUE, 5, 'https://steamcommunity.com/sharedfiles/filedetails/?id=3070194623', 'https://kzgo.eu/maps/kz_synergy_x.bsp', '2023-01-15 10:00:00', '2024-11-01 15:30:00'),
(2, 101, 'kz_beachworld', 38000000, TRUE, 4, 'https://steamcommunity.com/sharedfiles/filedetails/?id=3070194001', 'https://kzgo.eu/maps/kz_beachworld.bsp', '2023-02-20 12:00:00', '2024-10-15 09:20:00'),
(3, 102, 'kz_beginnerblock_go', 12000000, TRUE, 1, 'https://steamcommunity.com/sharedfiles/filedetails/?id=3070193500', 'https://kzgo.eu/maps/kz_beginnerblock_go.bsp', '2022-05-10 08:00:00', '2024-09-01 14:45:00'),
(4, 103, 'kz_azure', 52000000, TRUE, 6, 'https://steamcommunity.com/sharedfiles/filedetails/?id=3070195200', 'https://kzgo.eu/maps/kz_azure.bsp', '2023-08-05 16:30:00', '2024-12-10 11:15:00'),
(5, 104, 'kz_minimum', 28000000, TRUE, 2, 'https://steamcommunity.com/sharedfiles/filedetails/?id=3070192800', NULL, '2021-03-12 10:00:00', '2024-08-20 13:00:00'),
(6, 105, 'kz_rockclimb', 35000000, TRUE, 3, NULL, 'https://kzgo.eu/maps/kz_rockclimb.bsp', '2020-11-25 14:00:00', '2024-07-15 10:30:00'),
(7, 106, 'kz_toxic', 41000000, FALSE, 7, NULL, NULL, '2024-01-10 09:00:00', '2024-01-10 09:00:00');

-- Insert sample KZ modes (must be before kz_record_filters due to FK)
INSERT INTO kz_modes (id, name, description, latest_version, latest_version_description, website, repo, contact_steamid64, supported_tickrates, created_on, updated_on, updated_by_id) VALUES
(1, 'kz_timer', 'KZTimer - Classic KZ mode with timer functionality', 200, 'v2.00', 'https://bitbucket.org/kztimerglobal/kztimerglobal', 'https://bitbucket.org/kztimerglobal/kztimerglobal', '76561198000000001', '64,102.4,128', '2020-01-01 00:00:00', '2024-11-01 12:00:00', '76561198000000001'),
(2, 'kz_simple', 'SimpleKZ - Simplified KZ mode focused on pure movement', 180, 'v1.80', 'https://github.com/zer0k-z/gokz-hybrid', 'https://github.com/zer0k-z/gokz-hybrid', '76561198000000002', '64,102.4,128', '2020-01-01 00:00:00', '2024-10-15 10:00:00', '76561198000000002'),
(3, 'kz_vanilla', 'Vanilla KZ - Original CS:GO movement mechanics', 175, 'v1.75', 'https://github.com/zer0k-z/gokz-hybrid', 'https://github.com/zer0k-z/gokz-hybrid', '76561198000000002', '64,102.4,128', '2020-01-01 00:00:00', '2024-09-20 09:00:00', '76561198000000002');

-- Insert sample KZ servers (must reference existing kz_players for owner/approver FKs)
INSERT INTO kz_servers (id, server_id, api_key, port, server_name, ip, owner_steamid64, created_on, updated_on, approval_status, approved_by_steamid64) VALUES
(1, 123, 'api_key_eu1', 27015, 'FemboyKZ | EU #1', '37.27.107.76', '76561198000000001', '2024-01-01 00:00:00', '2025-01-15 12:00:00', 1, '76561198000000001'),
(2, 124, 'api_key_eu2', 27016, 'FemboyKZ | EU #2', '37.27.107.76', '76561198000000001', '2024-01-01 00:00:00', '2025-01-15 12:00:00', 1, '76561198000000001'),
(3, 125, 'api_key_na1', 27015, 'FemboyKZ | NA #1', '54.39.52.5', '76561198000000002', '2024-02-01 00:00:00', '2025-01-14 10:00:00', 1, '76561198000000001'),
(4, 126, 'api_key_na2', 27016, 'FemboyKZ | NA #2', '54.39.52.5', '76561198000000002', '2024-02-01 00:00:00', '2025-01-14 10:00:00', 1, '76561198000000001'),
(5, 127, 'api_key_as', 26532, 'FemboyKZ | AS', '149.40.54.210', '76561198000000004', '2024-03-15 00:00:00', '2025-01-13 08:00:00', 1, '76561198000000001');

-- Insert sample KZ record filters (depends on kz_maps and kz_modes)
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

-- Insert sample KZ records (uses player_id FK, not steamid64)
-- Note: Uses player_id (INT) referencing kz_players(id), not steamid64
INSERT INTO kz_records (id, original_id, player_id, steamid64, map_id, server_id, mode, stage, time, teleports, points, tickrate, record_filter_id, replay_id, updated_by, created_on, updated_on) VALUES
-- remulian's records (player_id = 1)
(1, 1000, 1, '76561198000000001', 1, 1, 'kz_timer', 0, 125.456, 0, 50, 128, 1, 1000, 0, '2025-01-15 12:00:00', '2025-01-15 12:00:00'),
(2, 1001, 1, '76561198000000001', 1, 1, 'kz_timer', 1, 35.123, 0, 15, 128, 2, 1001, 0, '2025-01-15 12:05:00', '2025-01-15 12:05:00'),
(3, 1002, 1, '76561198000000001', 2, 2, 'kz_simple', 0, 89.234, 5, 42, 128, 3, 1002, 0, '2025-01-14 15:30:00', '2025-01-14 15:30:00'),
(4, 1003, 1, '76561198000000001', 3, 3, 'kz_timer', 0, 45.789, 0, 48, 128, 4, 1003, 0, '2025-01-13 10:15:00', '2025-01-13 10:15:00'),

-- kz_pro_player's records (player_id = 2, world record holder)
(5, 1004, 2, '76561198000000002', 1, 1, 'kz_timer', 0, 120.123, 0, 52, 128, 1, 1004, 0, '2025-01-16 10:00:00', '2025-01-16 10:00:00'),
(6, 1005, 2, '76561198000000002', 2, 2, 'kz_timer', 0, 82.456, 0, 45, 128, 5, 1005, 0, '2025-01-16 11:00:00', '2025-01-16 11:00:00'),
(7, 1006, 2, '76561198000000002', 4, 5, 'kz_simple', 0, 310.789, 0, 38, 128, 6, 1006, 0, '2025-01-15 09:00:00', '2025-01-15 09:00:00'),
(8, 1007, 2, '76561198000000002', 5, 1, 'kz_timer', 0, 65.234, 0, 46, 128, 7, 1007, 0, '2025-01-14 14:20:00', '2025-01-14 14:20:00'),

-- casual_gamer's records (player_id = 3, with teleports)
(9, 1008, 3, '76561198000000003', 1, 1, 'kz_timer', 0, 180.567, 15, 25, 128, 1, 1008, 0, '2025-01-12 16:45:00', '2025-01-12 16:45:00'),
(10, 1009, 3, '76561198000000003', 3, 3, 'kz_simple', 0, 58.901, 8, 30, 128, 8, 1009, 0, '2025-01-11 13:30:00', '2025-01-11 13:30:00'),

-- old_school_player's records (player_id = 4)
(11, 1010, 4, '76561198000000004', 6, 1, 'kz_vanilla', 0, 220.345, 0, 35, 102, 9, 1010, 0, '2025-01-10 11:00:00', '2025-01-10 11:00:00'),
(12, 1011, 4, '76561198000000004', 5, 1, 'kz_vanilla', 0, 70.123, 0, 44, 102, 10, 1011, 0, '2025-01-09 15:45:00', '2025-01-09 15:45:00'),

-- newbie_kz's records (player_id = 5, beginner map)
(13, 1012, 5, '76561198000000005', 3, 3, 'kz_timer', 0, 90.678, 25, 10, 128, 4, 1012, 0, '2025-01-08 12:00:00', '2025-01-08 12:00:00');

-- Insert into partitioned records table as well (main table for queries)
INSERT INTO kz_records_partitioned (id, original_id, player_id, steamid64, map_id, server_id, mode, stage, time, teleports, points, tickrate, record_filter_id, replay_id, updated_by, created_on, updated_on) VALUES
(1, 1000, 1, '76561198000000001', 1, 1, 'kz_timer', 0, 125.456, 0, 50, 128, 1, 1000, 0, '2025-01-15 12:00:00', '2025-01-15 12:00:00'),
(2, 1001, 1, '76561198000000001', 1, 1, 'kz_timer', 1, 35.123, 0, 15, 128, 2, 1001, 0, '2025-01-15 12:05:00', '2025-01-15 12:05:00'),
(3, 1002, 1, '76561198000000001', 2, 2, 'kz_simple', 0, 89.234, 5, 42, 128, 3, 1002, 0, '2025-01-14 15:30:00', '2025-01-14 15:30:00'),
(4, 1003, 1, '76561198000000001', 3, 3, 'kz_timer', 0, 45.789, 0, 48, 128, 4, 1003, 0, '2025-01-13 10:15:00', '2025-01-13 10:15:00'),
(5, 1004, 2, '76561198000000002', 1, 1, 'kz_timer', 0, 120.123, 0, 52, 128, 1, 1004, 0, '2025-01-16 10:00:00', '2025-01-16 10:00:00'),
(6, 1005, 2, '76561198000000002', 2, 2, 'kz_timer', 0, 82.456, 0, 45, 128, 5, 1005, 0, '2025-01-16 11:00:00', '2025-01-16 11:00:00'),
(7, 1006, 2, '76561198000000002', 4, 5, 'kz_simple', 0, 310.789, 0, 38, 128, 6, 1006, 0, '2025-01-15 09:00:00', '2025-01-15 09:00:00'),
(8, 1007, 2, '76561198000000002', 5, 1, 'kz_timer', 0, 65.234, 0, 46, 128, 7, 1007, 0, '2025-01-14 14:20:00', '2025-01-14 14:20:00'),
(9, 1008, 3, '76561198000000003', 1, 1, 'kz_timer', 0, 180.567, 15, 25, 128, 1, 1008, 0, '2025-01-12 16:45:00', '2025-01-12 16:45:00'),
(10, 1009, 3, '76561198000000003', 3, 3, 'kz_simple', 0, 58.901, 8, 30, 128, 8, 1009, 0, '2025-01-11 13:30:00', '2025-01-11 13:30:00'),
(11, 1010, 4, '76561198000000004', 6, 1, 'kz_vanilla', 0, 220.345, 0, 35, 102, 9, 1010, 0, '2025-01-10 11:00:00', '2025-01-10 11:00:00'),
(12, 1011, 4, '76561198000000004', 5, 1, 'kz_vanilla', 0, 70.123, 0, 44, 102, 10, 1011, 0, '2025-01-09 15:45:00', '2025-01-09 15:45:00'),
(13, 1012, 5, '76561198000000005', 3, 3, 'kz_timer', 0, 90.678, 25, 10, 128, 4, 1012, 0, '2025-01-08 12:00:00', '2025-01-08 12:00:00');

-- Insert sample KZ bans (with ip and stats columns)
INSERT INTO kz_bans (id, ban_type, expires_on, ip, steamid64, player_name, steam_id, notes, stats, server_id, updated_by_id, created_on, updated_on) VALUES
(1, 'Bhop Hack', NULL, NULL, '76561198000000006', 'banned_cheater', 'STEAM_1:0:19999505', 'Detected bhop script - permanent ban', '{"detected_at":"2025-01-10","detection_method":"automated"}', 1, '76561198000000001', '2025-01-10 10:00:00', '2025-01-10 10:00:00'),
(2, 'Strafe Hack', '2025-06-01 00:00:00', NULL, '76561198000000007', 'temp_banned_player', 'STEAM_1:1:19999506', 'Suspicious strafing pattern - 6 month ban', NULL, 2, '76561198000000001', '2024-12-01 14:30:00', '2024-12-01 14:30:00'),
(3, 'Inappropriate Name', '2025-02-15 00:00:00', NULL, '76561198000000008', 'offensive_name', 'STEAM_1:0:19999507', 'Offensive username', NULL, 3, '76561198000000002', '2025-01-15 09:00:00', '2025-01-15 09:00:00');

-- Insert sample KZ jumpstats
INSERT INTO kz_jumpstats (id, server_id, steamid64, player_name, steam_id, jump_type, distance, tickrate, msl_count, strafe_count, is_crouch_bind, is_forward_bind, is_crouch_boost, updated_by_id, created_on, updated_on) VALUES
(1, 1, '76561198000000002', 'kz_pro_player', 'STEAM_1:0:19999501', 1, 285.5, 128, 0, 8, 0, 0, 0, NULL, '2025-01-16 12:00:00', '2025-01-16 12:00:00'),
(2, 1, '76561198000000001', 'remulian', 'STEAM_1:1:19999500', 1, 278.3, 128, 0, 7, 0, 0, 0, NULL, '2025-01-15 14:30:00', '2025-01-15 14:30:00'),
(3, 2, '76561198000000004', 'old_school_player', 'STEAM_1:0:19999503', 2, 265.8, 102, 1, 6, 0, 0, 0, NULL, '2025-01-14 11:15:00', '2025-01-14 11:15:00'),
(4, 1, '76561198000000003', 'casual_gamer', 'STEAM_1:1:19999502', 1, 260.2, 128, 0, 5, 0, 0, 0, NULL, '2025-01-13 10:00:00', '2025-01-13 10:00:00'),
(5, 3, '76561198000000005', 'newbie_kz', 'STEAM_1:1:19999504', 1, 245.0, 128, 0, 4, 1, 0, 0, NULL, '2025-01-12 09:00:00', '2025-01-12 09:00:00');

-- Insert sample world records cache (player_id is steamid64 as VARCHAR)
INSERT INTO kz_worldrecords_cache (map_id, mode, stage, teleports, player_id, time, points, server_id, created_on) VALUES
(1, 'kz_timer', 0, 0, '76561198000000002', 120.123, 52, 1, '2025-01-16 10:00:00'),
(1, 'kz_timer', 1, 0, '76561198000000001', 35.123, 15, 1, '2025-01-15 12:05:00'),
(2, 'kz_timer', 0, 0, '76561198000000002', 82.456, 45, 2, '2025-01-16 11:00:00'),
(2, 'kz_simple', 0, 1, '76561198000000001', 89.234, 42, 2, '2025-01-14 15:30:00'),
(3, 'kz_timer', 0, 0, '76561198000000001', 45.789, 48, 3, '2025-01-13 10:15:00'),
(4, 'kz_simple', 0, 0, '76561198000000002', 310.789, 38, 5, '2025-01-15 09:00:00'),
(5, 'kz_timer', 0, 0, '76561198000000002', 65.234, 46, 1, '2025-01-14 14:20:00');

-- Insert sample player statistics (pre-calculated stats)
INSERT INTO kz_player_statistics (player_id, steamid64, total_records, total_maps, total_points, total_playtime, avg_teleports, world_records, pro_records, tp_records, best_time, first_record_date, last_record_date) VALUES
(1, '76561198000000001', 4, 3, 155, 295.602, 1.25, 2, 3, 1, 35.123, '2025-01-13 10:15:00', '2025-01-15 12:05:00'),
(2, '76561198000000002', 4, 4, 181, 578.602, 0.00, 4, 4, 0, 65.234, '2025-01-14 14:20:00', '2025-01-16 11:00:00'),
(3, '76561198000000003', 2, 2, 55, 239.468, 11.50, 0, 0, 2, 58.901, '2025-01-11 13:30:00', '2025-01-12 16:45:00'),
(4, '76561198000000004', 2, 2, 79, 290.468, 0.00, 0, 2, 0, 70.123, '2025-01-09 15:45:00', '2025-01-10 11:00:00'),
(5, '76561198000000005', 1, 1, 10, 90.678, 25.00, 0, 0, 1, 90.678, '2025-01-08 12:00:00', '2025-01-08 12:00:00');

-- Insert sample map statistics
INSERT INTO kz_map_statistics (map_id, total_records, unique_players, total_completions, pro_records, tp_records, avg_time, first_record_date, last_record_date) VALUES
(1, 4, 3, 4, 3, 1, 115.317, '2025-01-12 16:45:00', '2025-01-16 10:00:00'),
(2, 2, 2, 2, 1, 1, 85.845, '2025-01-14 15:30:00', '2025-01-16 11:00:00'),
(3, 3, 3, 3, 2, 1, 65.123, '2025-01-08 12:00:00', '2025-01-13 10:15:00'),
(4, 1, 1, 1, 1, 0, 310.789, '2025-01-15 09:00:00', '2025-01-15 09:00:00'),
(5, 2, 2, 2, 2, 0, 67.679, '2025-01-09 15:45:00', '2025-01-14 14:20:00'),
(6, 1, 1, 1, 1, 0, 220.345, '2025-01-10 11:00:00', '2025-01-10 11:00:00');

-- Insert sample server statistics
INSERT INTO kz_server_statistics (server_id, total_records, unique_players, unique_maps, pro_records, tp_records, first_record_date, last_record_date, avg_records_per_day, world_records_hosted) VALUES
(1, 7, 4, 4, 6, 1, '2025-01-09 15:45:00', '2025-01-16 10:00:00', 1.00, 4),
(2, 2, 2, 1, 1, 1, '2025-01-14 15:30:00', '2025-01-16 11:00:00', 1.00, 2),
(3, 3, 3, 1, 2, 1, '2025-01-08 12:00:00', '2025-01-13 10:15:00', 0.60, 1),
(5, 1, 1, 1, 1, 0, '2025-01-15 09:00:00', '2025-01-15 09:00:00', 1.00, 1);

-- Notes:
-- - Steam IDs use STEAM_1 format (legacy) which gets converted to SteamID64 in code
-- - Record times are in seconds with millisecond precision
-- - Teleports: 0 = pro run, >0 = TP run
-- - Points awarded based on map difficulty and time
-- - Tickrate: 128 (CS2), 102.4 (CS:GO common), 64 (CS:GO alternative)
-- - Jump types: 1 = longjump, 2 = multibhop, etc.
-- - Ban types: Bhop Hack, Strafe Hack, Inappropriate Name, etc.
-- - World records cache is updated via stored procedure (refresh_worldrecords_cache)
-- - Statistics tables are populated/refreshed by Node.js kzStatistics service

