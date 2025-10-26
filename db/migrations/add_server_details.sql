-- Add server details from RCON (hostname, OS, VAC secure status, bot count)
ALTER TABLE servers
ADD COLUMN hostname VARCHAR(255) DEFAULT NULL COMMENT 'Server hostname from RCON' AFTER version,
ADD COLUMN os VARCHAR(100) DEFAULT NULL COMMENT 'Server OS/type from RCON' AFTER hostname,
ADD COLUMN secure TINYINT DEFAULT NULL COMMENT 'VAC secure status: 1=secure, 0=insecure' AFTER os,
ADD COLUMN bot_count INT DEFAULT 0 COMMENT 'Number of bots on server' AFTER secure;
