-- Server API Database Schema
-- MySQL/MariaDB DDL

-- Create database (optional - run manually if needed)
-- CREATE DATABASE IF NOT EXISTS server_api;
-- USE server_api;

-- Servers table: tracks game server status
CREATE TABLE IF NOT EXISTS servers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ip VARCHAR(45) NOT NULL,
    port INT NOT NULL,
    game VARCHAR(50) NOT NULL,
    status TINYINT NOT NULL DEFAULT 0,
    map VARCHAR(100) DEFAULT '',
    player_count INT DEFAULT 0,
    maxplayers INT DEFAULT 0,
    players_list JSON DEFAULT NULL COMMENT 'JSON array of current players on server',
    version VARCHAR(50) DEFAULT '',
    mm_version VARCHAR(50) DEFAULT NULL COMMENT 'Metamod:Source version',
    sm_version VARCHAR(50) DEFAULT NULL COMMENT 'SourceMod version',
    gokz_loaded TINYINT DEFAULT NULL COMMENT 'Whether GOKZ plugin is loaded (1=yes, 0=no)',
    cs2kz_loaded TINYINT DEFAULT NULL COMMENT 'Whether CS2KZ plugin is loaded (1=yes, 0=no)',
    hostname VARCHAR(255) DEFAULT NULL COMMENT 'Server hostname from RCON',
    os VARCHAR(100) DEFAULT NULL COMMENT 'Server OS/type from RCON',
    secure TINYINT DEFAULT NULL COMMENT 'VAC secure status: 1=secure, 0=insecure',
    bot_count INT DEFAULT 0 COMMENT 'Number of bots on server',
    api_id INT DEFAULT NULL COMMENT 'CS2KZ API server ID (for CS2 servers)',
    kzt_id INT DEFAULT NULL COMMENT 'GlobalKZ API server ID (for CS:GO servers)',
    tickrate INT DEFAULT NULL COMMENT 'Server tickrate (64, 128, etc.)',
    region VARCHAR(50) DEFAULT NULL COMMENT 'Server region (eu, na, as, au, sa, za)',
    domain VARCHAR(255) DEFAULT NULL COMMENT 'Server domain/website',
    last_update TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_server (ip, port),
    INDEX idx_status (status),
    INDEX idx_last_update (last_update),
    INDEX idx_api_id (api_id),
    INDEX idx_kzt_id (kzt_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Players table: tracks player activity and playtime
CREATE TABLE IF NOT EXISTS players (
    id INT AUTO_INCREMENT PRIMARY KEY,
    steamid VARCHAR(20) NOT NULL,
    name VARCHAR(100) DEFAULT '' COMMENT 'Deprecated: use latest_name instead',
    latest_name VARCHAR(255) DEFAULT NULL COMMENT 'Most recent name seen',
    game VARCHAR(50) NOT NULL COMMENT 'Game type: csgo, counterstrike2, etc.',
    playtime INT DEFAULT 0 COMMENT 'Total playtime in seconds (all modes)',
    playtime_modes JSON DEFAULT NULL COMMENT 'Per-gamemode playtime in seconds. gokz: {kz_vanilla,kz_simple,kz_timer}; cs2kz: {cs2kz_vnl,cs2kz_ckz}',
    server_ip VARCHAR(45),
    server_port INT,
    latest_ip VARCHAR(45) DEFAULT NULL COMMENT 'Most recent IP address seen (private)',
    avatar VARCHAR(255) DEFAULT NULL COMMENT 'Steam avatar URL (32x32, append _medium.jpg or _full.jpg for larger sizes)',
    avatar_updated_at TIMESTAMP NULL DEFAULT NULL COMMENT 'When avatar was last fetched from Steam API',
    last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_player_game (steamid, game),
    INDEX idx_steamid (steamid),
    INDEX idx_game (game),
    INDEX idx_server (server_ip, server_port),
    INDEX idx_last_seen (last_seen)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Player names history: tracks all names a player has used
CREATE TABLE IF NOT EXISTS player_names (
    id INT AUTO_INCREMENT PRIMARY KEY,
    steamid VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    use_count INT DEFAULT 1 COMMENT 'Number of times this name was seen',
    INDEX idx_steamid (steamid),
    INDEX idx_name (name),
    INDEX idx_last_seen (last_seen),
    UNIQUE KEY unique_steamid_name (steamid, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Player IPs history: tracks all IP addresses a player has used (PRIVATE - not exposed via API)
CREATE TABLE IF NOT EXISTS player_ips (
    id INT AUTO_INCREMENT PRIMARY KEY,
    steamid VARCHAR(255) NOT NULL,
    ip VARCHAR(45) NOT NULL,
    first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    use_count INT DEFAULT 1 COMMENT 'Number of times this IP was seen',
    INDEX idx_steamid (steamid),
    INDEX idx_ip (ip),
    INDEX idx_last_seen (last_seen),
    UNIQUE KEY unique_steamid_ip (steamid, ip)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Player meta: per-player Discord ID and permission roles (one row per steamid)
CREATE TABLE IF NOT EXISTS player_meta (
    id INT AUTO_INCREMENT PRIMARY KEY,
    steamid VARCHAR(20) NOT NULL,
    discord_id VARCHAR(30) DEFAULT NULL COMMENT 'Discord user ID (snowflake)',
    discord_username VARCHAR(64) DEFAULT NULL COMMENT 'Discord display name (cached for UI)',
    email VARCHAR(255) DEFAULT NULL COMMENT 'Verified contact email (lowercased), private',
    email_verified_at TIMESTAMP NULL DEFAULT NULL COMMENT 'When email was verified',
    total_spent_eur DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT 'Lifetime EUR credited (claimed + gifted-in)',
    gift_tokens INT NOT NULL DEFAULT 0 COMMENT 'Available VIP gift tokens to redeem to others',
    gift_tokens_granted INT NOT NULL DEFAULT 0 COMMENT 'Lifetime gift tokens granted (prevents re-grant)',
    permissions JSON DEFAULT NULL COMMENT 'Null if no permissions, else {roles:[], customRole:{id,color,name}|null, customTag:{color,name}|null}',
    whitelisted BOOLEAN DEFAULT FALSE COMMENT 'Whether the player is whitelisted',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_steamid (steamid),
    INDEX idx_steamid (steamid),
    INDEX idx_discord_id (discord_id),
    UNIQUE KEY uniq_email (email),
    INDEX idx_whitelisted (whitelisted)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Pending email verifications (raw token returned once to caller; only hash stored)
CREATE TABLE IF NOT EXISTS player_email_verifications (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    steamid VARCHAR(20) NOT NULL,
    email VARCHAR(255) NOT NULL COMMENT 'Email being verified (lowercased)',
    token_hash CHAR(64) NOT NULL COMMENT 'SHA-256 hex of the verification token',
    expires_at TIMESTAMP NOT NULL,
    consumed_at TIMESTAMP NULL DEFAULT NULL COMMENT 'When the token was used (null = unused)',
    attempts INT NOT NULL DEFAULT 0 COMMENT 'Failed verify attempts against this record',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_token (token_hash),
    INDEX idx_steamid (steamid),
    INDEX idx_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Contact history: every email/discord ever linked/replaced/unlinked (fraud detection, PRIVATE)
CREATE TABLE IF NOT EXISTS player_contact_history (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    steamid VARCHAR(20) NOT NULL,
    type VARCHAR(16) NOT NULL COMMENT 'email | discord',
    value VARCHAR(255) NOT NULL COMMENT 'The email or discord_id (lowercased for email)',
    action VARCHAR(16) NOT NULL COMMENT 'linked | unlinked | replaced',
    note VARCHAR(255) DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_steamid (steamid),
    INDEX idx_value (value),
    INDEX idx_type_value (type, value),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Ko-fi transactions: webhook events (tips, subscriptions, commissions, shop orders)
CREATE TABLE IF NOT EXISTS kofi_transactions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    message_id VARCHAR(64) NOT NULL COMMENT 'Ko-fi message_id (uuid) - used for idempotent dedupe',
    kofi_transaction_id VARCHAR(64) DEFAULT NULL COMMENT 'Ko-fi internal transaction id',
    type VARCHAR(32) NOT NULL COMMENT 'Tip | Subscription | Commission | Shop Order',
    from_name VARCHAR(255) DEFAULT NULL,
    email VARCHAR(255) DEFAULT NULL COMMENT 'Buyer email from Ko-fi (private)',
    message TEXT DEFAULT NULL COMMENT 'Buyer message/note (may contain SteamID)',
    is_public BOOLEAN DEFAULT FALSE COMMENT 'If false, message must be hidden when displayed publicly',
    amount DECIMAL(10,2) DEFAULT 0,
    amount_eur DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT 'amount converted to EUR at processing time',
    currency VARCHAR(8) DEFAULT NULL,
    is_subscription_payment BOOLEAN DEFAULT FALSE,
    is_first_subscription_payment BOOLEAN DEFAULT FALSE,
    tier_name VARCHAR(255) DEFAULT NULL COMMENT 'Membership tier (subscriptions)',
    shop_items JSON DEFAULT NULL COMMENT 'Array of {direct_link_code, variation_name, quantity}',
    url VARCHAR(512) DEFAULT NULL,
    steamid VARCHAR(20) DEFAULT NULL COMMENT 'Resolved buyer SteamID64, NULL if unmatched',
    status VARCHAR(16) NOT NULL DEFAULT 'pending' COMMENT 'resolution: pending | matched | ignored',
    claim_status VARCHAR(16) NOT NULL DEFAULT 'unclaimed' COMMENT 'unclaimed | claimed | gifted',
    beneficiary_steamid VARCHAR(20) DEFAULT NULL COMMENT 'SteamID credited (self or gift recipient)',
    claimed_at TIMESTAMP NULL DEFAULT NULL,
    kofi_timestamp TIMESTAMP NULL DEFAULT NULL COMMENT 'Ko-fi event timestamp',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_message (message_id),
    INDEX idx_steamid (steamid),
    INDEX idx_status (status),
    INDEX idx_claim_status (claim_status),
    INDEX idx_beneficiary (beneficiary_steamid),
    INDEX idx_type (type),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Gifts targeted at an as-yet-unregistered email/SteamID (redeemed on link)
CREATE TABLE IF NOT EXISTS pending_gifts (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    kind VARCHAR(16) NOT NULL COMMENT 'credit (adds EUR to total) | vip (grants base VIP only)',
    target_type VARCHAR(16) NOT NULL DEFAULT 'email' COMMENT 'email | steamid',
    target_value VARCHAR(255) NOT NULL COMMENT 'email (lowercased) or SteamID64',
    amount_eur DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT 'EUR credited (kind=credit)',
    source_steamid VARCHAR(20) DEFAULT NULL COMMENT 'Gifter SteamID',
    source_transaction_id BIGINT DEFAULT NULL COMMENT 'Originating kofi_transactions.id',
    redeemed_steamid VARCHAR(20) DEFAULT NULL,
    redeemed_at TIMESTAMP NULL DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_target (target_type, target_value),
    INDEX idx_redeemed (redeemed_at),
    INDEX idx_source (source_steamid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Maps table: tracks map playtime statistics
CREATE TABLE IF NOT EXISTS maps (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    game VARCHAR(50) NOT NULL COMMENT 'Game type: csgo, counterstrike2, etc.',
    playtime INT DEFAULT 0 COMMENT 'Total playtime in seconds',
    server_ip VARCHAR(45),
    server_port INT,
    last_played TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_map_game (name, game),
    INDEX idx_name (name),
    INDEX idx_game (game),
    INDEX idx_server (server_ip, server_port),
    INDEX idx_playtime (playtime DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chat_messages (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  server_ip   VARCHAR(45)     NOT NULL COMMENT 'Origin server IP',
  server_port SMALLINT UNSIGNED NOT NULL COMMENT 'Origin server port',
  alias       VARCHAR(64)     NOT NULL COMMENT 'Origin server alias',
  game        VARCHAR(32)     NOT NULL COMMENT 'counterstrike2 | csgo',
  region      VARCHAR(8)      DEFAULT NULL COMMENT 'eu/na/as/...',
  steamid     VARCHAR(20)     DEFAULT NULL COMMENT 'SteamID64 of the author',
  name        VARCHAR(64)     NOT NULL COMMENT 'Author display name (sanitized)',
  message     VARCHAR(512)    NOT NULL COMMENT 'Chat text (sanitized)',
  team        TINYINT         NOT NULL DEFAULT 0 COMMENT '1 = say_team, 0 = say',
  created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_created (created_at),
  INDEX idx_server (server_ip, server_port)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Server history: snapshots of server status over time
CREATE TABLE IF NOT EXISTS server_history (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    server_ip VARCHAR(45) NOT NULL,
    server_port INT NOT NULL,
    game VARCHAR(50) NOT NULL,
    status TINYINT NOT NULL,
    map VARCHAR(100) DEFAULT '',
    player_count INT DEFAULT 0,
    maxplayers INT DEFAULT 0,
    version VARCHAR(50) DEFAULT '',
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_server (server_ip, server_port),
    INDEX idx_recorded_at (recorded_at),
    INDEX idx_server_time (server_ip, server_port, recorded_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Player session history: tracks when players join/leave servers
CREATE TABLE IF NOT EXISTS player_sessions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    steamid VARCHAR(20) NOT NULL,
    name VARCHAR(100) DEFAULT '',
    server_ip VARCHAR(45) NOT NULL,
    server_port INT NOT NULL,
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    left_at TIMESTAMP NULL DEFAULT NULL,
    duration INT DEFAULT 0 COMMENT 'Session duration in seconds',
    INDEX idx_steamid (steamid),
    INDEX idx_server (server_ip, server_port),
    INDEX idx_joined_at (joined_at),
    INDEX idx_session (steamid, server_ip, server_port, joined_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Map rotation history: tracks map changes on servers
CREATE TABLE IF NOT EXISTS map_history (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    server_ip VARCHAR(45) NOT NULL,
    server_port INT NOT NULL,
    map_name VARCHAR(100) NOT NULL,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMP NULL DEFAULT NULL,
    duration INT DEFAULT 0 COMMENT 'Map duration in seconds',
    player_count_avg INT DEFAULT 0,
    player_count_peak INT DEFAULT 0,
    INDEX idx_server (server_ip, server_port),
    INDEX idx_map (map_name),
    INDEX idx_started_at (started_at),
    INDEX idx_server_time (server_ip, server_port, started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Daily aggregations: pre-computed statistics for faster queries
CREATE TABLE IF NOT EXISTS daily_stats (
    id INT AUTO_INCREMENT PRIMARY KEY,
    stat_date DATE NOT NULL,
    server_ip VARCHAR(45) NOT NULL,
    server_port INT NOT NULL,
    total_players INT DEFAULT 0,
    unique_players INT DEFAULT 0,
    peak_players INT DEFAULT 0,
    avg_players DECIMAL(5,2) DEFAULT 0,
    uptime_minutes INT DEFAULT 0,
    total_maps_played INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_daily_stat (stat_date, server_ip, server_port),
    INDEX idx_date (stat_date),
    INDEX idx_server (server_ip, server_port)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create settings table for storing persistent key-value pairs
-- Used for Discord message IDs, scraper state, etc.
CREATE TABLE IF NOT EXISTS settings (
  setting_key VARCHAR(255) PRIMARY KEY,
  setting_value TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add initial Discord message ID placeholders
INSERT INTO settings (setting_key, setting_value) VALUES
  ('discord_message_id_csgo', ''),
  ('discord_message_id_cs2', '')
ON DUPLICATE KEY UPDATE setting_key = setting_key;
