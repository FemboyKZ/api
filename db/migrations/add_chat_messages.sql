-- Cross-server chat relay history.
-- Every chat message captured by the in-game plugins (CS2 MM:S + CSGO/GOKZ SM)
-- is POSTed to /chat/messages, relayed live to the other servers via long-poll,
-- and persisted here for history / moderation / web display.

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
