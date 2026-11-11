-- Arya Tarray full accrual accounting: DEV-only structural migration.
-- STATUS: APPLIED to verified local arya_tarray_dev on 2026-11-03 (Asia/Jakarta).
-- Do not re-run: this is a non-idempotent historical migration record.
-- Never use --force. Stop at the first error; MySQL DDL commits implicitly.
-- Preflight immediately before applying: verify DATABASE() = arya_tarray_dev,
-- 35 original tables, 2 accounting accounts (1110, 4110), and zero journals/lines.
-- Take and verify a fresh full backup before the first ALTER.
-- This patch is intentionally not idempotent: a partial run requires manual inventory.

USE `arya_tarray_dev`;

-- 01. Keep Phase 1 account identities/codes while extending the COA.
ALTER TABLE `arya_accounting_account`
  DROP CHECK `ck_accounting_account_type`,
  ADD COLUMN `parent_account_id` CHAR(36) NULL AFTER `account_name`,
  ADD COLUMN `account_classification` VARCHAR(40) NULL AFTER `account_type`,
  ADD COLUMN `report_section` VARCHAR(40) NULL AFTER `account_classification`,
  ADD COLUMN `contra_flag` BOOLEAN NOT NULL DEFAULT FALSE AFTER `normal_balance`,
  ADD KEY `idx_acc_account_parent` (`parent_account_id`),
  ADD CONSTRAINT `fk_acc_account_parent` FOREIGN KEY (`parent_account_id`)
    REFERENCES `arya_accounting_account` (`accounting_account_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `ck_acc_account_type_v2` CHECK (`account_type` IN
    ('ASSET','LIABILITY','NET_ASSET','REVENUE','EXPENSE')),
  ADD CONSTRAINT `ck_acc_account_not_self` CHECK
    (`parent_account_id` IS NULL OR `parent_account_id` <> `accounting_account_id`);

-- 02. Periods and counterparties precede journal extensions.
CREATE TABLE `arya_accounting_fiscal_year` (
  `fiscal_year_id` CHAR(36) NOT NULL,
  `year_code` VARCHAR(20) NOT NULL,
  `start_date` DATE NOT NULL,
  `end_date` DATE NOT NULL,
  `status` VARCHAR(12) NOT NULL DEFAULT 'OPEN',
  `closed_at` DATETIME(3) NULL,
  `closed_by` CHAR(36) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`fiscal_year_id`),
  UNIQUE KEY `uk_acc_fy_code` (`year_code`),
  KEY `idx_acc_fy_dates` (`start_date`,`end_date`),
  KEY `idx_acc_fy_closed_by` (`closed_by`),
  CONSTRAINT `fk_acc_fy_closed_by` FOREIGN KEY (`closed_by`) REFERENCES `arya_user` (`user_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ck_acc_fy_dates` CHECK (`start_date` <= `end_date`),
  CONSTRAINT `ck_acc_fy_status` CHECK (`status` IN ('OPEN','CLOSING','CLOSED')),
  CONSTRAINT `ck_acc_fy_closed` CHECK (`status` <> 'CLOSED' OR `closed_at` IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `arya_accounting_period` (
  `accounting_period_id` CHAR(36) NOT NULL,
  `fiscal_year_id` CHAR(36) NOT NULL,
  `period_no` SMALLINT UNSIGNED NOT NULL,
  `period_code` VARCHAR(20) NOT NULL,
  `start_date` DATE NOT NULL,
  `end_date` DATE NOT NULL,
  `status` VARCHAR(12) NOT NULL DEFAULT 'OPEN',
  `closing_journal_id` CHAR(36) NULL,
  `closed_at` DATETIME(3) NULL,
  `closed_by` CHAR(36) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`accounting_period_id`),
  UNIQUE KEY `uk_acc_period_code` (`period_code`),
  UNIQUE KEY `uk_acc_period_year_no` (`fiscal_year_id`,`period_no`),
  KEY `idx_acc_period_dates` (`start_date`,`end_date`),
  KEY `idx_acc_period_closed_by` (`closed_by`),
  KEY `idx_acc_period_close_journal` (`closing_journal_id`),
  CONSTRAINT `fk_acc_period_fy` FOREIGN KEY (`fiscal_year_id`) REFERENCES `arya_accounting_fiscal_year` (`fiscal_year_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_acc_period_closed_by` FOREIGN KEY (`closed_by`) REFERENCES `arya_user` (`user_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ck_acc_period_no` CHECK (`period_no` BETWEEN 1 AND 53),
  CONSTRAINT `ck_acc_period_dates` CHECK (`start_date` <= `end_date`),
  CONSTRAINT `ck_acc_period_status` CHECK (`status` IN ('OPEN','CLOSING','CLOSED')),
  CONSTRAINT `ck_acc_period_closed` CHECK (`status` <> 'CLOSED' OR `closed_at` IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `arya_accounting_counterparty` (
  `counterparty_id` CHAR(36) NOT NULL,
  `counterparty_code` VARCHAR(40) NOT NULL,
  `display_name` VARCHAR(200) NOT NULL,
  `counterparty_type` VARCHAR(12) NOT NULL,
  `member_id` CHAR(36) NULL,
  `active_flag` BOOLEAN NOT NULL DEFAULT TRUE,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`counterparty_id`),
  UNIQUE KEY `uk_acc_counterparty_code` (`counterparty_code`),
  UNIQUE KEY `uk_acc_counterparty_member` (`member_id`),
  CONSTRAINT `fk_acc_counterparty_member` FOREIGN KEY (`member_id`) REFERENCES `arya_member` (`member_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ck_acc_counterparty_type` CHECK (`counterparty_type` IN ('VENDOR','DEBTOR','BOTH'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 03. Fund master distinguishes donor restrictions, internal designations and liabilities.
CREATE TABLE `arya_accounting_fund` (
  `accounting_fund_id` CHAR(36) NOT NULL,
  `fund_code` VARCHAR(40) NOT NULL,
  `fund_name` VARCHAR(200) NOT NULL,
  `fund_class` VARCHAR(25) NOT NULL,
  `balance_account_id` CHAR(36) NULL,
  `event_campaign_id` CHAR(36) NULL,
  `status` VARCHAR(12) NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`accounting_fund_id`),
  UNIQUE KEY `uk_acc_fund_code` (`fund_code`),
  KEY `idx_acc_fund_account` (`balance_account_id`),
  KEY `idx_acc_fund_campaign` (`event_campaign_id`),
  CONSTRAINT `fk_acc_fund_account` FOREIGN KEY (`balance_account_id`) REFERENCES `arya_accounting_account` (`accounting_account_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_acc_fund_campaign` FOREIGN KEY (`event_campaign_id`) REFERENCES `arya_event_campaign` (`event_campaign_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ck_acc_fund_class` CHECK (`fund_class` IN
    ('UNRESTRICTED','DONOR_RESTRICTED','CONDITIONAL_LIABILITY')),
  CONSTRAINT `ck_acc_fund_status` CHECK (`status` IN ('ACTIVE','CLOSED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `arya_accounting_fund_restriction` (
  `fund_restriction_id` CHAR(36) NOT NULL,
  `accounting_fund_id` CHAR(36) NOT NULL,
  `donor_member_id` CHAR(36) NULL,
  `restriction_kind` VARCHAR(12) NOT NULL,
  `purpose_text` VARCHAR(1000) NULL,
  `effective_on` DATE NULL,
  `release_on` DATE NULL,
  `supporting_reference` VARCHAR(255) NOT NULL,
  `status` VARCHAR(12) NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`fund_restriction_id`),
  UNIQUE KEY `uk_acc_restriction_source` (`accounting_fund_id`,`supporting_reference`),
  UNIQUE KEY `uk_acc_restriction_fund_pair` (`fund_restriction_id`,`accounting_fund_id`),
  KEY `idx_acc_restriction_donor` (`donor_member_id`),
  CONSTRAINT `fk_acc_restriction_fund` FOREIGN KEY (`accounting_fund_id`) REFERENCES `arya_accounting_fund` (`accounting_fund_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_acc_restriction_donor` FOREIGN KEY (`donor_member_id`) REFERENCES `arya_member` (`member_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ck_acc_restriction_kind` CHECK (`restriction_kind` IN ('PURPOSE','TIME','BOTH')),
  CONSTRAINT `ck_acc_restriction_purpose` CHECK
    (`restriction_kind` = 'TIME' OR (`purpose_text` IS NOT NULL AND CHAR_LENGTH(TRIM(`purpose_text`)) > 0)),
  CONSTRAINT `ck_acc_restriction_time` CHECK (`restriction_kind` = 'PURPOSE' OR `release_on` IS NOT NULL),
  CONSTRAINT `ck_acc_restriction_dates` CHECK
    (`effective_on` IS NULL OR `release_on` IS NULL OR `effective_on` <= `release_on`),
  CONSTRAINT `ck_acc_restriction_status` CHECK (`status` IN ('ACTIVE','SATISFIED','CANCELLED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `arya_accounting_fund_designation` (
  `fund_designation_id` CHAR(36) NOT NULL,
  `accounting_fund_id` CHAR(36) NOT NULL,
  `designation_reference` VARCHAR(100) NOT NULL,
  `purpose_text` VARCHAR(1000) NOT NULL,
  `approved_at` DATETIME(3) NOT NULL,
  `approved_by` CHAR(36) NOT NULL,
  `status` VARCHAR(12) NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`fund_designation_id`),
  UNIQUE KEY `uk_acc_designation_ref` (`designation_reference`),
  KEY `idx_acc_designation_fund` (`accounting_fund_id`),
  KEY `idx_acc_designation_actor` (`approved_by`),
  CONSTRAINT `fk_acc_designation_fund` FOREIGN KEY (`accounting_fund_id`) REFERENCES `arya_accounting_fund` (`accounting_fund_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_acc_designation_actor` FOREIGN KEY (`approved_by`) REFERENCES `arya_user` (`user_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ck_acc_designation_status` CHECK (`status` IN ('ACTIVE','RELEASED','CANCELLED')),
  CONSTRAINT `ck_acc_designation_purpose` CHECK (CHAR_LENGTH(TRIM(`purpose_text`)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 04. A single journal/line remains the authoritative GL; no GL or trial-balance copy.
ALTER TABLE `arya_accounting_journal`
  DROP CHECK `ck_accounting_journal_type`,
  MODIFY COLUMN `bank_transaction_id` CHAR(36) NULL,
  ADD COLUMN `accounting_period_id` CHAR(36) NULL AFTER `accounting_date`,
  ADD COLUMN `source_kind` VARCHAR(30) NULL AFTER `source_event_key`,
  ADD COLUMN `source_reference` VARCHAR(150) NULL AFTER `source_kind`,
  ADD COLUMN `reversal_of_journal_id` CHAR(36) NULL AFTER `related_journal_id`,
  ADD UNIQUE KEY `uk_acc_journal_reversal` (`reversal_of_journal_id`),
  ADD KEY `idx_acc_journal_period` (`accounting_period_id`,`accounting_date`),
  ADD KEY `idx_acc_journal_source_ref` (`source_kind`,`source_reference`),
  ADD CONSTRAINT `fk_acc_journal_period` FOREIGN KEY (`accounting_period_id`)
    REFERENCES `arya_accounting_period` (`accounting_period_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `fk_acc_journal_reversal` FOREIGN KEY (`reversal_of_journal_id`)
    REFERENCES `arya_accounting_journal` (`accounting_journal_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `ck_acc_journal_type_v2` CHECK (`journal_type` IN
    ('RECOGNITION','RECLASSIFICATION','OPENING','ACCRUAL','ADJUSTMENT','REVERSAL',
     'DEPRECIATION','PAYMENT','RECEIPT','CLOSING','FUND_RELEASE','MANUAL')),
  ADD CONSTRAINT `ck_acc_journal_not_self` CHECK
    (`reversal_of_journal_id` IS NULL OR `reversal_of_journal_id` <> `accounting_journal_id`);

ALTER TABLE `arya_accounting_period`
  ADD CONSTRAINT `fk_acc_period_close_journal` FOREIGN KEY (`closing_journal_id`)
    REFERENCES `arya_accounting_journal` (`accounting_journal_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `arya_accounting_journal_line`
  MODIFY COLUMN `bank_account_id` CHAR(36) NULL,
  MODIFY COLUMN `bank_name_snapshot` VARCHAR(100) NULL,
  MODIFY COLUMN `bank_account_no_snapshot` VARCHAR(100) NULL,
  MODIFY COLUMN `bank_account_name_snapshot` VARCHAR(200) NULL,
  ADD COLUMN `accounting_fund_id` CHAR(36) NULL AFTER `bank_account_name_snapshot`,
  ADD COLUMN `fund_restriction_id` CHAR(36) NULL AFTER `accounting_fund_id`,
  ADD COLUMN `counterparty_id` CHAR(36) NULL AFTER `fund_restriction_id`,
  ADD KEY `idx_acc_line_fund` (`accounting_fund_id`),
  ADD KEY `idx_acc_line_restriction` (`fund_restriction_id`,`accounting_fund_id`),
  ADD KEY `idx_acc_line_counterparty` (`counterparty_id`),
  ADD CONSTRAINT `fk_acc_line_fund` FOREIGN KEY (`accounting_fund_id`)
    REFERENCES `arya_accounting_fund` (`accounting_fund_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `fk_acc_line_restriction_fund` FOREIGN KEY (`fund_restriction_id`,`accounting_fund_id`)
    REFERENCES `arya_accounting_fund_restriction` (`fund_restriction_id`,`accounting_fund_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `fk_acc_line_counterparty` FOREIGN KEY (`counterparty_id`)
    REFERENCES `arya_accounting_counterparty` (`counterparty_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `ck_acc_line_bank_snapshots` CHECK
    ((`bank_account_id` IS NULL AND `bank_name_snapshot` IS NULL AND
      `bank_account_no_snapshot` IS NULL AND `bank_account_name_snapshot` IS NULL) OR
     (`bank_account_id` IS NOT NULL AND `bank_name_snapshot` IS NOT NULL AND
      `bank_account_no_snapshot` IS NOT NULL AND `bank_account_name_snapshot` IS NOT NULL)),
  ADD CONSTRAINT `ck_acc_line_restriction_fund` CHECK
    (`fund_restriction_id` IS NULL OR `accounting_fund_id` IS NOT NULL);

CREATE TABLE `arya_accounting_opening_batch` (
  `opening_batch_id` CHAR(36) NOT NULL,
  `fiscal_year_id` CHAR(36) NOT NULL,
  `batch_reference` VARCHAR(100) NOT NULL,
  `effective_on` DATE NOT NULL,
  `source_reference` VARCHAR(255) NOT NULL,
  `journal_id` CHAR(36) NULL,
  `created_by` CHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`opening_batch_id`),
  UNIQUE KEY `uk_acc_opening_ref` (`batch_reference`),
  UNIQUE KEY `uk_acc_opening_journal` (`journal_id`),
  KEY `idx_acc_opening_fy` (`fiscal_year_id`),
  KEY `idx_acc_opening_actor` (`created_by`),
  CONSTRAINT `fk_acc_opening_fy` FOREIGN KEY (`fiscal_year_id`) REFERENCES `arya_accounting_fiscal_year` (`fiscal_year_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_acc_opening_journal` FOREIGN KEY (`journal_id`) REFERENCES `arya_accounting_journal` (`accounting_journal_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_acc_opening_actor` FOREIGN KEY (`created_by`) REFERENCES `arya_user` (`user_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 05. AP/AR documents and settlements. Balances are derived from document lines
-- and allocations; recognition/payment journals are the only posted GL truth.
CREATE TABLE `arya_accounting_document` (
  `accounting_document_id` CHAR(36) NOT NULL,
  `document_kind` VARCHAR(10) NOT NULL,
  `counterparty_id` CHAR(36) NOT NULL,
  `document_number` VARCHAR(100) NOT NULL,
  `source_reference` VARCHAR(255) NOT NULL,
  `document_date` DATE NOT NULL,
  `due_date` DATE NOT NULL,
  `status` VARCHAR(12) NOT NULL DEFAULT 'DRAFT',
  `recognition_journal_id` CHAR(36) NULL,
  `created_by` CHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`accounting_document_id`),
  UNIQUE KEY `uk_acc_doc_number` (`document_kind`,`counterparty_id`,`document_number`),
  UNIQUE KEY `uk_acc_doc_source` (`document_kind`,`source_reference`),
  UNIQUE KEY `uk_acc_doc_journal` (`recognition_journal_id`),
  UNIQUE KEY `uk_acc_doc_allocation_ref` (`accounting_document_id`,`document_kind`,`counterparty_id`),
  KEY `idx_acc_doc_due` (`document_kind`,`status`,`due_date`),
  KEY `idx_acc_doc_actor` (`created_by`),
  CONSTRAINT `fk_acc_doc_counterparty` FOREIGN KEY (`counterparty_id`) REFERENCES `arya_accounting_counterparty` (`counterparty_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_acc_doc_journal` FOREIGN KEY (`recognition_journal_id`) REFERENCES `arya_accounting_journal` (`accounting_journal_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_acc_doc_actor` FOREIGN KEY (`created_by`) REFERENCES `arya_user` (`user_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ck_acc_doc_kind` CHECK (`document_kind` IN ('PAYABLE','RECEIVABLE')),
  CONSTRAINT `ck_acc_doc_status` CHECK (`status` IN ('DRAFT','RECOGNIZED','VOID')),
  CONSTRAINT `ck_acc_doc_recognition` CHECK (`status` <> 'RECOGNIZED' OR `recognition_journal_id` IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `arya_accounting_document_line` (
  `accounting_document_line_id` CHAR(36) NOT NULL,
  `accounting_document_id` CHAR(36) NOT NULL,
  `line_no` INT UNSIGNED NOT NULL,
  `accounting_account_id` CHAR(36) NOT NULL,
  `description` VARCHAR(500) NOT NULL,
  `amount` DECIMAL(20,2) NOT NULL,
  `accounting_fund_id` CHAR(36) NULL,
  `event_campaign_id` CHAR(36) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`accounting_document_line_id`),
  UNIQUE KEY `uk_acc_doc_line_no` (`accounting_document_id`,`line_no`),
  KEY `idx_acc_doc_line_account` (`accounting_account_id`),
  KEY `idx_acc_doc_line_fund` (`accounting_fund_id`),
  KEY `idx_acc_doc_line_campaign` (`event_campaign_id`),
  CONSTRAINT `fk_acc_doc_line_doc` FOREIGN KEY (`accounting_document_id`) REFERENCES `arya_accounting_document` (`accounting_document_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_acc_doc_line_account` FOREIGN KEY (`accounting_account_id`) REFERENCES `arya_accounting_account` (`accounting_account_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_acc_doc_line_fund` FOREIGN KEY (`accounting_fund_id`) REFERENCES `arya_accounting_fund` (`accounting_fund_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_acc_doc_line_campaign` FOREIGN KEY (`event_campaign_id`) REFERENCES `arya_event_campaign` (`event_campaign_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ck_acc_doc_line_amount` CHECK (`amount` > 0),
  CONSTRAINT `ck_acc_doc_line_no` CHECK (`line_no` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `arya_accounting_settlement` (
  `accounting_settlement_id` CHAR(36) NOT NULL,
  `settlement_kind` VARCHAR(10) NOT NULL,
  `counterparty_id` CHAR(36) NOT NULL,
  `settlement_reference` VARCHAR(100) NOT NULL,
  `settlement_date` DATE NOT NULL,
  `amount` DECIMAL(20,2) NOT NULL,
  `bank_transaction_id` CHAR(36) NULL,
  `posting_journal_id` CHAR(36) NULL,
  `status` VARCHAR(12) NOT NULL DEFAULT 'DRAFT',
  `created_by` CHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`accounting_settlement_id`),
  UNIQUE KEY `uk_acc_settlement_ref` (`settlement_kind`,`settlement_reference`),
  UNIQUE KEY `uk_acc_settlement_journal` (`posting_journal_id`),
  UNIQUE KEY `uk_acc_settlement_alloc_ref` (`accounting_settlement_id`,`settlement_kind`,`counterparty_id`),
  KEY `idx_acc_settlement_cp_date` (`counterparty_id`,`settlement_date`),
  KEY `idx_acc_settlement_bank` (`bank_transaction_id`),
  KEY `idx_acc_settlement_actor` (`created_by`),
  CONSTRAINT `fk_acc_settlement_cp` FOREIGN KEY (`counterparty_id`) REFERENCES `arya_accounting_counterparty` (`counterparty_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_acc_settlement_bank` FOREIGN KEY (`bank_transaction_id`) REFERENCES `arya_bank_transaction` (`bank_transaction_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_acc_settlement_journal` FOREIGN KEY (`posting_journal_id`) REFERENCES `arya_accounting_journal` (`accounting_journal_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_acc_settlement_actor` FOREIGN KEY (`created_by`) REFERENCES `arya_user` (`user_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ck_acc_settlement_kind` CHECK (`settlement_kind` IN ('PAYABLE','RECEIVABLE')),
  CONSTRAINT `ck_acc_settlement_amount` CHECK (`amount` > 0),
  CONSTRAINT `ck_acc_settlement_status` CHECK (`status` IN ('DRAFT','POSTED','VOID')),
  CONSTRAINT `ck_acc_settlement_posted` CHECK (`status` <> 'POSTED' OR `posting_journal_id` IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `arya_accounting_settlement_allocation` (
  `settlement_allocation_id` CHAR(36) NOT NULL,
  `accounting_document_id` CHAR(36) NOT NULL,
  `accounting_settlement_id` CHAR(36) NOT NULL,
  `document_kind` VARCHAR(10) NOT NULL,
  `counterparty_id` CHAR(36) NOT NULL,
  `allocated_amount` DECIMAL(20,2) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`settlement_allocation_id`),
  UNIQUE KEY `uk_acc_allocation_pair` (`accounting_document_id`,`accounting_settlement_id`),
  KEY `idx_acc_allocation_doc` (`accounting_document_id`,`document_kind`,`counterparty_id`),
  KEY `idx_acc_allocation_settlement` (`accounting_settlement_id`,`document_kind`,`counterparty_id`),
  CONSTRAINT `fk_acc_allocation_doc` FOREIGN KEY (`accounting_document_id`,`document_kind`,`counterparty_id`)
    REFERENCES `arya_accounting_document` (`accounting_document_id`,`document_kind`,`counterparty_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_acc_allocation_settlement` FOREIGN KEY (`accounting_settlement_id`,`document_kind`,`counterparty_id`)
    REFERENCES `arya_accounting_settlement` (`accounting_settlement_id`,`settlement_kind`,`counterparty_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ck_acc_allocation_amount` CHECK (`allocated_amount` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `arya_accounting_document_adjustment` (
  `document_adjustment_id` CHAR(36) NOT NULL,
  `accounting_document_id` CHAR(36) NOT NULL,
  `adjustment_reference` VARCHAR(100) NOT NULL,
  `adjustment_kind` VARCHAR(10) NOT NULL,
  `amount` DECIMAL(20,2) NOT NULL,
  `reason` VARCHAR(500) NOT NULL,
  `adjustment_journal_id` CHAR(36) NOT NULL,
  `created_by` CHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`document_adjustment_id`),
  UNIQUE KEY `uk_acc_doc_adjust_ref` (`adjustment_reference`),
  UNIQUE KEY `uk_acc_doc_adjust_journal` (`adjustment_journal_id`),
  KEY `idx_acc_doc_adjust_doc` (`accounting_document_id`),
  KEY `idx_acc_doc_adjust_actor` (`created_by`),
  CONSTRAINT `fk_acc_doc_adjust_doc` FOREIGN KEY (`accounting_document_id`) REFERENCES `arya_accounting_document` (`accounting_document_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_acc_doc_adjust_journal` FOREIGN KEY (`adjustment_journal_id`) REFERENCES `arya_accounting_journal` (`accounting_journal_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_acc_doc_adjust_actor` FOREIGN KEY (`created_by`) REFERENCES `arya_user` (`user_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ck_acc_doc_adjust_kind` CHECK (`adjustment_kind` IN ('INCREASE','DECREASE')),
  CONSTRAINT `ck_acc_doc_adjust_amount` CHECK (`amount` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 06. Recognition and amortization schedules are planning records. Posted
-- amounts remain exclusively in journal lines.
CREATE TABLE `arya_accounting_schedule` (
  `accounting_schedule_id` CHAR(36) NOT NULL,
  `schedule_reference` VARCHAR(100) NOT NULL,
  `schedule_kind` VARCHAR(20) NOT NULL,
  `source_journal_line_id` CHAR(36) NOT NULL,
  `accounting_document_id` CHAR(36) NULL,
  `recognition_account_id` CHAR(36) NOT NULL,
  `balance_account_id` CHAR(36) NOT NULL,
  `planned_amount` DECIMAL(20,2) NOT NULL,
  `start_date` DATE NOT NULL,
  `end_date` DATE NOT NULL,
  `status` VARCHAR(12) NOT NULL DEFAULT 'ACTIVE',
  `created_by` CHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`accounting_schedule_id`),
  UNIQUE KEY `uk_acc_schedule_ref` (`schedule_reference`),
  KEY `idx_acc_schedule_source` (`source_journal_line_id`),
  KEY `idx_acc_schedule_doc` (`accounting_document_id`),
  KEY `idx_acc_schedule_rec_account` (`recognition_account_id`),
  KEY `idx_acc_schedule_bal_account` (`balance_account_id`),
  KEY `idx_acc_schedule_actor` (`created_by`),
  CONSTRAINT `fk_acc_schedule_source` FOREIGN KEY (`source_journal_line_id`) REFERENCES `arya_accounting_journal_line` (`accounting_journal_line_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_acc_schedule_doc` FOREIGN KEY (`accounting_document_id`) REFERENCES `arya_accounting_document` (`accounting_document_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_acc_schedule_rec_account` FOREIGN KEY (`recognition_account_id`) REFERENCES `arya_accounting_account` (`accounting_account_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_acc_schedule_bal_account` FOREIGN KEY (`balance_account_id`) REFERENCES `arya_accounting_account` (`accounting_account_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_acc_schedule_actor` FOREIGN KEY (`created_by`) REFERENCES `arya_user` (`user_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ck_acc_schedule_kind` CHECK (`schedule_kind` IN
    ('ACCRUED_EXPENSE','ACCRUED_INCOME','PREPAYMENT','DEFERRED_INCOME')),
  CONSTRAINT `ck_acc_schedule_dates` CHECK (`start_date` <= `end_date`),
  CONSTRAINT `ck_acc_schedule_amount` CHECK (`planned_amount` > 0),
  CONSTRAINT `ck_acc_schedule_status` CHECK (`status` IN ('ACTIVE','COMPLETED','CANCELLED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `arya_accounting_schedule_period` (
  `schedule_period_id` CHAR(36) NOT NULL,
  `accounting_schedule_id` CHAR(36) NOT NULL,
  `accounting_period_id` CHAR(36) NOT NULL,
  `planned_amount` DECIMAL(20,2) NOT NULL,
  `recognition_journal_id` CHAR(36) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`schedule_period_id`),
  UNIQUE KEY `uk_acc_schedule_period` (`accounting_schedule_id`,`accounting_period_id`),
  UNIQUE KEY `uk_acc_schedule_rec_journal` (`recognition_journal_id`),
  KEY `idx_acc_schedule_period_period` (`accounting_period_id`),
  CONSTRAINT `fk_acc_schedule_period_parent` FOREIGN KEY (`accounting_schedule_id`) REFERENCES `arya_accounting_schedule` (`accounting_schedule_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_acc_schedule_period_period` FOREIGN KEY (`accounting_period_id`) REFERENCES `arya_accounting_period` (`accounting_period_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_acc_schedule_period_journal` FOREIGN KEY (`recognition_journal_id`) REFERENCES `arya_accounting_journal` (`accounting_journal_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ck_acc_schedule_period_amount` CHECK (`planned_amount` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 07. Fixed asset register and per-period depreciation evidence.
CREATE TABLE `arya_accounting_asset_category` (
  `asset_category_id` CHAR(36) NOT NULL,
  `category_code` VARCHAR(40) NOT NULL,
  `category_name` VARCHAR(150) NOT NULL,
  `asset_account_id` CHAR(36) NOT NULL,
  `accumulated_depreciation_account_id` CHAR(36) NOT NULL,
  `depreciation_expense_account_id` CHAR(36) NOT NULL,
  `default_useful_life_months` INT UNSIGNED NOT NULL,
  `default_method` VARCHAR(20) NOT NULL DEFAULT 'STRAIGHT_LINE',
  `active_flag` BOOLEAN NOT NULL DEFAULT TRUE,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`asset_category_id`),
  UNIQUE KEY `uk_acc_asset_category_code` (`category_code`),
  KEY `idx_acc_asset_cat_asset_account` (`asset_account_id`),
  KEY `idx_acc_asset_cat_accum_account` (`accumulated_depreciation_account_id`),
  KEY `idx_acc_asset_cat_exp_account` (`depreciation_expense_account_id`),
  CONSTRAINT `fk_acc_asset_cat_asset` FOREIGN KEY (`asset_account_id`) REFERENCES `arya_accounting_account` (`accounting_account_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_acc_asset_cat_accum` FOREIGN KEY (`accumulated_depreciation_account_id`) REFERENCES `arya_accounting_account` (`accounting_account_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_acc_asset_cat_exp` FOREIGN KEY (`depreciation_expense_account_id`) REFERENCES `arya_accounting_account` (`accounting_account_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ck_acc_asset_cat_life` CHECK (`default_useful_life_months` > 0),
  CONSTRAINT `ck_acc_asset_cat_method` CHECK (`default_method` IN ('STRAIGHT_LINE','DECLINING_BALANCE'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `arya_accounting_fixed_asset` (
  `fixed_asset_id` CHAR(36) NOT NULL,
  `asset_category_id` CHAR(36) NOT NULL,
  `asset_number` VARCHAR(80) NOT NULL,
  `asset_name` VARCHAR(200) NOT NULL,
  `acquired_on` DATE NOT NULL,
  `in_service_on` DATE NOT NULL,
  `acquisition_cost` DECIMAL(20,2) NOT NULL,
  `residual_value` DECIMAL(20,2) NOT NULL DEFAULT 0,
  `useful_life_months` INT UNSIGNED NOT NULL,
  `depreciation_method` VARCHAR(20) NOT NULL,
  `acquisition_journal_line_id` CHAR(36) NOT NULL,
  `event_campaign_id` CHAR(36) NULL,
  `status` VARCHAR(12) NOT NULL DEFAULT 'ACTIVE',
  `disposal_journal_id` CHAR(36) NULL,
  `disposed_on` DATE NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`fixed_asset_id`),
  UNIQUE KEY `uk_acc_fixed_asset_number` (`asset_number`),
  UNIQUE KEY `uk_acc_fixed_asset_source` (`acquisition_journal_line_id`),
  UNIQUE KEY `uk_acc_fixed_asset_disposal` (`disposal_journal_id`),
  KEY `idx_acc_fixed_asset_cat` (`asset_category_id`),
  KEY `idx_acc_fixed_asset_campaign` (`event_campaign_id`),
  KEY `idx_acc_fixed_asset_status` (`status`,`in_service_on`),
  CONSTRAINT `fk_acc_fixed_asset_cat` FOREIGN KEY (`asset_category_id`) REFERENCES `arya_accounting_asset_category` (`asset_category_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_acc_fixed_asset_source` FOREIGN KEY (`acquisition_journal_line_id`) REFERENCES `arya_accounting_journal_line` (`accounting_journal_line_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_acc_fixed_asset_campaign` FOREIGN KEY (`event_campaign_id`) REFERENCES `arya_event_campaign` (`event_campaign_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_acc_fixed_asset_disposal` FOREIGN KEY (`disposal_journal_id`) REFERENCES `arya_accounting_journal` (`accounting_journal_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ck_acc_fixed_asset_cost` CHECK (`acquisition_cost` > 0 AND `residual_value` >= 0 AND `residual_value` <= `acquisition_cost`),
  CONSTRAINT `ck_acc_fixed_asset_dates` CHECK (`acquired_on` <= `in_service_on`),
  CONSTRAINT `ck_acc_fixed_asset_life` CHECK (`useful_life_months` > 0),
  CONSTRAINT `ck_acc_fixed_asset_method` CHECK (`depreciation_method` IN ('STRAIGHT_LINE','DECLINING_BALANCE')),
  CONSTRAINT `ck_acc_fixed_asset_status` CHECK (`status` IN ('ACTIVE','DISPOSED','WRITTEN_OFF')),
  CONSTRAINT `ck_acc_fixed_asset_disposal` CHECK
    (`status` = 'ACTIVE' OR (`disposed_on` IS NOT NULL AND `disposal_journal_id` IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `arya_accounting_depreciation_run` (
  `depreciation_run_id` CHAR(36) NOT NULL,
  `accounting_period_id` CHAR(36) NOT NULL,
  `run_reference` VARCHAR(100) NOT NULL,
  `run_date` DATE NOT NULL,
  `status` VARCHAR(12) NOT NULL DEFAULT 'DRAFT',
  `posting_journal_id` CHAR(36) NULL,
  `created_by` CHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`depreciation_run_id`),
  UNIQUE KEY `uk_acc_dep_run_ref` (`run_reference`),
  UNIQUE KEY `uk_acc_dep_run_journal` (`posting_journal_id`),
  KEY `idx_acc_dep_run_period` (`accounting_period_id`),
  KEY `idx_acc_dep_run_actor` (`created_by`),
  CONSTRAINT `fk_acc_dep_run_period` FOREIGN KEY (`accounting_period_id`) REFERENCES `arya_accounting_period` (`accounting_period_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_acc_dep_run_journal` FOREIGN KEY (`posting_journal_id`) REFERENCES `arya_accounting_journal` (`accounting_journal_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_acc_dep_run_actor` FOREIGN KEY (`created_by`) REFERENCES `arya_user` (`user_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ck_acc_dep_run_status` CHECK (`status` IN ('DRAFT','POSTED','VOID')),
  CONSTRAINT `ck_acc_dep_run_posted` CHECK (`status` <> 'POSTED' OR `posting_journal_id` IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `arya_accounting_depreciation_run_asset` (
  `depreciation_run_asset_id` CHAR(36) NOT NULL,
  `depreciation_run_id` CHAR(36) NOT NULL,
  `fixed_asset_id` CHAR(36) NOT NULL,
  `planned_amount` DECIMAL(20,2) NOT NULL,
  `expense_journal_line_id` CHAR(36) NULL,
  `accumulated_journal_line_id` CHAR(36) NULL,
  PRIMARY KEY (`depreciation_run_asset_id`),
  UNIQUE KEY `uk_acc_dep_run_asset` (`depreciation_run_id`,`fixed_asset_id`),
  UNIQUE KEY `uk_acc_dep_run_exp_line` (`expense_journal_line_id`),
  UNIQUE KEY `uk_acc_dep_run_accum_line` (`accumulated_journal_line_id`),
  KEY `idx_acc_dep_run_asset_asset` (`fixed_asset_id`),
  CONSTRAINT `fk_acc_dep_run_asset_run` FOREIGN KEY (`depreciation_run_id`) REFERENCES `arya_accounting_depreciation_run` (`depreciation_run_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_acc_dep_run_asset_asset` FOREIGN KEY (`fixed_asset_id`) REFERENCES `arya_accounting_fixed_asset` (`fixed_asset_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_acc_dep_run_asset_exp` FOREIGN KEY (`expense_journal_line_id`) REFERENCES `arya_accounting_journal_line` (`accounting_journal_line_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_acc_dep_run_asset_accum` FOREIGN KEY (`accumulated_journal_line_id`) REFERENCES `arya_accounting_journal_line` (`accounting_journal_line_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ck_acc_dep_run_asset_amount` CHECK (`planned_amount` > 0),
  CONSTRAINT `ck_acc_dep_run_asset_lines` CHECK
    ((`expense_journal_line_id` IS NULL AND `accumulated_journal_line_id` IS NULL) OR
     (`expense_journal_line_id` IS NOT NULL AND `accumulated_journal_line_id` IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 08. Restriction release is evidenced by a posted journal, not a cached balance.
CREATE TABLE `arya_accounting_fund_release` (
  `fund_release_id` CHAR(36) NOT NULL,
  `fund_restriction_id` CHAR(36) NOT NULL,
  `release_reference` VARCHAR(100) NOT NULL,
  `release_date` DATE NOT NULL,
  `release_reason` VARCHAR(500) NOT NULL,
  `release_journal_id` CHAR(36) NOT NULL,
  `created_by` CHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`fund_release_id`),
  UNIQUE KEY `uk_acc_fund_release_ref` (`release_reference`),
  UNIQUE KEY `uk_acc_fund_release_journal` (`release_journal_id`),
  KEY `idx_acc_fund_release_restriction` (`fund_restriction_id`),
  KEY `idx_acc_fund_release_actor` (`created_by`),
  CONSTRAINT `fk_acc_fund_release_restriction` FOREIGN KEY (`fund_restriction_id`) REFERENCES `arya_accounting_fund_restriction` (`fund_restriction_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_acc_fund_release_journal` FOREIGN KEY (`release_journal_id`) REFERENCES `arya_accounting_journal` (`accounting_journal_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_acc_fund_release_actor` FOREIGN KEY (`created_by`) REFERENCES `arya_user` (`user_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 09. Bank reconciliation stores review evidence and matches, not a second GL.
CREATE TABLE `arya_accounting_bank_reconciliation` (
  `bank_reconciliation_id` CHAR(36) NOT NULL,
  `bank_account_id` CHAR(36) NOT NULL,
  `accounting_period_id` CHAR(36) NOT NULL,
  `statement_upload_id` CHAR(36) NULL,
  `reconciliation_reference` VARCHAR(100) NOT NULL,
  `reconciliation_date` DATE NOT NULL,
  `statement_closing_balance` DECIMAL(20,2) NOT NULL,
  `status` VARCHAR(12) NOT NULL DEFAULT 'OPEN',
  `closed_at` DATETIME(3) NULL,
  `closed_by` CHAR(36) NULL,
  `created_by` CHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`bank_reconciliation_id`),
  UNIQUE KEY `uk_acc_bank_recon_ref` (`reconciliation_reference`),
  KEY `idx_acc_bank_recon_account_period` (`bank_account_id`,`accounting_period_id`),
  KEY `idx_acc_bank_recon_period` (`accounting_period_id`),
  KEY `idx_acc_bank_recon_upload` (`statement_upload_id`),
  KEY `idx_acc_bank_recon_closed_by` (`closed_by`),
  KEY `idx_acc_bank_recon_created_by` (`created_by`),
  CONSTRAINT `fk_acc_bank_recon_account` FOREIGN KEY (`bank_account_id`) REFERENCES `arya_bank_account` (`bank_account_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_acc_bank_recon_period` FOREIGN KEY (`accounting_period_id`) REFERENCES `arya_accounting_period` (`accounting_period_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_acc_bank_recon_upload` FOREIGN KEY (`statement_upload_id`) REFERENCES `arya_bank_statement_upload` (`statement_upload_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_acc_bank_recon_closed` FOREIGN KEY (`closed_by`) REFERENCES `arya_user` (`user_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_acc_bank_recon_created` FOREIGN KEY (`created_by`) REFERENCES `arya_user` (`user_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ck_acc_bank_recon_status` CHECK (`status` IN ('OPEN','REVIEW','CLOSED')),
  CONSTRAINT `ck_acc_bank_recon_closed` CHECK (`status` <> 'CLOSED' OR `closed_at` IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `arya_accounting_bank_reconciliation_match` (
  `bank_reconciliation_match_id` CHAR(36) NOT NULL,
  `bank_reconciliation_id` CHAR(36) NOT NULL,
  `bank_transaction_id` CHAR(36) NOT NULL,
  `accounting_journal_line_id` CHAR(36) NOT NULL,
  `matched_amount` DECIMAL(20,2) NOT NULL,
  `match_status` VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',
  `matched_by` CHAR(36) NOT NULL,
  `matched_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `voided_at` DATETIME(3) NULL,
  `voided_by` CHAR(36) NULL,
  PRIMARY KEY (`bank_reconciliation_match_id`),
  UNIQUE KEY `uk_acc_bank_match_pair` (`bank_transaction_id`,`accounting_journal_line_id`),
  KEY `idx_acc_bank_match_recon` (`bank_reconciliation_id`),
  KEY `idx_acc_bank_match_line` (`accounting_journal_line_id`),
  KEY `idx_acc_bank_match_actor` (`matched_by`),
  KEY `idx_acc_bank_match_void_actor` (`voided_by`),
  CONSTRAINT `fk_acc_bank_match_recon` FOREIGN KEY (`bank_reconciliation_id`) REFERENCES `arya_accounting_bank_reconciliation` (`bank_reconciliation_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_acc_bank_match_bank` FOREIGN KEY (`bank_transaction_id`) REFERENCES `arya_bank_transaction` (`bank_transaction_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_acc_bank_match_line` FOREIGN KEY (`accounting_journal_line_id`) REFERENCES `arya_accounting_journal_line` (`accounting_journal_line_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_acc_bank_match_actor` FOREIGN KEY (`matched_by`) REFERENCES `arya_user` (`user_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_acc_bank_match_void_actor` FOREIGN KEY (`voided_by`) REFERENCES `arya_user` (`user_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ck_acc_bank_match_amount` CHECK (`matched_amount` > 0),
  CONSTRAINT `ck_acc_bank_match_status` CHECK (`match_status` IN ('ACTIVE','VOID')),
  CONSTRAINT `ck_acc_bank_match_void` CHECK (`match_status` <> 'VOID' OR (`voided_at` IS NOT NULL AND `voided_by` IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
