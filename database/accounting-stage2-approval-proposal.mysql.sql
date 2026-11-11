-- STAGE 2.1 PROPOSAL ONLY. NOT APPROVED AND NOT APPLIED.
-- Apply only under an approved, access-controlled operational change record.
-- Never run from application startup, tests, or Prisma tooling.
-- Target verification, backup, affected-row counts, and statement-by-statement
-- recovery planning are mandatory because MySQL DDL implicitly commits.
USE `arya_tarray_dev`;

-- Existing reconciliation approval remains statement-specific. This separate
-- Accounting request records approval for posted financial actions. A request
-- points to exactly one typed source. Its SHA-256 digest covers the material
-- source version; the service recomputes that digest before decision and apply.

CREATE TABLE `arya_accounting_journal_draft` (
  `journal_draft_id` CHAR(36) NOT NULL,
  `draft_number` VARCHAR(60) NOT NULL,
  `journal_type` VARCHAR(20) NOT NULL,
  `source_kind` VARCHAR(30) NOT NULL,
  `source_reference` VARCHAR(110) NOT NULL,
  `accounting_date` DATE NOT NULL,
  `description` TEXT NULL,
  `revision` INT UNSIGNED NOT NULL DEFAULT 1,
  `status` VARCHAR(12) NOT NULL DEFAULT 'DRAFT',
  `created_by` CHAR(36) NOT NULL,
  `posted_journal_id` CHAR(36) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`journal_draft_id`),
  UNIQUE KEY `uk_acc_draft_number` (`draft_number`),
  UNIQUE KEY `uk_acc_draft_source` (`source_kind`,`source_reference`),
  UNIQUE KEY `uk_acc_draft_posted` (`posted_journal_id`),
  KEY `idx_acc_draft_creator` (`created_by`),
  KEY `idx_acc_draft_date` (`accounting_date`,`status`),
  CONSTRAINT `fk_acc_draft_creator` FOREIGN KEY (`created_by`) REFERENCES `arya_user` (`user_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_acc_draft_posted` FOREIGN KEY (`posted_journal_id`) REFERENCES `arya_accounting_journal` (`accounting_journal_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ck_acc_draft_revision` CHECK (`revision` > 0),
  CONSTRAINT `ck_acc_draft_type` CHECK (`journal_type` IN ('MANUAL','ADJUSTMENT')),
  CONSTRAINT `ck_acc_draft_status` CHECK (`status` IN ('DRAFT','POSTED','CANCELLED')),
  CONSTRAINT `ck_acc_draft_posted` CHECK ((`status` = 'POSTED') = (`posted_journal_id` IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `arya_accounting_journal_draft_line` (
  `journal_draft_line_id` CHAR(36) NOT NULL,
  `journal_draft_id` CHAR(36) NOT NULL,
  `line_no` INT UNSIGNED NOT NULL,
  `accounting_account_id` CHAR(36) NOT NULL,
  `debit` DECIMAL(20,2) NOT NULL DEFAULT 0,
  `credit` DECIMAL(20,2) NOT NULL DEFAULT 0,
  `bank_account_id` CHAR(36) NULL,
  `accounting_fund_id` CHAR(36) NULL,
  `fund_restriction_id` CHAR(36) NULL,
  `counterparty_id` CHAR(36) NULL,
  PRIMARY KEY (`journal_draft_line_id`),
  UNIQUE KEY `uk_acc_draft_line_no` (`journal_draft_id`,`line_no`),
  KEY `idx_acc_draft_line_account` (`accounting_account_id`),
  KEY `idx_acc_draft_line_bank` (`bank_account_id`),
  KEY `idx_acc_draft_line_fund` (`accounting_fund_id`),
  KEY `idx_acc_draft_line_restriction` (`fund_restriction_id`,`accounting_fund_id`),
  KEY `idx_acc_draft_line_cp` (`counterparty_id`),
  CONSTRAINT `fk_acc_draft_line_draft` FOREIGN KEY (`journal_draft_id`) REFERENCES `arya_accounting_journal_draft` (`journal_draft_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_acc_draft_line_account` FOREIGN KEY (`accounting_account_id`) REFERENCES `arya_accounting_account` (`accounting_account_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_acc_draft_line_bank` FOREIGN KEY (`bank_account_id`) REFERENCES `arya_bank_account` (`bank_account_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_acc_draft_line_fund` FOREIGN KEY (`accounting_fund_id`) REFERENCES `arya_accounting_fund` (`accounting_fund_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_acc_draft_line_restriction` FOREIGN KEY (`fund_restriction_id`,`accounting_fund_id`)
    REFERENCES `arya_accounting_fund_restriction` (`fund_restriction_id`,`accounting_fund_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_acc_draft_line_cp` FOREIGN KEY (`counterparty_id`) REFERENCES `arya_accounting_counterparty` (`counterparty_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ck_acc_draft_line_no` CHECK (`line_no` > 0),
  CONSTRAINT `ck_acc_draft_line_sides` CHECK
    ((`debit` > 0 AND `credit` = 0) OR (`credit` > 0 AND `debit` = 0)),
  CONSTRAINT `ck_acc_draft_line_restriction` CHECK
    (`fund_restriction_id` IS NULL OR `accounting_fund_id` IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `arya_accounting_approval_request` (
  `accounting_approval_request_id` CHAR(36) NOT NULL,
  `request_kind` VARCHAR(24) NOT NULL,
  `source_document_id` CHAR(36) NOT NULL,
  `source_version` INT UNSIGNED NOT NULL,
  `source_digest` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `request_payload` JSON NULL,
  `status` VARCHAR(12) NOT NULL DEFAULT 'PENDING',
  `requested_by` CHAR(36) NOT NULL,
  `requested_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `decided_by` CHAR(36) NULL,
  `decided_at` DATETIME(3) NULL,
  `decision_remark` VARCHAR(1000) NULL,
  `applied_by` CHAR(36) NULL,
  `applied_at` DATETIME(3) NULL,
  `applied_journal_id` CHAR(36) NULL,
  `journal_draft_id` CHAR(36) NULL,
  `accounting_document_id` CHAR(36) NULL,
  `accounting_settlement_id` CHAR(36) NULL,
  `accounting_period_id` CHAR(36) NULL,
  `original_journal_id` CHAR(36) NULL,
  `fund_restriction_id` CHAR(36) NULL,
  PRIMARY KEY (`accounting_approval_request_id`),
  UNIQUE KEY `uk_acc_approval_source_version` (`request_kind`,`source_document_id`,`source_version`),
  UNIQUE KEY `uk_acc_approval_applied_journal` (`applied_journal_id`),
  KEY `idx_acc_approval_queue` (`status`,`request_kind`,`requested_at`),
  KEY `idx_acc_approval_requester` (`requested_by`),
  KEY `idx_acc_approval_decider` (`decided_by`),
  KEY `idx_acc_approval_applier` (`applied_by`),
  KEY `idx_acc_approval_draft` (`journal_draft_id`),
  KEY `idx_acc_approval_document` (`accounting_document_id`),
  KEY `idx_acc_approval_settlement` (`accounting_settlement_id`),
  KEY `idx_acc_approval_period` (`accounting_period_id`),
  KEY `idx_acc_approval_original` (`original_journal_id`),
  KEY `idx_acc_approval_restriction` (`fund_restriction_id`),
  CONSTRAINT `fk_acc_approval_requester` FOREIGN KEY (`requested_by`) REFERENCES `arya_user` (`user_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_acc_approval_decider` FOREIGN KEY (`decided_by`) REFERENCES `arya_user` (`user_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_acc_approval_applier` FOREIGN KEY (`applied_by`) REFERENCES `arya_user` (`user_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_acc_approval_applied_journal` FOREIGN KEY (`applied_journal_id`) REFERENCES `arya_accounting_journal` (`accounting_journal_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_acc_approval_draft` FOREIGN KEY (`journal_draft_id`) REFERENCES `arya_accounting_journal_draft` (`journal_draft_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_acc_approval_document` FOREIGN KEY (`accounting_document_id`) REFERENCES `arya_accounting_document` (`accounting_document_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_acc_approval_settlement` FOREIGN KEY (`accounting_settlement_id`) REFERENCES `arya_accounting_settlement` (`accounting_settlement_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_acc_approval_period` FOREIGN KEY (`accounting_period_id`) REFERENCES `arya_accounting_period` (`accounting_period_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_acc_approval_original` FOREIGN KEY (`original_journal_id`) REFERENCES `arya_accounting_journal` (`accounting_journal_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_acc_approval_restriction` FOREIGN KEY (`fund_restriction_id`) REFERENCES `arya_accounting_fund_restriction` (`fund_restriction_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ck_acc_approval_version` CHECK (`source_version` > 0),
  CONSTRAINT `ck_acc_approval_status` CHECK (`status` IN
    ('PENDING','APPROVED','REJECTED','CANCELLED','SUPERSEDED','APPLIED')),
  CONSTRAINT `ck_acc_approval_one_source` CHECK (
    (`journal_draft_id` IS NOT NULL) + (`accounting_document_id` IS NOT NULL) +
    (`accounting_settlement_id` IS NOT NULL) + (`accounting_period_id` IS NOT NULL) +
    (`original_journal_id` IS NOT NULL) + (`fund_restriction_id` IS NOT NULL) = 1),
  CONSTRAINT `ck_acc_approval_source_id` CHECK (`source_document_id` = COALESCE(
    `journal_draft_id`,`accounting_document_id`,`accounting_settlement_id`,
    `accounting_period_id`,`original_journal_id`,`fund_restriction_id`)),
  CONSTRAINT `ck_acc_approval_kind_source` CHECK (
    (`request_kind` IN ('MANUAL_JOURNAL','ADJUSTING_JOURNAL') AND `journal_draft_id` IS NOT NULL) OR
    (`request_kind` IN ('AP_INVOICE','AR_ADJUSTMENT') AND `accounting_document_id` IS NOT NULL) OR
    (`request_kind` = 'SETTLEMENT' AND `accounting_settlement_id` IS NOT NULL) OR
    (`request_kind` IN ('PERIOD_CLOSE','PERIOD_REOPEN') AND `accounting_period_id` IS NOT NULL) OR
    (`request_kind` = 'JOURNAL_REVERSAL' AND `original_journal_id` IS NOT NULL) OR
    (`request_kind` = 'FUND_RELEASE' AND `fund_restriction_id` IS NOT NULL)),
  CONSTRAINT `ck_acc_approval_separation` CHECK (`decided_by` IS NULL OR `decided_by` <> `requested_by`),
  CONSTRAINT `ck_acc_approval_decision` CHECK (`status` NOT IN ('APPROVED','REJECTED','APPLIED') OR
    (`decided_by` IS NOT NULL AND `decided_at` IS NOT NULL)),
  CONSTRAINT `ck_acc_approval_decision_pair` CHECK ((`decided_by` IS NULL) = (`decided_at` IS NULL)),
  CONSTRAINT `ck_acc_approval_pending` CHECK (`status` <> 'PENDING' OR `decided_by` IS NULL),
  CONSTRAINT `ck_acc_approval_applied` CHECK (
    (`status` = 'APPLIED' AND `applied_by` IS NOT NULL AND `applied_at` IS NOT NULL) OR
    (`status` <> 'APPLIED' AND `applied_by` IS NULL AND `applied_at` IS NULL AND `applied_journal_id` IS NULL)),
  CONSTRAINT `ck_acc_approval_applied_ref` CHECK (`status` <> 'APPLIED' OR
    `request_kind` IN ('PERIOD_CLOSE','PERIOD_REOPEN') OR `applied_journal_id` IS NOT NULL),
  CONSTRAINT `ck_acc_approval_chronology` CHECK (
    (`decided_at` IS NULL OR `decided_at` >= `requested_at`) AND
    (`applied_at` IS NULL OR `applied_at` >= `decided_at`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Snapshot eligible approvers at submission. Role/menu permission and active
-- user are checked again at decision time; requester cannot decide their own.
CREATE TABLE `arya_accounting_approval_approver` (
  `accounting_approval_request_id` CHAR(36) NOT NULL,
  `approver_user_id` CHAR(36) NOT NULL,
  `assigned_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`accounting_approval_request_id`,`approver_user_id`),
  KEY `idx_acc_approval_approver_user` (`approver_user_id`),
  CONSTRAINT `fk_acc_approval_approver_request` FOREIGN KEY (`accounting_approval_request_id`)
    REFERENCES `arya_accounting_approval_request` (`accounting_approval_request_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_acc_approval_approver_user` FOREIGN KEY (`approver_user_id`) REFERENCES `arya_user` (`user_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Append-only at the application boundary; the operational DB role must deny
-- UPDATE/DELETE on this table if audit policy requires database-level locking.
CREATE TABLE `arya_accounting_approval_history` (
  `accounting_approval_history_id` CHAR(36) NOT NULL,
  `accounting_approval_request_id` CHAR(36) NOT NULL,
  `action` VARCHAR(12) NOT NULL,
  `status_before` VARCHAR(12) NULL,
  `status_after` VARCHAR(12) NOT NULL,
  `actor_id` CHAR(36) NOT NULL,
  `action_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `source_digest` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `remark` VARCHAR(1000) NULL,
  PRIMARY KEY (`accounting_approval_history_id`),
  KEY `idx_acc_approval_history` (`accounting_approval_request_id`,`action_at`),
  KEY `idx_acc_approval_history_actor` (`actor_id`),
  CONSTRAINT `fk_acc_approval_history_request` FOREIGN KEY (`accounting_approval_request_id`)
    REFERENCES `arya_accounting_approval_request` (`accounting_approval_request_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `fk_acc_approval_history_actor` FOREIGN KEY (`actor_id`) REFERENCES `arya_user` (`user_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ck_acc_approval_history_action` CHECK (`action` IN
    ('SUBMIT','APPROVE','REJECT','CANCEL','SUPERSEDE','APPLY')),
  CONSTRAINT `ck_acc_approval_history_transition` CHECK (
    (`action` = 'SUBMIT' AND `status_before` IS NULL AND `status_after` = 'PENDING') OR
    (`action` = 'APPROVE' AND `status_before` IS NOT NULL AND `status_before` = 'PENDING' AND `status_after` = 'APPROVED') OR
    (`action` = 'REJECT' AND `status_before` IS NOT NULL AND `status_before` = 'PENDING' AND `status_after` = 'REJECTED') OR
    (`action` = 'CANCEL' AND `status_before` IS NOT NULL AND `status_before` IN ('PENDING','APPROVED') AND `status_after` = 'CANCELLED') OR
    (`action` = 'SUPERSEDE' AND `status_before` IS NOT NULL AND `status_before` IN ('PENDING','APPROVED') AND `status_after` = 'SUPERSEDED') OR
    (`action` = 'APPLY' AND `status_before` IS NOT NULL AND `status_before` = 'APPROVED' AND `status_after` = 'APPLIED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
