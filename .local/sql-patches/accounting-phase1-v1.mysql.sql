-- Arya Tarray Accounting Phase 1 / v1 / 2026-10-06
-- MANUAL under explicit target approval. Historical test foundation gate was completed on 2026-10-07.
-- Review under an approved external access-controlled change record.
-- Current DEV is already provisioned. Do not rerun this CREATE-table patch against existing DEV tables.
-- Future target: arya_tarray_prod, only during a separately approved PROD deployment change window.
-- The former local foundation databases are retired; never target or recreate them with this patch.
-- Select the target database explicitly in your SQL client; this patch contains no USE statement.
-- Preconditions: MySQL 8.4 (CHECK requires MySQL >=8.0.16); baseline 32 application tables;
-- existing referenced CHAR(36) columns use utf8mb4_unicode_ci; confirm below.
-- The three accounting tables must not exist. DDL is not transactional in MySQL.
-- No migration runner, triggers, backfill, opening balance, or application startup provisioning.
-- Stop on an unexpected target/collation/table set. Review a partial apply manually; do not rerun blindly.

SELECT DATABASE() AS selected_database, VERSION() AS mysql_version;
SELECT TABLE_NAME, COLUMN_NAME, COLLATION_NAME FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA=DATABASE() AND COLUMN_NAME IN
('bank_transaction_id','correction_item_id','user_id','bank_account_id','event_code_id','event_campaign_id','member_identity_id','member_id')
AND TABLE_NAME NOT LIKE 'arya_accounting_%';
SELECT TABLE_NAME FROM information_schema.TABLES
WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME LIKE 'arya_accounting_%';

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

-- Minimal COA only; no account hierarchy or speculative accounts.
INSERT INTO arya_accounting_account
(accounting_account_id, account_code, account_name, account_type, normal_balance, posting_flag, active_flag)
VALUES
('a0000000-0000-4000-8000-000000001110','1110','Bank','ASSET','DEBIT',TRUE,TRUE),
('a0000000-0000-4000-8000-000000004110','4110','Contribution Revenue','REVENUE','CREDIT',TRUE,TRUE);

-- One PAGE permission for the Accounting workspace, including preview and export.
-- No automatic role grant. A human grants it through existing Role configuration.
INSERT INTO arya_menu
(menu_id, parent_menu_id, menu_code, menu_name, route, menu_type, display_order, active_flag, created_at, updated_at)
VALUES ('a0000000-0000-4000-8000-000000000001',NULL,'ACCOUNTING_REPORT','Accounting','/accounting','PAGE',5,TRUE,NOW(),NOW());

-- Cutover is deployment environment configuration, not a database setting:
-- ACCOUNTING_CUTOVER_DATE=<approved YYYY-MM-01>. The example 2026-11-01 is NOT an approval.
-- Deploy recognition integration only after tables, COA, permission and approved cutover are ready.
-- No backfill command exists.

-- Verification: three tables, two accounts, one active PAGE, enforced CHECKs.
SELECT TABLE_NAME FROM information_schema.TABLES
WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME LIKE 'arya_accounting_%' ORDER BY TABLE_NAME;
SELECT account_code, account_name, account_type, normal_balance, posting_flag, active_flag
FROM arya_accounting_account ORDER BY account_code;
SELECT menu_code, route, menu_type, active_flag FROM arya_menu WHERE menu_code='ACCOUNTING_REPORT';
SELECT CONSTRAINT_NAME, CONSTRAINT_TYPE FROM information_schema.TABLE_CONSTRAINTS
WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME LIKE 'arya_accounting_%' ORDER BY TABLE_NAME, CONSTRAINT_NAME;
SELECT COUNT(*) AS journals_before_accounting_activation FROM arya_accounting_journal;
SELECT accounting_journal_id, SUM(debit) AS debit, SUM(credit) AS credit
FROM arya_accounting_journal_line GROUP BY accounting_journal_id HAVING SUM(debit) <> SUM(credit);
-- The last query must return zero rows.

-- Rollback guidance (not executable rollback SQL):
-- Before any postings, stop Accounting activation and have a human review removal of these
-- three empty tables in dependency order: line, journal, account, and the new menu/role grants.
-- After postings exist, preserve all journal evidence. Roll back application deployment and
-- use a separately approved forward repair; never delete posted journals to undo deployment.
