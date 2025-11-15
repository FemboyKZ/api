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