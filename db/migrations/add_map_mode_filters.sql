-- Migration: Add mode-specific map filtering
-- This table defines which modes a map should be tracked for
-- Maps not in this table will be tracked for all modes (default behavior)
-- Maps with entries will ONLY be tracked for the specified modes

-- Map mode filters table
CREATE TABLE IF NOT EXISTS kz_map_mode_filters (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  map_id INT UNSIGNED NOT NULL,
  mode VARCHAR(32) NOT NULL COMMENT 'kz_timer, kz_simple, kz_vanilla',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE KEY unique_map_mode (map_id, mode),
  INDEX idx_mode (mode),
  CONSTRAINT fk_map_mode_filter_map FOREIGN KEY (map_id) REFERENCES kz_maps(id) ON DELETE CASCADE
) COMMENT = 'Defines which modes a map should be tracked for' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Procedure to add mode filter for a map by name
DELIMITER //
CREATE PROCEDURE IF NOT EXISTS add_map_mode_filter(
  IN p_map_name VARCHAR(255),
  IN p_mode VARCHAR(32)
)
BEGIN
  DECLARE v_map_id INT UNSIGNED;
  
  SELECT id INTO v_map_id FROM kz_maps WHERE map_name = p_map_name LIMIT 1;
  
  IF v_map_id IS NOT NULL THEN
    INSERT IGNORE INTO kz_map_mode_filters (map_id, mode) VALUES (v_map_id, p_mode);
  END IF;
END //
DELIMITER ;

-- View to check which maps have mode restrictions
CREATE OR REPLACE VIEW v_map_modes AS
SELECT 
  m.id as map_id,
  m.map_name,
  m.difficulty,
  m.validated,
  GROUP_CONCAT(mmf.mode ORDER BY mmf.mode) as allowed_modes,
  CASE WHEN COUNT(mmf.id) = 0 THEN 'all' ELSE 'restricted' END as mode_status
FROM kz_maps m
LEFT JOIN kz_map_mode_filters mmf ON m.id = mmf.map_id
GROUP BY m.id, m.map_name, m.difficulty, m.validated
ORDER BY m.map_name;
