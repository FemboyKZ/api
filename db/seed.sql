-- Sample data for testing the Server API
-- This provides realistic test data matching the current schema

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
INSERT INTO players (steamid, latest_name, game, playtime, server_ip, server_port, avatar_small, avatar_medium, avatar_full, avatar_updated_at) VALUES
('76561198000000001', 'remulian', 'csgo', 18900, '37.27.107.76', 27025, 
 'https://avatars.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb.jpg',
 'https://avatars.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_medium.jpg',
 'https://avatars.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_full.jpg',
 NOW()),
('76561198000000001', 'remulian', 'counterstrike2', 25200, '37.27.107.76', 27015,
 'https://avatars.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb.jpg',
 'https://avatars.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_medium.jpg',
 'https://avatars.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_full.jpg',
 NOW()),

-- Player 2 only plays CS2
('76561198000000002', 'kz_pro_player', 'counterstrike2', 43200, '54.39.52.5', 27015,
 'https://avatars.steamstatic.com/b5bd56c1aa4644a474a2e4972be27ef9e82e517e.jpg',
 'https://avatars.steamstatic.com/b5bd56c1aa4644a474a2e4972be27ef9e82e517e_medium.jpg',
 'https://avatars.steamstatic.com/b5bd56c1aa4644a474a2e4972be27ef9e82e517e_full.jpg',
 NOW()),

-- Player 3 plays both games
('76561198000000003', 'casual_gamer', 'csgo', 12600, '37.27.107.76', 27025,
 'https://avatars.steamstatic.com/c5d56249ee5d28a07db4ac9f7f60af961fab5426.jpg',
 'https://avatars.steamstatic.com/c5d56249ee5d28a07db4ac9f7f60af961fab5426_medium.jpg',
 'https://avatars.steamstatic.com/c5d56249ee5d28a07db4ac9f7f60af961fab5426_full.jpg',
 NOW()),
('76561198000000003', 'casual_gamer', 'counterstrike2', 16200, '37.27.107.76', 27016,
 'https://avatars.steamstatic.com/c5d56249ee5d28a07db4ac9f7f60af961fab5426.jpg',
 'https://avatars.steamstatic.com/c5d56249ee5d28a07db4ac9f7f60af961fab5426_medium.jpg',
 'https://avatars.steamstatic.com/c5d56249ee5d28a07db4ac9f7f60af961fab5426_full.jpg',
 NOW()),

-- Player 4 only plays CS:GO
('76561198000000004', 'old_school_player', 'csgo', 36000, '54.39.52.5', 27025,
 'https://avatars.steamstatic.com/fe3bb3eef3bb8fe4f3f3bb3eef3bb8fe4f3f3bb3.jpg',
 'https://avatars.steamstatic.com/fe3bb3eef3bb8fe4f3f3bb3eef3bb8fe4f3f3bb3_medium.jpg',
 'https://avatars.steamstatic.com/fe3bb3eef3bb8fe4f3f3bb3eef3bb8fe4f3f3bb3_full.jpg',
 NOW()),

-- Player 5 CS2 beginner
('76561198000000005', 'newbie_kz', 'counterstrike2', 5400, '149.40.54.210', 26532,
 NULL, NULL, NULL, NULL);

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

