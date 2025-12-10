/*M!999999\- enable the sandbox mode */ 
-- MariaDB dump 10.19  Distrib 10.11.14-MariaDB, for debian-linux-gnu (x86_64)
--
-- Host: localhost    Database: fkz_kz_records
-- ------------------------------------------------------
-- Server version	12.0.2-MariaDB-ubu2404-log

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `kz_bans`
--

DROP TABLE IF EXISTS `kz_bans`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `kz_bans` (
  `id` int(11) NOT NULL,
  `ban_type` varchar(50) NOT NULL,
  `expires_on` datetime DEFAULT NULL,
  `ip` varchar(45) DEFAULT NULL,
  `steamid64` varchar(20) DEFAULT NULL,
  `player_name` varchar(255) DEFAULT NULL,
  `steam_id` varchar(32) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `stats` text DEFAULT NULL,
  `server_id` int(11) DEFAULT NULL,
  `updated_by_id` varchar(20) DEFAULT NULL,
  `created_on` datetime DEFAULT NULL,
  `updated_on` datetime DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_steamid64` (`steamid64`),
  KEY `idx_ban_type` (`ban_type`),
  KEY `idx_server_id` (`server_id`),
  KEY `idx_expires_on` (`expires_on`),
  KEY `idx_created_on` (`created_on`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `kz_jumpstats`
--

DROP TABLE IF EXISTS `kz_jumpstats`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `kz_jumpstats` (
  `id` int(11) NOT NULL,
  `server_id` int(10) unsigned DEFAULT NULL,
  `steamid64` varchar(20) DEFAULT NULL,
  `player_name` varchar(255) DEFAULT NULL,
  `steam_id` varchar(32) DEFAULT NULL,
  `jump_type` int(11) NOT NULL,
  `distance` float NOT NULL,
  `tickrate` int(11) DEFAULT NULL,
  `msl_count` int(11) DEFAULT NULL,
  `strafe_count` int(11) DEFAULT NULL,
  `is_crouch_bind` smallint(6) NOT NULL DEFAULT 0,
  `is_forward_bind` smallint(6) NOT NULL DEFAULT 0,
  `is_crouch_boost` smallint(6) NOT NULL DEFAULT 0,
  `updated_by_id` varchar(20) DEFAULT NULL,
  `created_on` datetime DEFAULT NULL,
  `updated_on` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_leaderboard` (`jump_type`,`is_crouch_bind`,`is_forward_bind`,`is_crouch_boost`,`distance` DESC),
  KEY `idx_player_jumps` (`steamid64`,`jump_type`,`created_on` DESC),
  KEY `idx_server_jumps` (`server_id`,`created_on` DESC),
  KEY `fk_jump_updater` (`updated_by_id`),
  CONSTRAINT `fk_jump_player` FOREIGN KEY (`steamid64`) REFERENCES `kz_players` (`steamid64`) ON DELETE CASCADE,
  CONSTRAINT `fk_jump_server` FOREIGN KEY (`server_id`) REFERENCES `kz_servers` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_jump_updater` FOREIGN KEY (`updated_by_id`) REFERENCES `kz_players` (`steamid64`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Temporary table structure for view `kz_map_leaderboard`
--

DROP TABLE IF EXISTS `kz_map_leaderboard`;
/*!50001 DROP VIEW IF EXISTS `kz_map_leaderboard`*/;
SET @saved_cs_client     = @@character_set_client;
SET character_set_client = utf8mb4;
/*!50001 CREATE VIEW `kz_map_leaderboard` AS SELECT
 1 AS `id`,
  1 AS `map_id`,
  1 AS `mode`,
  1 AS `stage`,
  1 AS `total_records`,
  1 AS `unique_players`,
  1 AS `world_record_time`,
  1 AS `world_record_player_id`,
  1 AS `avg_time`,
  1 AS `median_time`,
  1 AS `updated_at`,
  1 AS `difficulty`,
  1 AS `validated`,
  1 AS `workshop_url` */;
SET character_set_client = @saved_cs_client;

--
-- Table structure for table `kz_map_statistics`
--

DROP TABLE IF EXISTS `kz_map_statistics`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `kz_map_statistics` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `map_id` int(10) unsigned NOT NULL,
  `mode` varchar(32) NOT NULL,
  `stage` tinyint(3) unsigned NOT NULL DEFAULT 0,
  `total_records` int(10) unsigned NOT NULL DEFAULT 0,
  `unique_players` int(10) unsigned NOT NULL DEFAULT 0,
  `world_record_time` decimal(10,3) DEFAULT NULL,
  `world_record_player_id` int(10) unsigned DEFAULT NULL,
  `avg_time` decimal(10,3) DEFAULT NULL,
  `median_time` decimal(10,3) DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_map_mode_stage` (`map_id`,`mode`,`stage`),
  KEY `idx_mode` (`mode`),
  CONSTRAINT `kz_map_statistics_ibfk_1` FOREIGN KEY (`map_id`) REFERENCES `kz_maps` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=3786 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `kz_maps`
--

DROP TABLE IF EXISTS `kz_maps`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `kz_maps` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `map_id` int(11) NOT NULL,
  `map_name` varchar(255) NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `filesize` int(11) DEFAULT NULL COMMENT 'Map file size in bytes',
  `validated` tinyint(1) DEFAULT NULL COMMENT 'Whether map is validated by KZ team',
  `difficulty` tinyint(4) DEFAULT NULL COMMENT 'Map difficulty (1-7)',
  `approved_by_steamid64` varchar(20) DEFAULT NULL COMMENT 'SteamID64 of approver',
  `workshop_url` varchar(500) DEFAULT NULL COMMENT 'Steam Workshop URL',
  `download_url` varchar(500) DEFAULT NULL COMMENT 'Direct download URL',
  `global_created_on` datetime DEFAULT NULL COMMENT 'Creation timestamp from GlobalKZ',
  `global_updated_on` datetime DEFAULT NULL COMMENT 'Last update timestamp from GlobalKZ',
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_map_id_name` (`map_id`,`map_name`),
  KEY `idx_map_name` (`map_name`(50)),
  KEY `idx_validated` (`validated`),
  KEY `idx_difficulty` (`difficulty`),
  KEY `idx_maps_id` (`id`),
  KEY `idx_maps_stats` (`validated`,`difficulty`,`map_name`(50)),
  KEY `idx_difficulty_validated` (`difficulty`,`validated`)
) ENGINE=InnoDB AUTO_INCREMENT=794843 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `kz_modes`
--

DROP TABLE IF EXISTS `kz_modes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `kz_modes` (
  `id` int(11) NOT NULL,
  `name` varchar(50) NOT NULL,
  `description` text DEFAULT NULL,
  `latest_version` int(11) DEFAULT NULL,
  `latest_version_description` varchar(50) DEFAULT NULL,
  `website` varchar(255) DEFAULT NULL,
  `repo` varchar(255) DEFAULT NULL,
  `contact_steamid64` varchar(20) DEFAULT NULL,
  `supported_tickrates` text DEFAULT NULL,
  `created_on` datetime DEFAULT NULL,
  `updated_on` datetime DEFAULT NULL,
  `updated_by_id` varchar(20) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`),
  KEY `idx_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `kz_player_statistics`
--

DROP TABLE IF EXISTS `kz_player_statistics`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `kz_player_statistics` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `player_id` int(10) unsigned NOT NULL,
  `steamid64` varchar(20) DEFAULT NULL,
  `total_records` int(10) unsigned NOT NULL DEFAULT 0,
  `total_maps` int(10) unsigned NOT NULL DEFAULT 0,
  `total_points` bigint(20) unsigned NOT NULL DEFAULT 0,
  `total_playtime` decimal(12,3) NOT NULL DEFAULT 0.000,
  `avg_teleports` decimal(6,2) NOT NULL DEFAULT 0.00,
  `world_records` int(10) unsigned NOT NULL DEFAULT 0,
  `pro_records` int(10) unsigned NOT NULL DEFAULT 0,
  `tp_records` int(10) unsigned NOT NULL DEFAULT 0,
  `best_time` decimal(10,3) DEFAULT NULL,
  `first_record_date` datetime DEFAULT NULL,
  `last_record_date` datetime DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_player` (`player_id`),
  KEY `idx_total_records` (`total_records` DESC),
  KEY `idx_total_points` (`total_points` DESC),
  KEY `idx_world_records` (`world_records` DESC),
  KEY `idx_updated` (`updated_at`),
  CONSTRAINT `kz_player_statistics_ibfk_1` FOREIGN KEY (`player_id`) REFERENCES `kz_players` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=735088 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `kz_players`
--

DROP TABLE IF EXISTS `kz_players`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `kz_players` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `steamid64` varchar(20) NOT NULL,
  `steam_id` varchar(32) NOT NULL,
  `player_name` varchar(100) NOT NULL,
  `is_banned` tinyint(1) DEFAULT 0,
  `total_records` int(11) DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `steamid64` (`steamid64`),
  KEY `idx_steam_id` (`steam_id`),
  KEY `idx_player_name` (`player_name`(20)),
  KEY `idx_is_banned` (`is_banned`),
  KEY `idx_total_records` (`total_records`),
  KEY `idx_players_steamid64` (`steamid64`),
  KEY `idx_players_is_banned` (`is_banned`),
  KEY `idx_players_ban_lookup` (`steamid64`,`is_banned`),
  KEY `idx_players_name_ban` (`player_name`(50),`is_banned`)
) ENGINE=InnoDB AUTO_INCREMENT=9224718 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `kz_record_filters`
--

DROP TABLE IF EXISTS `kz_record_filters`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `kz_record_filters` (
  `id` int(11) NOT NULL,
  `map_id` int(11) NOT NULL,
  `stage` tinyint(4) NOT NULL DEFAULT 0,
  `mode_id` int(11) NOT NULL,
  `tickrate` smallint(6) NOT NULL,
  `has_teleports` tinyint(1) NOT NULL DEFAULT 0,
  `created_on` datetime DEFAULT NULL,
  `updated_on` datetime DEFAULT NULL,
  `updated_by_id` varchar(20) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_filter` (`map_id`,`stage`,`mode_id`,`tickrate`,`has_teleports`),
  KEY `idx_map_mode` (`map_id`,`mode_id`),
  KEY `idx_mode` (`mode_id`),
  KEY `idx_stage` (`stage`),
  KEY `idx_tickrate` (`tickrate`),
  KEY `idx_teleports` (`has_teleports`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `kz_records`
--

DROP TABLE IF EXISTS `kz_records`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `kz_records` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `original_id` bigint(20) unsigned DEFAULT NULL,
  `player_id` int(10) unsigned NOT NULL,
  `steamid64` varchar(20) DEFAULT NULL,
  `map_id` int(10) unsigned NOT NULL,
  `server_id` int(10) unsigned NOT NULL,
  `mode` varchar(32) NOT NULL,
  `stage` tinyint(3) unsigned NOT NULL DEFAULT 0,
  `time` decimal(10,3) NOT NULL,
  `teleports` smallint(5) unsigned NOT NULL DEFAULT 0,
  `points` int(11) NOT NULL DEFAULT 0,
  `tickrate` smallint(5) unsigned NOT NULL DEFAULT 128,
  `record_filter_id` int(11) NOT NULL DEFAULT 0,
  `replay_id` int(10) unsigned NOT NULL DEFAULT 0,
  `updated_by` int(11) NOT NULL DEFAULT 0,
  `created_on` timestamp NOT NULL,
  `updated_on` timestamp NOT NULL,
  `inserted_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_original_id_unique` (`original_id`),
  KEY `idx_player_id` (`player_id`),
  KEY `idx_map_id` (`map_id`),
  KEY `idx_server_id` (`server_id`),
  KEY `idx_player_time` (`player_id`,`time`),
  KEY `idx_map_time` (`map_id`,`time`),
  KEY `idx_mode_time` (`mode`,`time`),
  KEY `idx_created_on` (`created_on`),
  KEY `idx_compound_player_map` (`player_id`,`map_id`,`mode`,`stage`),
  KEY `idx_compound_map_mode` (`map_id`,`mode`,`time`),
  KEY `idx_steamid64` (`steamid64`),
  KEY `idx_records_mode_stage_teleports` (`mode`,`stage`,`teleports`),
  KEY `idx_records_created_on` (`created_on` DESC),
  KEY `idx_records_map_id_mode_stage_time` (`map_id`,`mode`,`stage`,`time`),
  KEY `idx_records_player_id` (`player_id`),
  KEY `idx_records_composite` (`mode`,`stage`,`teleports`,`time`),
  KEY `idx_records_wr_lookup` (`mode`,`stage`,`teleports`,`map_id`,`time`),
  KEY `idx_records_wr_with_player` (`mode`,`stage`,`map_id`,`player_id`,`time`,`teleports`),
  KEY `idx_records_map_leaderboard` (`map_id`,`mode`,`stage`,`teleports`,`player_id`,`time`),
  KEY `idx_records_player_best` (`player_id`,`map_id`,`mode`,`stage`,`time`),
  KEY `idx_records_recent_mode` (`created_on` DESC,`mode`,`stage`),
  KEY `idx_records_recent_map` (`created_on` DESC,`map_id`,`mode`),
  KEY `idx_records_player_mode` (`player_id`,`mode`,`stage`,`created_on` DESC),
  KEY `idx_records_player_stats` (`player_id`,`mode`,`time`,`points`),
  KEY `idx_records_server_stats` (`server_id`,`created_on` DESC,`mode`),
  KEY `idx_records_player_map_covering` (`player_id`,`map_id`,`mode`,`stage`,`time`,`teleports`,`points`,`created_on`),
  KEY `idx_records_wr_covering` (`mode`,`stage`,`teleports`,`map_id`,`time`,`player_id`,`points`,`server_id`,`created_on`),
  KEY `idx_player_map_mode` (`player_id`,`map_id`,`mode`,`stage`,`time`),
  KEY `idx_leaderboard` (`player_id`,`map_id`,`mode`,`stage`,`teleports`,`time`),
  CONSTRAINT `fk_player` FOREIGN KEY (`player_id`) REFERENCES `kz_players` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=26816445 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Temporary table structure for view `kz_records_by_year`
--

DROP TABLE IF EXISTS `kz_records_by_year`;
/*!50001 DROP VIEW IF EXISTS `kz_records_by_year`*/;
SET @saved_cs_client     = @@character_set_client;
SET character_set_client = utf8mb4;
/*!50001 CREATE VIEW `kz_records_by_year` AS SELECT
 1 AS `year`,
  1 AS `record_count`,
  1 AS `unique_players`,
  1 AS `unique_maps`,
  1 AS `first_record`,
  1 AS `last_record` */;
SET character_set_client = @saved_cs_client;

--
-- Table structure for table `kz_records_partitioned`
--

DROP TABLE IF EXISTS `kz_records_partitioned`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `kz_records_partitioned` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `original_id` bigint(20) unsigned DEFAULT NULL,
  `player_id` varchar(20) NOT NULL,
  `steamid64` varchar(20) DEFAULT NULL,
  `map_id` int(10) unsigned NOT NULL,
  `server_id` int(10) unsigned NOT NULL,
  `mode` varchar(32) NOT NULL,
  `stage` tinyint(3) unsigned NOT NULL DEFAULT 0,
  `time` decimal(10,3) NOT NULL,
  `teleports` smallint(5) unsigned NOT NULL DEFAULT 0,
  `points` int(11) NOT NULL DEFAULT 0,
  `tickrate` smallint(5) unsigned NOT NULL DEFAULT 128,
  `record_filter_id` int(11) NOT NULL DEFAULT 0,
  `replay_id` int(10) unsigned NOT NULL DEFAULT 0,
  `updated_by` int(11) NOT NULL DEFAULT 0,
  `created_on` datetime NOT NULL,
  `updated_on` datetime NOT NULL,
  `inserted_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`,`created_on`),
  UNIQUE KEY `idx_original_id` (`original_id`,`created_on`),
  KEY `idx_player_map_mode` (`player_id`,`map_id`,`mode`,`stage`,`time`),
  KEY `idx_leaderboard` (`map_id`,`mode`,`stage`,`teleports`,`time`),
  KEY `idx_recent_records` (`created_on` DESC,`mode`,`map_id`),
  KEY `idx_server_records` (`server_id`,`created_on` DESC),
  KEY `idx_mode_stage` (`mode`,`stage`,`teleports`,`time`),
  KEY `idx_player_id` (`player_id`),
  KEY `idx_map_id` (`map_id`),
  KEY `idx_server_id` (`server_id`),
  KEY `idx_steamid64` (`steamid64`)
) ENGINE=InnoDB AUTO_INCREMENT=26756413 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
 PARTITION BY RANGE (to_days(`created_on`))
(PARTITION `p_old` VALUES LESS THAN (737060) ENGINE = InnoDB,
 PARTITION `p2018` VALUES LESS THAN (737425) ENGINE = InnoDB,
 PARTITION `p2019` VALUES LESS THAN (737790) ENGINE = InnoDB,
 PARTITION `p2020` VALUES LESS THAN (738156) ENGINE = InnoDB,
 PARTITION `p2021` VALUES LESS THAN (738521) ENGINE = InnoDB,
 PARTITION `p2022` VALUES LESS THAN (738886) ENGINE = InnoDB,
 PARTITION `p2023` VALUES LESS THAN (739251) ENGINE = InnoDB,
 PARTITION `p2024` VALUES LESS THAN (739617) ENGINE = InnoDB,
 PARTITION `p2025` VALUES LESS THAN (739982) ENGINE = InnoDB,
 PARTITION `p2026` VALUES LESS THAN (740347) ENGINE = InnoDB,
 PARTITION `p2027` VALUES LESS THAN (740712) ENGINE = InnoDB,
 PARTITION `pfuture` VALUES LESS THAN MAXVALUE ENGINE = InnoDB);
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Temporary table structure for view `kz_server_leaderboard`
--

DROP TABLE IF EXISTS `kz_server_leaderboard`;
/*!50001 DROP VIEW IF EXISTS `kz_server_leaderboard`*/;
SET @saved_cs_client     = @@character_set_client;
SET character_set_client = utf8mb4;
/*!50001 CREATE VIEW `kz_server_leaderboard` AS SELECT
 1 AS `id`,
  1 AS `server_id`,
  1 AS `server_name`,
  1 AS `total_records`,
  1 AS `unique_players`,
  1 AS `unique_maps`,
  1 AS `pro_records`,
  1 AS `tp_records`,
  1 AS `first_record_date`,
  1 AS `last_record_date`,
  1 AS `avg_records_per_day`,
  1 AS `world_records_hosted`,
  1 AS `updated_at`,
  1 AS `ip`,
  1 AS `port`,
  1 AS `owner_steamid64`,
  1 AS `approval_status` */;
SET character_set_client = @saved_cs_client;

--
-- Table structure for table `kz_server_statistics`
--

DROP TABLE IF EXISTS `kz_server_statistics`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `kz_server_statistics` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `server_id` int(10) unsigned NOT NULL,
  `server_name` varchar(255) NOT NULL,
  `total_records` int(10) unsigned NOT NULL DEFAULT 0,
  `unique_players` int(10) unsigned NOT NULL DEFAULT 0,
  `unique_maps` int(10) unsigned NOT NULL DEFAULT 0,
  `pro_records` int(10) unsigned NOT NULL DEFAULT 0,
  `tp_records` int(10) unsigned NOT NULL DEFAULT 0,
  `first_record_date` datetime DEFAULT NULL,
  `last_record_date` datetime DEFAULT NULL,
  `avg_records_per_day` decimal(10,2) DEFAULT NULL,
  `world_records_hosted` int(10) unsigned NOT NULL DEFAULT 0,
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_server` (`server_id`),
  KEY `idx_total_records` (`total_records` DESC),
  KEY `idx_unique_players` (`unique_players` DESC),
  KEY `idx_unique_maps` (`unique_maps` DESC),
  KEY `idx_world_records` (`world_records_hosted` DESC),
  KEY `idx_updated` (`updated_at`),
  CONSTRAINT `kz_server_statistics_ibfk_1` FOREIGN KEY (`server_id`) REFERENCES `kz_servers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Pre-calculated statistics for servers to improve query performance';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `kz_servers`
--

DROP TABLE IF EXISTS `kz_servers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `kz_servers` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `server_id` int(11) NOT NULL,
  `api_key` varchar(50) DEFAULT NULL,
  `port` int(11) DEFAULT NULL,
  `ip` varchar(45) DEFAULT NULL,
  `server_name` varchar(255) NOT NULL,
  `owner_steamid64` varchar(20) DEFAULT NULL,
  `created_on` datetime DEFAULT NULL,
  `updated_on` datetime DEFAULT NULL,
  `approval_status` int(11) DEFAULT NULL,
  `approved_by_steamid64` varchar(20) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `server_id` (`server_id`),
  KEY `idx_server_name` (`server_name`(50)),
  KEY `idx_ip_port` (`ip`,`port`),
  KEY `idx_owner` (`owner_steamid64`),
  KEY `idx_servers_id` (`id`),
  KEY `idx_approval_owner` (`approval_status`,`owner_steamid64`)
) ENGINE=InnoDB AUTO_INCREMENT=314332 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `kz_worldrecords_cache`
--

DROP TABLE IF EXISTS `kz_worldrecords_cache`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `kz_worldrecords_cache` (
  `map_id` int(10) unsigned NOT NULL,
  `mode` varchar(32) NOT NULL,
  `stage` int(11) NOT NULL,
  `teleports` int(11) NOT NULL,
  `player_id` int(10) unsigned NOT NULL,
  `steamid64` varchar(20) NOT NULL,
  `time` decimal(10,3) NOT NULL,
  `points` int(11) NOT NULL DEFAULT 0,
  `server_id` int(10) unsigned NOT NULL,
  `created_on` datetime NOT NULL,
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`map_id`,`mode`,`stage`,`teleports`),
  KEY `idx_player_records` (`player_id`,`created_on` DESC),
  KEY `fk_wr_server` (`server_id`),
  CONSTRAINT `fk_wr_map` FOREIGN KEY (`map_id`) REFERENCES `kz_maps` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_wr_player` FOREIGN KEY (`player_id`) REFERENCES `kz_players` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_wr_server` FOREIGN KEY (`server_id`) REFERENCES `kz_servers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `kz_worldrecords_cache_backup`
--

DROP TABLE IF EXISTS `kz_worldrecords_cache_backup`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `kz_worldrecords_cache_backup` (
  `map_id` int(11) NOT NULL,
  `mode` varchar(32) NOT NULL,
  `stage` int(11) NOT NULL,
  `teleports` int(11) NOT NULL,
  `player_id` bigint(20) DEFAULT NULL,
  `time` float DEFAULT NULL,
  `points` int(11) DEFAULT NULL,
  `server_id` int(11) DEFAULT NULL,
  `created_on` datetime DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `partition_maintenance_log`
--

DROP TABLE IF EXISTS `partition_maintenance_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `partition_maintenance_log` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `executed_at` datetime NOT NULL,
  `status` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_executed` (`executed_at` DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Final view structure for view `kz_map_leaderboard`
--

/*!50001 DROP VIEW IF EXISTS `kz_map_leaderboard`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb3 */;
/*!50001 SET character_set_results     = utf8mb3 */;
/*!50001 SET collation_connection      = utf8mb3_uca1400_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`root`@`%` SQL SECURITY DEFINER */
/*!50001 VIEW `kz_map_leaderboard` AS select `ms`.`id` AS `id`,`ms`.`map_id` AS `map_id`,`ms`.`mode` AS `mode`,`ms`.`stage` AS `stage`,`ms`.`total_records` AS `total_records`,`ms`.`unique_players` AS `unique_players`,`ms`.`world_record_time` AS `world_record_time`,`ms`.`world_record_player_id` AS `world_record_player_id`,`ms`.`avg_time` AS `avg_time`,`ms`.`median_time` AS `median_time`,`ms`.`updated_at` AS `updated_at`,`m`.`difficulty` AS `difficulty`,`m`.`validated` AS `validated`,`m`.`workshop_url` AS `workshop_url` from (`kz_map_statistics` `ms` join `kz_maps` `m` on(`ms`.`map_id` = `m`.`id`)) order by `ms`.`total_records` desc */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `kz_records_by_year`
--

/*!50001 DROP VIEW IF EXISTS `kz_records_by_year`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb3 */;
/*!50001 SET character_set_results     = utf8mb3 */;
/*!50001 SET collation_connection      = utf8mb3_uca1400_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`root`@`%` SQL SECURITY DEFINER */
/*!50001 VIEW `kz_records_by_year` AS select year(`kz_records_partitioned`.`created_on`) AS `year`,count(0) AS `record_count`,count(distinct `kz_records_partitioned`.`player_id`) AS `unique_players`,count(distinct `kz_records_partitioned`.`map_id`) AS `unique_maps`,min(`kz_records_partitioned`.`created_on`) AS `first_record`,max(`kz_records_partitioned`.`created_on`) AS `last_record` from `kz_records_partitioned` group by year(`kz_records_partitioned`.`created_on`) order by year(`kz_records_partitioned`.`created_on`) desc */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

--
-- Final view structure for view `kz_server_leaderboard`
--

/*!50001 DROP VIEW IF EXISTS `kz_server_leaderboard`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb3 */;
/*!50001 SET character_set_results     = utf8mb3 */;
/*!50001 SET collation_connection      = utf8mb3_uca1400_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`root`@`%` SQL SECURITY DEFINER */
/*!50001 VIEW `kz_server_leaderboard` AS select `ss`.`id` AS `id`,`ss`.`server_id` AS `server_id`,`ss`.`server_name` AS `server_name`,`ss`.`total_records` AS `total_records`,`ss`.`unique_players` AS `unique_players`,`ss`.`unique_maps` AS `unique_maps`,`ss`.`pro_records` AS `pro_records`,`ss`.`tp_records` AS `tp_records`,`ss`.`first_record_date` AS `first_record_date`,`ss`.`last_record_date` AS `last_record_date`,`ss`.`avg_records_per_day` AS `avg_records_per_day`,`ss`.`world_records_hosted` AS `world_records_hosted`,`ss`.`updated_at` AS `updated_at`,`s`.`ip` AS `ip`,`s`.`port` AS `port`,`s`.`owner_steamid64` AS `owner_steamid64`,`s`.`approval_status` AS `approval_status` from (`kz_server_statistics` `ss` join `kz_servers` `s` on(`ss`.`server_id` = `s`.`id`)) order by `ss`.`total_records` desc */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2025-12-09  1:33:19
