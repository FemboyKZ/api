-- Sample data for testing the Server API

-- Insert sample servers
INSERT INTO servers (ip, port, game, status, map, player_count, version) VALUES
('127.0.0.1', 27015, 'csgo', 1, 'de_dust2', 12, '1.38.7.9'),
('127.0.0.1', 27016, 'counterstrike2', 1, 'de_mirage', 8, '1.0.0.1'),
('192.168.1.100', 27017, 'csgo', 0, 'de_inferno', 0, '1.38.7.9');

-- Insert sample players
INSERT INTO players (steamid, name, playtime, server_ip, server_port) VALUES
('76561198000000001', 'Player1', 3600, '127.0.0.1', 27015),
('76561198000000001', 'Player1', 1800, '127.0.0.1', 27016),
('76561198000000002', 'Player2', 7200, '127.0.0.1', 27015),
('76561198000000003', 'Player3', 5400, '127.0.0.1', 27016);

-- Insert sample map data
INSERT INTO maps (name, playtime, server_ip, server_port) VALUES
('de_dust2', 10800, '127.0.0.1', 27015),
('de_mirage', 7200, '127.0.0.1', 27016),
('de_inferno', 3600, '127.0.0.1', 27015),
('de_nuke', 5400, '127.0.0.1', 27016);
