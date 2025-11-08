-- Create kz_modes table
-- This table stores the three KZ modes: kz_timer, kz_simple, kz_vanilla

CREATE TABLE IF NOT EXISTS kz_modes (
  id INT PRIMARY KEY,
  name VARCHAR(50) NOT NULL UNIQUE,
  description TEXT,
  latest_version INT,
  latest_version_description VARCHAR(50),
  website VARCHAR(255),
  repo VARCHAR(255),
  contact_steamid64 VARCHAR(20),
  supported_tickrates TEXT,
  created_on DATETIME,
  updated_on DATETIME,
  updated_by_id VARCHAR(20),
  INDEX idx_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert the three KZ modes
INSERT INTO kz_modes (
  id,
  name,
  description,
  latest_version,
  latest_version_description,
  website,
  repo,
  contact_steamid64,
  supported_tickrates,
  created_on,
  updated_on,
  updated_by_id
) VALUES
(
  200,
  'kz_timer',
  'KZTimerGlobal mode.  Bunch of jumps and bhops and stuff.',
  2171,
  '1.106',
  'forum.gokz.org',
  'https://bitbucket.org/kztimerglobalteam/kztimerglobal',
  '76561198165203332',
  NULL,
  '0001-01-01 00:00:00',
  '2018-01-09 10:45:50',
  '76561198003275951'
),
(
  201,
  'kz_simple',
  'SimpleKZ mode. RNG? We don''t need no stinkin RNG.',
  211,
  '3.6.3',
  'forum.gokz.org',
  'https://github.com/KZGlobalTeam/gokz',
  '76561197989817982',
  NULL,
  '0001-01-01 00:00:00',
  '2018-01-09 10:45:50',
  '76561198003275951'
),
(
  202,
  'kz_vanilla',
  'Vanilla mode. We need RNG.',
  171,
  '3.6.3',
  'forum.gokz.org',
  'https://github.com/KZGlobalTeam/gokz',
  '76561197989817982',
  NULL,
  '0001-01-01 00:00:00',
  '2018-01-09 10:45:50',
  '76561197989817982'
);
