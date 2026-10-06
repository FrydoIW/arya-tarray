-- Reviewed current physical schema snapshot (MySQL 8.0.42 baseline plus Accounting Phase 1).
-- Schema only: no rows, credentials, CREATE DATABASE, USE, DROP, or _prisma_migrations.
-- Schema reference for DEV preflight; normal integration startup NEVER imports this file.
-- Initial import into a NEW EMPTY arya_tarray_dev requires explicit operational approval.
-- Not an application/production bootstrap and not a substitute for manual patch governance.

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `arya_accounting_account` (
  `accounting_account_id` CHAR(36) NOT NULL,
  `account_code` VARCHAR(10) NOT NULL,
  `account_name` VARCHAR(150) NOT NULL,
  `account_type` VARCHAR(20) NOT NULL,
  `normal_balance` VARCHAR(10) NOT NULL,
  `posting_flag` BOOLEAN NOT NULL DEFAULT TRUE,
  `active_flag` BOOLEAN NOT NULL DEFAULT TRUE,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`accounting_account_id`),
  UNIQUE KEY `uk_accounting_account_code` (`account_code`),
  CONSTRAINT `ck_accounting_account_type` CHECK (`account_type` IN ('ASSET', 'REVENUE')),
  CONSTRAINT `ck_accounting_normal_balance` CHECK (`normal_balance` IN ('DEBIT', 'CREDIT'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `arya_accounting_journal` (
  `accounting_journal_id` CHAR(36) NOT NULL,
  `journal_number` VARCHAR(60) NOT NULL,
  `journal_type` VARCHAR(20) NOT NULL,
  `source_event_key` VARCHAR(150) NOT NULL,
  `accounting_date` DATE NOT NULL,
  `posted_at` DATETIME(3) NOT NULL,
  `description_snapshot` TEXT NULL,
  `bank_transaction_id` CHAR(36) NOT NULL,
  `correction_item_id` CHAR(36) NULL,
  `related_journal_id` CHAR(36) NULL,
  `posted_by` CHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`accounting_journal_id`),
  UNIQUE KEY `uk_accounting_journal_number` (`journal_number`),
  UNIQUE KEY `uk_accounting_source_event` (`source_event_key`),
  UNIQUE KEY `uk_accounting_correction_item` (`correction_item_id`),
  KEY `idx_accounting_journal_date` (`accounting_date`, `accounting_journal_id`),
  KEY `idx_accounting_journal_source` (`bank_transaction_id`, `posted_at`),
  KEY `idx_accounting_journal_related` (`related_journal_id`),
  CONSTRAINT `ck_accounting_journal_type` CHECK (`journal_type` IN ('RECOGNITION', 'RECLASSIFICATION')),
  CONSTRAINT `fk_accounting_journal_transaction` FOREIGN KEY (`bank_transaction_id`) REFERENCES `arya_bank_transaction` (`bank_transaction_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_accounting_journal_correction` FOREIGN KEY (`correction_item_id`) REFERENCES `arya_reconciliation_correction_item` (`correction_item_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_accounting_journal_related` FOREIGN KEY (`related_journal_id`) REFERENCES `arya_accounting_journal` (`accounting_journal_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_accounting_journal_actor` FOREIGN KEY (`posted_by`) REFERENCES `arya_user` (`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `arya_accounting_journal_line` (
  `accounting_journal_line_id` CHAR(36) NOT NULL,
  `accounting_journal_id` CHAR(36) NOT NULL,
  `line_no` INT UNSIGNED NOT NULL,
  `accounting_account_id` CHAR(36) NOT NULL,
  `account_code_snapshot` VARCHAR(10) NOT NULL,
  `account_name_snapshot` VARCHAR(150) NOT NULL,
  `debit` DECIMAL(20,2) NOT NULL,
  `credit` DECIMAL(20,2) NOT NULL,
  `bank_account_id` CHAR(36) NOT NULL,
  `bank_name_snapshot` VARCHAR(100) NOT NULL,
  `bank_account_no_snapshot` VARCHAR(100) NOT NULL,
  `bank_account_name_snapshot` VARCHAR(200) NOT NULL,
  `event_code_id` CHAR(36) NULL,
  `event_code_snapshot` CHAR(3) NULL,
  `event_name_snapshot` VARCHAR(200) NULL,
  `event_type_snapshot` VARCHAR(20) NULL,
  `event_campaign_id` CHAR(36) NULL,
  `campaign_name_snapshot` VARCHAR(200) NULL,
  `member_identity_id` CHAR(36) NULL,
  `donor_name_snapshot` VARCHAR(255) NULL,
  `member_id` CHAR(36) NULL,
  `member_code_snapshot` VARCHAR(30) NULL,
  `member_name_snapshot` VARCHAR(150) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`accounting_journal_line_id`),
  UNIQUE KEY `uk_accounting_line_number` (`accounting_journal_id`, `line_no`),
  KEY `idx_accounting_line_account` (`accounting_account_id`, `accounting_journal_id`),
  KEY `idx_accounting_line_bank` (`bank_account_id`),
  KEY `idx_accounting_line_event` (`event_code_id`),
  KEY `idx_accounting_line_campaign` (`event_campaign_id`),
  KEY `idx_accounting_line_member` (`member_id`),
  CONSTRAINT `ck_accounting_line_sides` CHECK ((`debit` > 0 AND `credit` = 0) OR (`credit` > 0 AND `debit` = 0)),
  CONSTRAINT `ck_accounting_line_number` CHECK (`line_no` > 0),
  CONSTRAINT `fk_accounting_line_journal` FOREIGN KEY (`accounting_journal_id`) REFERENCES `arya_accounting_journal` (`accounting_journal_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_accounting_line_account` FOREIGN KEY (`accounting_account_id`) REFERENCES `arya_accounting_account` (`accounting_account_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_accounting_line_bank` FOREIGN KEY (`bank_account_id`) REFERENCES `arya_bank_account` (`bank_account_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_accounting_line_event` FOREIGN KEY (`event_code_id`) REFERENCES `arya_event_code` (`event_code_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_accounting_line_campaign` FOREIGN KEY (`event_campaign_id`) REFERENCES `arya_event_campaign` (`event_campaign_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_accounting_line_identity` FOREIGN KEY (`member_identity_id`) REFERENCES `arya_member_identity` (`member_identity_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_accounting_line_member` FOREIGN KEY (`member_id`) REFERENCES `arya_member` (`member_id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `arya_approval_config` (
  `approval_config_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `menu_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `active_flag` tinyint(1) NOT NULL DEFAULT '1',
  `created_by` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_by` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`approval_config_id`),
  UNIQUE KEY `uq_approval_config_menu` (`menu_id`),
  KEY `fk_approval_config_created_by` (`created_by`),
  KEY `fk_approval_config_updated_by` (`updated_by`),
  CONSTRAINT `fk_approval_config_created_by` FOREIGN KEY (`created_by`) REFERENCES `arya_user` (`user_id`),
  CONSTRAINT `fk_approval_config_menu` FOREIGN KEY (`menu_id`) REFERENCES `arya_menu` (`menu_id`),
  CONSTRAINT `fk_approval_config_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `arya_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `arya_approval_config_approver` (
  `approval_config_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `approver_user_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_by` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`approval_config_id`,`approver_user_id`),
  KEY `fk_approval_config_approver_user` (`approver_user_id`),
  KEY `fk_approval_config_approver_created_by` (`created_by`),
  CONSTRAINT `fk_approval_config_approver_config` FOREIGN KEY (`approval_config_id`) REFERENCES `arya_approval_config` (`approval_config_id`),
  CONSTRAINT `fk_approval_config_approver_created_by` FOREIGN KEY (`created_by`) REFERENCES `arya_user` (`user_id`),
  CONSTRAINT `fk_approval_config_approver_user` FOREIGN KEY (`approver_user_id`) REFERENCES `arya_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `arya_bank_account` (
  `bank_account_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `bank_code` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `bank_name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `account_no` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `account_name` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `currency_code` char(3) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'IDR',
  `active_flag` tinyint(1) NOT NULL DEFAULT '1',
  `created_by` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_by` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `opening_balance` decimal(19,2) DEFAULT NULL,
  `opening_balance_date` date DEFAULT NULL,
  `opening_balance_locked_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`bank_account_id`),
  UNIQUE KEY `uk_bank_account_bank_account_no` (`bank_code`,`account_no`),
  KEY `fk_bank_account_created_by` (`created_by`),
  KEY `fk_bank_account_updated_by` (`updated_by`),
  CONSTRAINT `fk_bank_account_created_by` FOREIGN KEY (`created_by`) REFERENCES `arya_user` (`user_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_bank_account_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `arya_user` (`user_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `chk_arya_bank_account_opening_balance_pair` CHECK ((((`opening_balance` is null) and (`opening_balance_date` is null)) or ((`opening_balance` is not null) and (`opening_balance_date` is not null))))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `arya_bank_statement_upload` (
  `statement_upload_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `bank_account_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `file_name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `period_from` date DEFAULT NULL,
  `period_to` date DEFAULT NULL,
  `total_transaction` int NOT NULL DEFAULT '0',
  `total_credit` decimal(20,2) NOT NULL DEFAULT '0.00',
  `total_debit` decimal(20,2) NOT NULL DEFAULT '0.00',
  `status` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'RAW',
  `uploaded_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `uploaded_by` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `executed_at` datetime DEFAULT NULL,
  `executed_by` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `finalized_at` datetime DEFAULT NULL,
  `finalized_by` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `remark` varchar(1000) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `withdrawn_at` datetime(3) DEFAULT NULL,
  `withdrawn_by` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `withdrawal_reason` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`statement_upload_id`),
  KEY `bank_account_id` (`bank_account_id`),
  KEY `uploaded_by` (`uploaded_by`),
  KEY `executed_by` (`executed_by`),
  KEY `finalized_by` (`finalized_by`),
  KEY `idx_bank_statement_account_status` (`bank_account_id`,`status`),
  KEY `idx_bank_statement_withdrawn_by` (`withdrawn_by`),
  CONSTRAINT `arya_bank_statement_upload_ibfk_1` FOREIGN KEY (`bank_account_id`) REFERENCES `arya_bank_account` (`bank_account_id`),
  CONSTRAINT `arya_bank_statement_upload_ibfk_2` FOREIGN KEY (`uploaded_by`) REFERENCES `arya_user` (`user_id`),
  CONSTRAINT `arya_bank_statement_upload_ibfk_3` FOREIGN KEY (`executed_by`) REFERENCES `arya_user` (`user_id`),
  CONSTRAINT `arya_bank_statement_upload_ibfk_4` FOREIGN KEY (`finalized_by`) REFERENCES `arya_user` (`user_id`),
  CONSTRAINT `fk_bank_statement_withdrawn_by` FOREIGN KEY (`withdrawn_by`) REFERENCES `arya_user` (`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `arya_bank_statement_upload_attempt` (
  `upload_attempt_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `bank_account_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `file_name` varchar(255) NOT NULL,
  `source_total_transaction` int NOT NULL,
  `source_total_credit` decimal(20,2) NOT NULL,
  `source_total_debit` decimal(20,2) NOT NULL,
  `imported_transaction_count` int NOT NULL,
  `duplicate_transaction_count` int NOT NULL,
  `uploaded_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `uploaded_by` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `statement_upload_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`upload_attempt_id`),
  UNIQUE KEY `uk_bank_statement_attempt_statement` (`statement_upload_id`),
  KEY `idx_bank_statement_attempt_account_uploaded` (`bank_account_id`,`uploaded_at`),
  KEY `idx_bank_statement_attempt_uploaded_by` (`uploaded_by`),
  CONSTRAINT `fk_bank_statement_attempt_bank_account` FOREIGN KEY (`bank_account_id`) REFERENCES `arya_bank_account` (`bank_account_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_bank_statement_attempt_statement` FOREIGN KEY (`statement_upload_id`) REFERENCES `arya_bank_statement_upload` (`statement_upload_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_bank_statement_attempt_uploaded_by` FOREIGN KEY (`uploaded_by`) REFERENCES `arya_user` (`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `arya_bank_statement_upload_duplicate` (
  `duplicate_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `upload_attempt_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `matched_statement_upload_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `matched_bank_transaction_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `source_transaction_no` int NOT NULL,
  `source_worksheet_row` int DEFAULT NULL,
  `source_sheet_name` varchar(150) DEFAULT NULL,
  `transaction_date` date DEFAULT NULL,
  `transaction_type` varchar(20) DEFAULT NULL,
  `reference_no` varchar(150) DEFAULT NULL,
  `sender_name` varchar(255) DEFAULT NULL,
  `source_description` text,
  `original_amount` decimal(20,2) NOT NULL,
  `signature_hash` char(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`duplicate_id`),
  KEY `idx_bank_statement_duplicate_attempt` (`upload_attempt_id`),
  KEY `idx_bank_statement_duplicate_matched_statement` (`matched_statement_upload_id`),
  KEY `idx_bank_statement_duplicate_matched_transaction` (`matched_bank_transaction_id`),
  KEY `idx_bank_statement_duplicate_signature` (`signature_hash`),
  CONSTRAINT `fk_bank_statement_duplicate_attempt` FOREIGN KEY (`upload_attempt_id`) REFERENCES `arya_bank_statement_upload_attempt` (`upload_attempt_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_bank_statement_duplicate_matched_statement` FOREIGN KEY (`matched_statement_upload_id`) REFERENCES `arya_bank_statement_upload` (`statement_upload_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_bank_statement_duplicate_matched_transaction` FOREIGN KEY (`matched_bank_transaction_id`) REFERENCES `arya_bank_transaction` (`bank_transaction_id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `arya_bank_transaction` (
  `bank_transaction_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `statement_upload_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `row_no` int DEFAULT NULL,
  `transaction_date` date DEFAULT NULL,
  `transaction_type` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `reference_no` varchar(150) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sender_name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `original_amount` decimal(20,2) NOT NULL,
  `suffix_code` char(3) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `suggested_event_code_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `event_code_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `event_campaign_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `member_identity_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `base_amount` decimal(20,2) DEFAULT NULL,
  `status` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'RAW',
  `remark` varchar(1000) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `source_type` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'BANK',
  `correction_reason` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `manual_added_at` datetime DEFAULT NULL,
  `manual_added_by` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `reconciliation_excluded_at` datetime DEFAULT NULL,
  `reconciliation_excluded_by` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `reconciliation_exclusion_reason` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`bank_transaction_id`),
  KEY `statement_upload_id` (`statement_upload_id`),
  KEY `suggested_event_code_id` (`suggested_event_code_id`),
  KEY `event_code_id` (`event_code_id`),
  KEY `idx_bank_transaction_member_identity` (`member_identity_id`),
  KEY `idx_bank_transaction_manual_added_by` (`manual_added_by`),
  KEY `idx_bank_transaction_reconciliation_excluded` (`reconciliation_excluded_at`),
  KEY `idx_bank_transaction_excluded_by` (`reconciliation_excluded_by`),
  KEY `idx_bank_transaction_event_campaign` (`event_campaign_id`),
  CONSTRAINT `arya_bank_transaction_ibfk_1` FOREIGN KEY (`statement_upload_id`) REFERENCES `arya_bank_statement_upload` (`statement_upload_id`),
  CONSTRAINT `arya_bank_transaction_ibfk_2` FOREIGN KEY (`suggested_event_code_id`) REFERENCES `arya_event_code` (`event_code_id`),
  CONSTRAINT `arya_bank_transaction_ibfk_3` FOREIGN KEY (`event_code_id`) REFERENCES `arya_event_code` (`event_code_id`),
  CONSTRAINT `fk_bank_transaction_event_campaign` FOREIGN KEY (`event_campaign_id`) REFERENCES `arya_event_campaign` (`event_campaign_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_bank_transaction_excluded_by` FOREIGN KEY (`reconciliation_excluded_by`) REFERENCES `arya_user` (`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_bank_transaction_manual_added_by` FOREIGN KEY (`manual_added_by`) REFERENCES `arya_user` (`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_bank_transaction_member_identity` FOREIGN KEY (`member_identity_id`) REFERENCES `arya_member_identity` (`member_identity_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `arya_bank_transaction_history` (
  `transaction_history_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `bank_transaction_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `field_name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `old_value` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `new_value` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `remark` varchar(1000) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `changed_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `changed_by` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`transaction_history_id`),
  KEY `bank_transaction_id` (`bank_transaction_id`),
  KEY `changed_by` (`changed_by`),
  CONSTRAINT `arya_bank_transaction_history_ibfk_1` FOREIGN KEY (`bank_transaction_id`) REFERENCES `arya_bank_transaction` (`bank_transaction_id`),
  CONSTRAINT `arya_bank_transaction_history_ibfk_2` FOREIGN KEY (`changed_by`) REFERENCES `arya_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `arya_event_campaign` (
  `event_campaign_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `event_code_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `campaign_name` varchar(200) NOT NULL,
  `start_date` date DEFAULT NULL,
  `end_date` date DEFAULT NULL,
  `target_amount` decimal(20,2) DEFAULT NULL,
  `active_flag` tinyint(1) NOT NULL DEFAULT '1',
  `remark` varchar(1000) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_by` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `updated_by` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`event_campaign_id`),
  KEY `idx_event_campaign_event_active` (`event_code_id`,`active_flag`),
  KEY `idx_event_campaign_period` (`start_date`,`end_date`),
  KEY `idx_event_campaign_created_by` (`created_by`),
  KEY `idx_event_campaign_updated_by` (`updated_by`),
  CONSTRAINT `fk_event_campaign_created_by` FOREIGN KEY (`created_by`) REFERENCES `arya_user` (`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_event_campaign_event_code` FOREIGN KEY (`event_code_id`) REFERENCES `arya_event_code` (`event_code_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_event_campaign_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `arya_user` (`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `arya_event_code` (
  `event_code_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `code` char(3) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `event_name` varchar(150) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `category` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `event_type` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'STANDARD',
  `description` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `active_flag` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_by` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `updated_by` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`event_code_id`),
  KEY `created_by` (`created_by`),
  KEY `updated_by` (`updated_by`),
  KEY `idx_event_code_type` (`event_type`),
  CONSTRAINT `arya_event_code_ibfk_1` FOREIGN KEY (`created_by`) REFERENCES `arya_user` (`user_id`),
  CONSTRAINT `arya_event_code_ibfk_2` FOREIGN KEY (`updated_by`) REFERENCES `arya_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `arya_event_time_rule` (
  `event_code_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `unit_amount` decimal(20,2) NOT NULL,
  `duration_months` int unsigned NOT NULL DEFAULT '1',
  `active_flag` tinyint(1) NOT NULL DEFAULT '1',
  `remark` varchar(1000) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_by` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `updated_by` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`event_code_id`),
  KEY `idx_event_time_rule_created_by` (`created_by`),
  KEY `idx_event_time_rule_updated_by` (`updated_by`),
  CONSTRAINT `fk_event_time_rule_created_by` FOREIGN KEY (`created_by`) REFERENCES `arya_user` (`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_event_time_rule_event_code` FOREIGN KEY (`event_code_id`) REFERENCES `arya_event_code` (`event_code_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_event_time_rule_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `arya_user` (`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `arya_member` (
  `member_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `member_code` varchar(30) NOT NULL,
  `member_name` varchar(150) NOT NULL,
  `initial_name` varchar(100) DEFAULT NULL,
  `birth_date` date DEFAULT NULL,
  `phone` varchar(50) DEFAULT NULL,
  `email` varchar(150) DEFAULT NULL,
  `address` varchar(500) DEFAULT NULL,
  `city` varchar(100) DEFAULT NULL,
  `registration_source` varchar(20) NOT NULL DEFAULT 'MANUAL',
  `active_flag` tinyint(1) NOT NULL DEFAULT '1',
  `remark` varchar(500) DEFAULT NULL,
  `registered_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `registered_by` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_by` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `updated_by` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`member_id`),
  UNIQUE KEY `uk_member_code` (`member_code`),
  KEY `idx_member_name` (`member_name`),
  KEY `idx_member_initial_name` (`initial_name`),
  KEY `idx_member_city` (`city`),
  KEY `idx_member_active` (`active_flag`),
  KEY `fk_member_registered_by` (`registered_by`),
  KEY `fk_member_created_by` (`created_by`),
  KEY `fk_member_updated_by` (`updated_by`),
  CONSTRAINT `fk_member_created_by` FOREIGN KEY (`created_by`) REFERENCES `arya_user` (`user_id`),
  CONSTRAINT `fk_member_registered_by` FOREIGN KEY (`registered_by`) REFERENCES `arya_user` (`user_id`),
  CONSTRAINT `fk_member_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `arya_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `arya_member_event_balance_ledger` (
  `member_event_balance_ledger_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `member_event_subscription_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `bank_transaction_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `member_event_coverage_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `member_event_carry_transfer_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `entry_type` varchar(20) NOT NULL,
  `entry_status` varchar(20) NOT NULL DEFAULT 'ACTIVE',
  `amount_delta` decimal(20,2) NOT NULL,
  `effective_date` date NOT NULL,
  `posting_sequence` bigint unsigned NOT NULL,
  `unit_amount_snapshot` decimal(20,2) DEFAULT NULL,
  `duration_months_snapshot` int unsigned DEFAULT NULL,
  `remark` varchar(1000) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_by` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `voided_at` datetime(3) DEFAULT NULL,
  `voided_by` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `void_reason` varchar(1000) DEFAULT NULL,
  PRIMARY KEY (`member_event_balance_ledger_id`),
  UNIQUE KEY `uq_member_event_balance_subscription_sequence` (`member_event_subscription_id`,`posting_sequence`),
  KEY `idx_member_event_balance_subscription` (`member_event_subscription_id`,`entry_status`,`effective_date`),
  KEY `idx_member_event_balance_transaction` (`bank_transaction_id`),
  KEY `idx_member_event_balance_coverage` (`member_event_coverage_id`),
  KEY `idx_member_event_balance_type` (`entry_type`,`entry_status`),
  KEY `idx_member_event_balance_created_by` (`created_by`),
  KEY `idx_member_event_balance_voided_by` (`voided_by`),
  KEY `idx_member_event_balance_subscription_sequence` (`member_event_subscription_id`,`entry_status`,`posting_sequence`),
  KEY `idx_member_event_balance_carry_transfer` (`member_event_carry_transfer_id`),
  CONSTRAINT `fk_member_event_balance_carry_transfer` FOREIGN KEY (`member_event_carry_transfer_id`) REFERENCES `arya_member_event_carry_transfer` (`member_event_carry_transfer_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_member_event_balance_coverage` FOREIGN KEY (`member_event_coverage_id`) REFERENCES `arya_member_event_coverage` (`member_event_coverage_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_member_event_balance_created_by` FOREIGN KEY (`created_by`) REFERENCES `arya_user` (`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_member_event_balance_subscription` FOREIGN KEY (`member_event_subscription_id`) REFERENCES `arya_member_event_subscription` (`member_event_subscription_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_member_event_balance_transaction` FOREIGN KEY (`bank_transaction_id`) REFERENCES `arya_bank_transaction` (`bank_transaction_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_member_event_balance_voided_by` FOREIGN KEY (`voided_by`) REFERENCES `arya_user` (`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `arya_member_event_campaign_allocation` (
  `member_event_campaign_allocation_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `member_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `event_campaign_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `member_event_carry_transfer_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `bank_transaction_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `amount_delta` decimal(20,2) NOT NULL,
  `allocation_type` varchar(30) NOT NULL,
  `allocation_status` varchar(20) NOT NULL DEFAULT 'ACTIVE',
  `effective_date` date NOT NULL,
  `reason` varchar(1000) NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_by` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `reversal_of_allocation_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `voided_at` datetime(3) DEFAULT NULL,
  `voided_by` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `void_reason` varchar(1000) DEFAULT NULL,
  PRIMARY KEY (`member_event_campaign_allocation_id`),
  UNIQUE KEY `uq_member_event_campaign_allocation_transfer` (`member_event_carry_transfer_id`),
  UNIQUE KEY `uq_member_event_campaign_allocation_reversal` (`reversal_of_allocation_id`),
  KEY `idx_member_event_campaign_allocation_member_campaign` (`member_id`,`event_campaign_id`,`allocation_status`,`effective_date`),
  KEY `idx_member_event_campaign_allocation_campaign` (`event_campaign_id`,`allocation_status`,`effective_date`),
  KEY `idx_member_event_campaign_allocation_created_by` (`created_by`),
  KEY `idx_member_event_campaign_allocation_transaction` (`bank_transaction_id`),
  KEY `idx_member_event_campaign_allocation_voided_by` (`voided_by`),
  CONSTRAINT `fk_member_event_campaign_allocation_campaign` FOREIGN KEY (`event_campaign_id`) REFERENCES `arya_event_campaign` (`event_campaign_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_member_event_campaign_allocation_created_by` FOREIGN KEY (`created_by`) REFERENCES `arya_user` (`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_member_event_campaign_allocation_member` FOREIGN KEY (`member_id`) REFERENCES `arya_member` (`member_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_member_event_campaign_allocation_reversal_of` FOREIGN KEY (`reversal_of_allocation_id`) REFERENCES `arya_member_event_campaign_allocation` (`member_event_campaign_allocation_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_member_event_campaign_allocation_transaction` FOREIGN KEY (`bank_transaction_id`) REFERENCES `arya_bank_transaction` (`bank_transaction_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_member_event_campaign_allocation_transfer` FOREIGN KEY (`member_event_carry_transfer_id`) REFERENCES `arya_member_event_carry_transfer` (`member_event_carry_transfer_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_member_event_campaign_allocation_voided_by` FOREIGN KEY (`voided_by`) REFERENCES `arya_user` (`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `chk_member_event_campaign_allocation_amount` CHECK (((`amount_delta` <> 0) or (`allocation_type` = _utf8mb4'DIRECT_CONTRIBUTION'))),
  CONSTRAINT `chk_member_event_campaign_allocation_evidence` CHECK (((`member_event_carry_transfer_id` is not null) <> (`bank_transaction_id` is not null))),
  CONSTRAINT `chk_member_event_campaign_allocation_status` CHECK ((`allocation_status` in (_utf8mb4'ACTIVE',_utf8mb4'VOIDED'))),
  CONSTRAINT `chk_member_event_campaign_allocation_type` CHECK ((`allocation_type` in (_utf8mb4'CARRY_TRANSFER',_utf8mb4'CARRY_REVERSAL',_utf8mb4'DIRECT_CONTRIBUTION')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `arya_member_event_campaign_participation` (
  `member_event_campaign_participation_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `member_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `event_campaign_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `active_flag` tinyint(1) NOT NULL DEFAULT '1',
  `remark` varchar(1000) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_by` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`member_event_campaign_participation_id`),
  UNIQUE KEY `uq_member_event_campaign_participation_member_campaign` (`member_id`,`event_campaign_id`),
  KEY `idx_member_event_campaign_participation_member_active` (`member_id`,`active_flag`),
  KEY `idx_member_event_campaign_participation_campaign_active` (`event_campaign_id`,`active_flag`),
  KEY `idx_member_event_campaign_participation_created_by` (`created_by`),
  CONSTRAINT `fk_member_event_campaign_participation_campaign` FOREIGN KEY (`event_campaign_id`) REFERENCES `arya_event_campaign` (`event_campaign_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_member_event_campaign_participation_created_by` FOREIGN KEY (`created_by`) REFERENCES `arya_user` (`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_member_event_campaign_participation_member` FOREIGN KEY (`member_id`) REFERENCES `arya_member` (`member_id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `arya_member_event_campaign_wallet_ledger` (
  `member_event_campaign_wallet_ledger_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `member_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `event_campaign_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `bank_transaction_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `member_event_carry_transfer_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `entry_type` varchar(30) NOT NULL,
  `entry_status` varchar(20) NOT NULL DEFAULT 'ACTIVE',
  `amount_delta` decimal(20,2) NOT NULL,
  `effective_date` date NOT NULL,
  `posting_sequence` bigint unsigned NOT NULL,
  `remark` varchar(1000) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_by` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `voided_at` datetime(3) DEFAULT NULL,
  `voided_by` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `void_reason` varchar(1000) DEFAULT NULL,
  PRIMARY KEY (`member_event_campaign_wallet_ledger_id`),
  UNIQUE KEY `uq_member_event_campaign_wallet_sequence` (`member_id`,`event_campaign_id`,`posting_sequence`),
  KEY `idx_member_event_campaign_wallet_member_campaign` (`member_id`,`event_campaign_id`,`entry_status`,`effective_date`),
  KEY `idx_member_event_campaign_wallet_campaign` (`event_campaign_id`,`entry_status`,`effective_date`),
  KEY `idx_member_event_campaign_wallet_transfer` (`member_event_carry_transfer_id`),
  KEY `idx_member_event_campaign_wallet_created_by` (`created_by`),
  KEY `idx_member_event_campaign_wallet_voided_by` (`voided_by`),
  KEY `idx_member_event_campaign_wallet_sequence` (`member_id`,`event_campaign_id`,`entry_status`,`posting_sequence`),
  KEY `idx_member_event_campaign_wallet_transaction` (`bank_transaction_id`),
  CONSTRAINT `fk_member_event_campaign_wallet_campaign` FOREIGN KEY (`event_campaign_id`) REFERENCES `arya_event_campaign` (`event_campaign_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_member_event_campaign_wallet_created_by` FOREIGN KEY (`created_by`) REFERENCES `arya_user` (`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_member_event_campaign_wallet_member` FOREIGN KEY (`member_id`) REFERENCES `arya_member` (`member_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_member_event_campaign_wallet_transaction` FOREIGN KEY (`bank_transaction_id`) REFERENCES `arya_bank_transaction` (`bank_transaction_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_member_event_campaign_wallet_transfer` FOREIGN KEY (`member_event_carry_transfer_id`) REFERENCES `arya_member_event_carry_transfer` (`member_event_carry_transfer_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_member_event_campaign_wallet_voided_by` FOREIGN KEY (`voided_by`) REFERENCES `arya_user` (`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `chk_member_event_campaign_wallet_amount` CHECK ((`amount_delta` <> 0)),
  CONSTRAINT `chk_member_event_campaign_wallet_evidence` CHECK (((`bank_transaction_id` is not null) <> (`member_event_carry_transfer_id` is not null)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `arya_member_event_carry_transfer` (
  `member_event_carry_transfer_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `member_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `source_subscription_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `source_campaign_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `destination_subscription_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `destination_campaign_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `amount` decimal(20,2) NOT NULL,
  `effective_date` date NOT NULL,
  `reason` varchar(1000) NOT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'ACTIVE',
  `idempotency_key` varchar(100) NOT NULL,
  `request_hash` char(64) NOT NULL,
  `reversal_of_transfer_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `destination_unit_amount_snapshot` decimal(20,2) NOT NULL,
  `destination_duration_months_snapshot` int unsigned NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_by` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `reversed_at` datetime(3) DEFAULT NULL,
  `reversed_by` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`member_event_carry_transfer_id`),
  UNIQUE KEY `uq_member_event_carry_transfer_idempotency` (`idempotency_key`),
  UNIQUE KEY `uq_member_event_carry_transfer_reversal` (`reversal_of_transfer_id`),
  KEY `idx_member_event_carry_transfer_member_date` (`member_id`,`effective_date`),
  KEY `idx_member_event_carry_transfer_source` (`source_subscription_id`,`status`,`effective_date`),
  KEY `idx_member_event_carry_transfer_destination` (`destination_subscription_id`,`status`,`effective_date`),
  KEY `idx_member_event_carry_transfer_created_by` (`created_by`),
  KEY `idx_member_event_carry_transfer_reversed_by` (`reversed_by`),
  KEY `idx_member_event_carry_transfer_campaign_destination` (`destination_campaign_id`,`status`,`effective_date`),
  KEY `idx_member_event_carry_transfer_source_campaign` (`source_campaign_id`,`status`,`effective_date`),
  CONSTRAINT `fk_member_event_carry_transfer_created_by` FOREIGN KEY (`created_by`) REFERENCES `arya_user` (`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_member_event_carry_transfer_destination_campaign` FOREIGN KEY (`destination_campaign_id`) REFERENCES `arya_event_campaign` (`event_campaign_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_member_event_carry_transfer_destination_subscription` FOREIGN KEY (`destination_subscription_id`) REFERENCES `arya_member_event_subscription` (`member_event_subscription_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_member_event_carry_transfer_member` FOREIGN KEY (`member_id`) REFERENCES `arya_member` (`member_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_member_event_carry_transfer_reversal_of` FOREIGN KEY (`reversal_of_transfer_id`) REFERENCES `arya_member_event_carry_transfer` (`member_event_carry_transfer_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_member_event_carry_transfer_reversed_by` FOREIGN KEY (`reversed_by`) REFERENCES `arya_user` (`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_member_event_carry_transfer_source_campaign` FOREIGN KEY (`source_campaign_id`) REFERENCES `arya_event_campaign` (`event_campaign_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_member_event_carry_transfer_source_subscription` FOREIGN KEY (`source_subscription_id`) REFERENCES `arya_member_event_subscription` (`member_event_subscription_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `chk_member_event_carry_transfer_amount` CHECK ((`amount` > 0)),
  CONSTRAINT `chk_member_event_carry_transfer_exactly_one_source` CHECK (((`source_subscription_id` is not null) <> (`source_campaign_id` is not null))),
  CONSTRAINT `chk_member_event_carry_transfer_single_destination` CHECK (((((`destination_subscription_id` is not null) and (`destination_campaign_id` is null)) or ((`destination_subscription_id` is null) and (`destination_campaign_id` is not null))) and ((`destination_subscription_id` is null) or (`destination_subscription_id` <> `source_subscription_id`)))),
  CONSTRAINT `chk_member_event_carry_transfer_status` CHECK ((`status` in (_utf8mb4'ACTIVE',_utf8mb4'REVERSED')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `arya_member_event_coverage` (
  `member_event_coverage_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `member_event_subscription_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `bank_transaction_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `coverage_source` varchar(20) NOT NULL DEFAULT 'TRANSACTION',
  `coverage_status` varchar(20) NOT NULL DEFAULT 'ACTIVE',
  `unit_amount_snapshot` decimal(20,2) DEFAULT NULL,
  `duration_months_snapshot` int unsigned DEFAULT NULL,
  `granted_units` int unsigned DEFAULT NULL,
  `amount_applied` decimal(20,2) DEFAULT NULL,
  `coverage_from` date NOT NULL,
  `coverage_to` date NOT NULL,
  `remark` varchar(1000) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_by` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `voided_at` datetime(3) DEFAULT NULL,
  `voided_by` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `void_reason` varchar(1000) DEFAULT NULL,
  PRIMARY KEY (`member_event_coverage_id`),
  KEY `idx_member_event_cov_subscription` (`member_event_subscription_id`,`coverage_status`,`coverage_to`),
  KEY `idx_member_event_cov_transaction` (`bank_transaction_id`),
  KEY `idx_member_event_cov_period` (`coverage_from`,`coverage_to`),
  KEY `idx_member_event_cov_created_by` (`created_by`),
  KEY `idx_member_event_cov_voided_by` (`voided_by`),
  CONSTRAINT `fk_member_event_cov_created_by` FOREIGN KEY (`created_by`) REFERENCES `arya_user` (`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_member_event_cov_subscription` FOREIGN KEY (`member_event_subscription_id`) REFERENCES `arya_member_event_subscription` (`member_event_subscription_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_member_event_cov_transaction` FOREIGN KEY (`bank_transaction_id`) REFERENCES `arya_bank_transaction` (`bank_transaction_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_member_event_cov_voided_by` FOREIGN KEY (`voided_by`) REFERENCES `arya_user` (`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `arya_member_event_subscription` (
  `member_event_subscription_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `member_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `event_code_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `reference_no` varchar(100) DEFAULT NULL,
  `display_name` varchar(200) DEFAULT NULL,
  `start_date` date DEFAULT NULL,
  `valid_until` date DEFAULT NULL,
  `active_flag` tinyint(1) NOT NULL DEFAULT '1',
  `remark` varchar(1000) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_by` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `updated_by` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`member_event_subscription_id`),
  KEY `idx_member_event_sub_member_event` (`member_id`,`event_code_id`,`active_flag`),
  KEY `idx_member_event_sub_event` (`event_code_id`,`active_flag`),
  KEY `idx_member_event_sub_valid_until` (`valid_until`),
  KEY `idx_member_event_sub_reference` (`reference_no`),
  KEY `idx_member_event_sub_created_by` (`created_by`),
  KEY `idx_member_event_sub_updated_by` (`updated_by`),
  CONSTRAINT `fk_member_event_sub_created_by` FOREIGN KEY (`created_by`) REFERENCES `arya_user` (`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_member_event_sub_event_code` FOREIGN KEY (`event_code_id`) REFERENCES `arya_event_code` (`event_code_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_member_event_sub_member` FOREIGN KEY (`member_id`) REFERENCES `arya_member` (`member_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_member_event_sub_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `arya_user` (`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `arya_member_identity` (
  `member_identity_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `member_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `source_type` varchar(20) NOT NULL DEFAULT 'STATEMENT',
  `bank_name` varchar(100) DEFAULT NULL,
  `account_number` varchar(100) DEFAULT NULL,
  `account_type` varchar(100) DEFAULT NULL,
  `account_name` varchar(200) NOT NULL,
  `initial_name` varchar(100) DEFAULT NULL,
  `normalized_name` varchar(200) NOT NULL,
  `identity_key` varchar(191) NOT NULL,
  `verification_status` varchar(20) NOT NULL DEFAULT 'UNVERIFIED',
  `first_seen_statement_upload_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `first_seen_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `last_seen_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `verified_at` datetime(3) DEFAULT NULL,
  `verified_by` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `remark` varchar(500) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_by` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `updated_by` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`member_identity_id`),
  UNIQUE KEY `uk_member_identity_key` (`identity_key`),
  KEY `idx_member_identity_member` (`member_id`),
  KEY `idx_member_identity_status` (`verification_status`),
  KEY `idx_member_identity_normalized_name` (`normalized_name`),
  KEY `idx_member_identity_account_name` (`account_name`),
  KEY `idx_member_identity_account_number` (`account_number`),
  KEY `idx_member_identity_last_seen` (`last_seen_at`),
  KEY `fk_member_identity_first_statement` (`first_seen_statement_upload_id`),
  KEY `fk_member_identity_verified_by` (`verified_by`),
  KEY `fk_member_identity_created_by` (`created_by`),
  KEY `fk_member_identity_updated_by` (`updated_by`),
  CONSTRAINT `fk_member_identity_created_by` FOREIGN KEY (`created_by`) REFERENCES `arya_user` (`user_id`),
  CONSTRAINT `fk_member_identity_first_statement` FOREIGN KEY (`first_seen_statement_upload_id`) REFERENCES `arya_bank_statement_upload` (`statement_upload_id`),
  CONSTRAINT `fk_member_identity_member` FOREIGN KEY (`member_id`) REFERENCES `arya_member` (`member_id`),
  CONSTRAINT `fk_member_identity_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `arya_user` (`user_id`),
  CONSTRAINT `fk_member_identity_verified_by` FOREIGN KEY (`verified_by`) REFERENCES `arya_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `arya_member_identity_history` (
  `member_identity_history_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `member_identity_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `action` varchar(20) NOT NULL,
  `from_member_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `to_member_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status_before` varchar(20) NOT NULL,
  `status_after` varchar(20) NOT NULL,
  `reason` varchar(1000) DEFAULT NULL,
  `action_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `action_by` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`member_identity_history_id`),
  KEY `idx_member_identity_history_identity_action_at` (`member_identity_id`,`action_at`),
  KEY `idx_member_identity_history_from_member` (`from_member_id`,`action_at`),
  KEY `idx_member_identity_history_to_member` (`to_member_id`,`action_at`),
  KEY `idx_member_identity_history_action_by` (`action_by`),
  CONSTRAINT `fk_member_identity_history_action_by` FOREIGN KEY (`action_by`) REFERENCES `arya_user` (`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_member_identity_history_from_member` FOREIGN KEY (`from_member_id`) REFERENCES `arya_member` (`member_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_member_identity_history_identity` FOREIGN KEY (`member_identity_id`) REFERENCES `arya_member_identity` (`member_identity_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_member_identity_history_to_member` FOREIGN KEY (`to_member_id`) REFERENCES `arya_member` (`member_id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `arya_menu` (
  `menu_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `parent_menu_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `menu_code` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `menu_name` varchar(150) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `route` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `menu_type` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `display_order` int NOT NULL DEFAULT '0',
  `active_flag` tinyint(1) NOT NULL DEFAULT '1',
  `created_by` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_by` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`menu_id`),
  KEY `parent_menu_id` (`parent_menu_id`),
  KEY `created_by` (`created_by`),
  KEY `updated_by` (`updated_by`),
  CONSTRAINT `arya_menu_ibfk_1` FOREIGN KEY (`parent_menu_id`) REFERENCES `arya_menu` (`menu_id`),
  CONSTRAINT `arya_menu_ibfk_2` FOREIGN KEY (`created_by`) REFERENCES `arya_user` (`user_id`),
  CONSTRAINT `arya_menu_ibfk_3` FOREIGN KEY (`updated_by`) REFERENCES `arya_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `arya_reconciliation_approval` (
  `approval_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `statement_upload_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PENDING',
  `submitted_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `submitted_by` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `decided_at` datetime DEFAULT NULL,
  `decided_by` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `remark` varchar(1000) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`approval_id`),
  UNIQUE KEY `uq_reconciliation_approval_statement` (`statement_upload_id`),
  KEY `submitted_by` (`submitted_by`),
  KEY `decided_by` (`decided_by`),
  KEY `idx_reconciliation_approval_status_submitted` (`status`,`submitted_at`),
  CONSTRAINT `arya_reconciliation_approval_ibfk_1` FOREIGN KEY (`statement_upload_id`) REFERENCES `arya_bank_statement_upload` (`statement_upload_id`),
  CONSTRAINT `arya_reconciliation_approval_ibfk_2` FOREIGN KEY (`submitted_by`) REFERENCES `arya_user` (`user_id`),
  CONSTRAINT `arya_reconciliation_approval_ibfk_3` FOREIGN KEY (`decided_by`) REFERENCES `arya_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `arya_reconciliation_approval_approver` (
  `reconciliation_approval_approver_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `reconciliation_approval_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `user_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`reconciliation_approval_approver_id`),
  UNIQUE KEY `uk_reconciliation_approval_approver` (`reconciliation_approval_id`,`user_id`),
  KEY `idx_reconciliation_approval_approver_user` (`user_id`),
  CONSTRAINT `fk_reconciliation_approval_approver_approval` FOREIGN KEY (`reconciliation_approval_id`) REFERENCES `arya_reconciliation_approval` (`approval_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_reconciliation_approval_approver_user` FOREIGN KEY (`user_id`) REFERENCES `arya_user` (`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `arya_reconciliation_approval_history` (
  `approval_history_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `approval_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `action` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `remark` varchar(1000) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `action_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `action_by` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`approval_history_id`),
  KEY `action_by` (`action_by`),
  KEY `idx_reconciliation_approval_history_approval_action` (`approval_id`,`action_at`),
  CONSTRAINT `arya_reconciliation_approval_history_ibfk_1` FOREIGN KEY (`approval_id`) REFERENCES `arya_reconciliation_approval` (`approval_id`),
  CONSTRAINT `arya_reconciliation_approval_history_ibfk_2` FOREIGN KEY (`action_by`) REFERENCES `arya_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `arya_reconciliation_correction_approver` (
  `correction_approver_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `correction_proposal_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `user_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`correction_approver_id`),
  UNIQUE KEY `uk_correction_approver` (`correction_proposal_id`,`user_id`),
  KEY `idx_correction_approver_user` (`user_id`),
  CONSTRAINT `fk_correction_approver_proposal` FOREIGN KEY (`correction_proposal_id`) REFERENCES `arya_reconciliation_correction_proposal` (`correction_proposal_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_correction_approver_user` FOREIGN KEY (`user_id`) REFERENCES `arya_user` (`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `arya_reconciliation_correction_item` (
  `correction_item_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `correction_proposal_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `action` varchar(20) NOT NULL,
  `bank_transaction_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `before_event_code_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `before_event_campaign_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `proposed_event_code_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `proposed_event_campaign_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `before_remark` varchar(1000) DEFAULT NULL,
  `proposed_remark` varchar(1000) DEFAULT NULL,
  `correction_reason` varchar(1000) DEFAULT NULL,
  `manual_transaction_date` date DEFAULT NULL,
  `manual_transaction_type` varchar(20) DEFAULT NULL,
  `manual_description` text,
  `manual_original_amount` decimal(20,2) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`correction_item_id`),
  KEY `idx_correction_item_proposal_action` (`correction_proposal_id`,`action`),
  KEY `idx_correction_item_transaction` (`bank_transaction_id`),
  KEY `idx_correction_item_before_event` (`before_event_code_id`),
  KEY `idx_correction_item_proposed_event` (`proposed_event_code_id`),
  KEY `idx_correction_item_before_campaign` (`before_event_campaign_id`),
  KEY `idx_correction_item_proposed_campaign` (`proposed_event_campaign_id`),
  CONSTRAINT `fk_correction_item_before_campaign` FOREIGN KEY (`before_event_campaign_id`) REFERENCES `arya_event_campaign` (`event_campaign_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_correction_item_before_event` FOREIGN KEY (`before_event_code_id`) REFERENCES `arya_event_code` (`event_code_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_correction_item_proposal` FOREIGN KEY (`correction_proposal_id`) REFERENCES `arya_reconciliation_correction_proposal` (`correction_proposal_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_correction_item_proposed_campaign` FOREIGN KEY (`proposed_event_campaign_id`) REFERENCES `arya_event_campaign` (`event_campaign_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_correction_item_proposed_event` FOREIGN KEY (`proposed_event_code_id`) REFERENCES `arya_event_code` (`event_code_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_correction_item_transaction` FOREIGN KEY (`bank_transaction_id`) REFERENCES `arya_bank_transaction` (`bank_transaction_id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `arya_reconciliation_correction_proposal` (
  `correction_proposal_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `approval_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `statement_upload_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'PENDING',
  `proposed_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `proposed_by` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `decided_at` datetime DEFAULT NULL,
  `decided_by` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`correction_proposal_id`),
  KEY `idx_correction_proposal_approval_status` (`approval_id`,`status`),
  KEY `idx_correction_proposal_statement_status` (`statement_upload_id`,`status`),
  KEY `idx_correction_proposal_proposed_by` (`proposed_by`),
  KEY `idx_correction_proposal_decided_by` (`decided_by`),
  CONSTRAINT `fk_correction_proposal_approval` FOREIGN KEY (`approval_id`) REFERENCES `arya_reconciliation_approval` (`approval_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_correction_proposal_decided_by` FOREIGN KEY (`decided_by`) REFERENCES `arya_user` (`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_correction_proposal_proposed_by` FOREIGN KEY (`proposed_by`) REFERENCES `arya_user` (`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_correction_proposal_statement` FOREIGN KEY (`statement_upload_id`) REFERENCES `arya_bank_statement_upload` (`statement_upload_id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `arya_role` (
  `role_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `role_code` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `role_name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `active_flag` tinyint(1) NOT NULL DEFAULT '1',
  `created_by` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_by` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`role_id`),
  KEY `fk_role_created_by` (`created_by`),
  KEY `fk_role_updated_by` (`updated_by`),
  CONSTRAINT `fk_role_created_by` FOREIGN KEY (`created_by`) REFERENCES `arya_user` (`user_id`),
  CONSTRAINT `fk_role_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `arya_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `arya_role_menu` (
  `role_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `menu_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_by` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`role_id`,`menu_id`),
  KEY `menu_id` (`menu_id`),
  KEY `created_by` (`created_by`),
  CONSTRAINT `arya_role_menu_ibfk_1` FOREIGN KEY (`role_id`) REFERENCES `arya_role` (`role_id`),
  CONSTRAINT `arya_role_menu_ibfk_2` FOREIGN KEY (`menu_id`) REFERENCES `arya_menu` (`menu_id`),
  CONSTRAINT `arya_role_menu_ibfk_3` FOREIGN KEY (`created_by`) REFERENCES `arya_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `arya_user` (
  `user_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `full_name` varchar(150) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `email` varchar(150) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `password_hash` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'ACTIVE',
  `created_by` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_by` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`),
  KEY `fk_user_created_by` (`created_by`),
  KEY `fk_user_updated_by` (`updated_by`),
  CONSTRAINT `fk_user_created_by` FOREIGN KEY (`created_by`) REFERENCES `arya_user` (`user_id`),
  CONSTRAINT `fk_user_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `arya_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `arya_user_role` (
  `user_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `role_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`user_id`,`role_id`),
  KEY `role_id` (`role_id`),
  CONSTRAINT `arya_user_role_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `arya_user` (`user_id`),
  CONSTRAINT `arya_user_role_ibfk_2` FOREIGN KEY (`role_id`) REFERENCES `arya_role` (`role_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;
