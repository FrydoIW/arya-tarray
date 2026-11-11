-- Stage 2.2 AP/AR proposal. Execute only under the separately approved record.
-- Select exact DEV or isolated TEST in the administrator connection; no USE,
-- startup migration, Stage 1 replay, data deletion, or schema reset.
-- PRECONDITION: document, settlement, adjustment and approval-request tables
-- are empty in each target. If not, stop for a reviewed data-preserving plan.
ALTER TABLE `arya_accounting_document`
  ADD COLUMN `accounting_date` DATE NOT NULL AFTER `document_date`,
  ADD COLUMN `control_account_id` CHAR(36) NOT NULL AFTER `counterparty_id`,
  ADD COLUMN `recognition_basis` VARCHAR(1000) NOT NULL AFTER `source_reference`,
  ADD COLUMN `revision` INT UNSIGNED NOT NULL DEFAULT 1 AFTER `status`,
  ADD KEY `idx_acc_doc_control_date` (`control_account_id`,`accounting_date`),
  ADD CONSTRAINT `fk_acc_doc_control` FOREIGN KEY (`control_account_id`)
    REFERENCES `arya_accounting_account` (`accounting_account_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `ck_acc_doc_revision` CHECK (`revision` > 0),
  ADD CONSTRAINT `ck_acc_doc_basis` CHECK (CHAR_LENGTH(TRIM(`recognition_basis`)) > 0),
  ADD CONSTRAINT `ck_acc_doc_due_date` CHECK (`due_date` >= `document_date`);

ALTER TABLE `arya_accounting_settlement`
  ADD COLUMN `bank_account_id` CHAR(36) NOT NULL AFTER `counterparty_id`,
  ADD COLUMN `bank_gl_account_id` CHAR(36) NOT NULL AFTER `bank_account_id`,
  ADD COLUMN `source_reference` VARCHAR(255) NOT NULL AFTER `settlement_reference`,
  ADD COLUMN `revision` INT UNSIGNED NOT NULL DEFAULT 1 AFTER `status`,
  ADD KEY `idx_acc_settlement_bank_account` (`bank_account_id`),
  ADD KEY `idx_acc_settlement_bank_gl` (`bank_gl_account_id`),
  ADD CONSTRAINT `fk_acc_settlement_bank_account` FOREIGN KEY (`bank_account_id`)
    REFERENCES `arya_bank_account` (`bank_account_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `fk_acc_settlement_bank_gl` FOREIGN KEY (`bank_gl_account_id`)
    REFERENCES `arya_accounting_account` (`accounting_account_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `ck_acc_settlement_revision` CHECK (`revision` > 0),
  ADD CONSTRAINT `ck_acc_settlement_source` CHECK (CHAR_LENGTH(TRIM(`source_reference`)) > 0);

ALTER TABLE `arya_accounting_approval_request`
  DROP CHECK `ck_acc_approval_kind_source`,
  ADD CONSTRAINT `ck_acc_approval_kind_source` CHECK (
    (`request_kind` IN ('MANUAL_JOURNAL','ADJUSTING_JOURNAL') AND `journal_draft_id` IS NOT NULL) OR
    (`request_kind` IN ('AP_INVOICE','AR_DOCUMENT','AR_ADJUSTMENT') AND `accounting_document_id` IS NOT NULL) OR
    (`request_kind` = 'SETTLEMENT' AND `accounting_settlement_id` IS NOT NULL) OR
    (`request_kind` IN ('PERIOD_CLOSE','PERIOD_REOPEN') AND `accounting_period_id` IS NOT NULL) OR
    (`request_kind` = 'JOURNAL_REVERSAL' AND `original_journal_id` IS NOT NULL) OR
    (`request_kind` = 'FUND_RELEASE' AND `fund_restriction_id` IS NOT NULL));
