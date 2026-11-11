-- Stage 2.6: execute only under its approved external operational change record.
-- Exact DEV and isolated TEST; never replay previous patches or provision at startup.
-- Bank reconciliation/match, journal draft and approval tables must be empty.
ALTER TABLE `arya_accounting_fiscal_year`
  ADD COLUMN `reporting_policy_draft_id` CHAR(36) NULL,
  ADD COLUMN `closing_draft_id` CHAR(36) NULL,
  ADD COLUMN `revision` INT UNSIGNED NOT NULL DEFAULT 1,
  ADD KEY `idx_acc_fy_policy_draft` (`reporting_policy_draft_id`),
  ADD KEY `idx_acc_fy_closing_draft` (`closing_draft_id`),
  ADD CONSTRAINT `fk_acc_fy_policy_draft` FOREIGN KEY (`reporting_policy_draft_id`) REFERENCES `arya_accounting_journal_draft` (`journal_draft_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `fk_acc_fy_closing_draft` FOREIGN KEY (`closing_draft_id`) REFERENCES `arya_accounting_journal_draft` (`journal_draft_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `ck_acc_fy_revision` CHECK (`revision`>0);

ALTER TABLE `arya_accounting_period`
  ADD COLUMN `closing_draft_id` CHAR(36) NULL,
  ADD COLUMN `revision` INT UNSIGNED NOT NULL DEFAULT 1,
  ADD KEY `idx_acc_period_closing_draft` (`closing_draft_id`),
  ADD CONSTRAINT `fk_acc_period_closing_draft` FOREIGN KEY (`closing_draft_id`) REFERENCES `arya_accounting_journal_draft` (`journal_draft_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `ck_acc_period_revision` CHECK (`revision`>0);

ALTER TABLE `arya_accounting_bank_reconciliation`
  ADD COLUMN `bank_gl_account_id` CHAR(36) NOT NULL,
  ADD COLUMN `statement_opening_balance` DECIMAL(20,2) NOT NULL,
  ADD COLUMN `evidence` JSON NOT NULL,
  ADD COLUMN `revision` INT UNSIGNED NOT NULL DEFAULT 1,
  ADD KEY `idx_acc_bank_recon_gl` (`bank_gl_account_id`),
  ADD CONSTRAINT `fk_acc_bank_recon_gl` FOREIGN KEY (`bank_gl_account_id`) REFERENCES `arya_accounting_account` (`accounting_account_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `ck_acc_bank_recon_evidence` CHECK (JSON_TYPE(`evidence`)='OBJECT' AND `revision`>0);

ALTER TABLE `arya_accounting_journal_draft`
  ADD COLUMN `finalization_metadata` JSON NULL,
  ADD COLUMN `fiscal_year_id` CHAR(36) NULL,
  ADD COLUMN `accounting_period_id` CHAR(36) NULL,
  ADD COLUMN `bank_reconciliation_id` CHAR(36) NULL,
  ADD KEY `idx_acc_draft_fiscal_year` (`fiscal_year_id`),
  ADD KEY `idx_acc_draft_period` (`accounting_period_id`),
  ADD KEY `idx_acc_draft_bank_recon` (`bank_reconciliation_id`),
  ADD CONSTRAINT `fk_acc_draft_fiscal_year` FOREIGN KEY (`fiscal_year_id`) REFERENCES `arya_accounting_fiscal_year` (`fiscal_year_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `fk_acc_draft_period` FOREIGN KEY (`accounting_period_id`) REFERENCES `arya_accounting_period` (`accounting_period_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `fk_acc_draft_bank_recon` FOREIGN KEY (`bank_reconciliation_id`) REFERENCES `arya_accounting_bank_reconciliation` (`bank_reconciliation_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `ck_acc_draft_finalization` CHECK (`source_kind` NOT IN ('REPORTING_POLICY','PERIOD_CLOSE','PERIOD_REOPEN','YEAR_CLOSE','YEAR_REOPEN','REPORT_SNAPSHOT','FINALIZATION_AUDIT') OR
    (`finalization_metadata` IS NOT NULL AND JSON_TYPE(`finalization_metadata`)='OBJECT'));

ALTER TABLE `arya_accounting_approval_request`
  ADD COLUMN `fiscal_year_id` CHAR(36) NULL,
  ADD COLUMN `bank_reconciliation_id` CHAR(36) NULL,
  ADD KEY `idx_acc_approval_fiscal_year` (`fiscal_year_id`),
  ADD KEY `idx_acc_approval_bank_recon` (`bank_reconciliation_id`),
  ADD CONSTRAINT `fk_acc_approval_fiscal_year` FOREIGN KEY (`fiscal_year_id`) REFERENCES `arya_accounting_fiscal_year` (`fiscal_year_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `fk_acc_approval_bank_recon` FOREIGN KEY (`bank_reconciliation_id`) REFERENCES `arya_accounting_bank_reconciliation` (`bank_reconciliation_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  DROP CHECK `ck_acc_approval_one_source`, DROP CHECK `ck_acc_approval_source_id`, DROP CHECK `ck_acc_approval_kind_source`, DROP CHECK `ck_acc_approval_applied_ref`,
  ADD CONSTRAINT `ck_acc_approval_one_source` CHECK (
    (`journal_draft_id` IS NOT NULL)+(`accounting_document_id` IS NOT NULL)+(`accounting_settlement_id` IS NOT NULL)+(`accounting_period_id` IS NOT NULL)+
    (`original_journal_id` IS NOT NULL)+(`fund_restriction_id` IS NOT NULL)+(`accounting_schedule_id` IS NOT NULL)+(`accounting_schedule_period_id` IS NOT NULL)+
    (`fixed_asset_id` IS NOT NULL)+(`depreciation_run_id` IS NOT NULL)+(`accounting_fund_id` IS NOT NULL)+(`fund_designation_id` IS NOT NULL)+(`fiscal_year_id` IS NOT NULL)+(`bank_reconciliation_id` IS NOT NULL)=1),
  ADD CONSTRAINT `ck_acc_approval_source_id` CHECK (`source_document_id`=COALESCE(`journal_draft_id`,`accounting_document_id`,`accounting_settlement_id`,`accounting_period_id`,
    `original_journal_id`,`fund_restriction_id`,`accounting_schedule_id`,`accounting_schedule_period_id`,`fixed_asset_id`,`depreciation_run_id`,`accounting_fund_id`,`fund_designation_id`,`fiscal_year_id`,`bank_reconciliation_id`)),
  ADD CONSTRAINT `ck_acc_approval_kind_source` CHECK (
    (`request_kind` IN ('MANUAL_JOURNAL','ADJUSTING_JOURNAL','ACCRUAL_DOCUMENT','ACCRUAL_ADJUSTMENT','ASSET_CHANGE','ASSET_JOURNAL','FUND_COMMAND','FUND_JOURNAL','REPORTING_POLICY','REPORT_SNAPSHOT') AND `journal_draft_id` IS NOT NULL) OR
    (`request_kind` IN ('AP_INVOICE','AR_DOCUMENT','AR_ADJUSTMENT') AND `accounting_document_id` IS NOT NULL) OR
    (`request_kind`='SETTLEMENT' AND `accounting_settlement_id` IS NOT NULL) OR
    (`request_kind` IN ('PERIOD_CLOSE','PERIOD_REOPEN') AND `accounting_period_id` IS NOT NULL) OR
    (`request_kind` IN ('YEAR_CLOSE','YEAR_REOPEN') AND `fiscal_year_id` IS NOT NULL) OR
    (`request_kind`='BANK_RECONCILIATION' AND `bank_reconciliation_id` IS NOT NULL) OR
    (`request_kind`='JOURNAL_REVERSAL' AND `original_journal_id` IS NOT NULL) OR
    (`request_kind` IN ('FUND_RELEASE','FUND_RESTRICTION') AND `fund_restriction_id` IS NOT NULL) OR
    (`request_kind`='FUND_SETUP' AND `accounting_fund_id` IS NOT NULL) OR
    (`request_kind`='FUND_DESIGNATION' AND `fund_designation_id` IS NOT NULL) OR
    (`request_kind` IN ('SCHEDULE_SETUP','SCHEDULE_CHANGE','SCHEDULE_CANCEL','SCHEDULE_TERMINATE') AND `accounting_schedule_id` IS NOT NULL) OR
    (`request_kind`='SCHEDULE_PERIOD' AND `accounting_schedule_period_id` IS NOT NULL) OR
    (`request_kind`='ASSET_ACTIVATE' AND `fixed_asset_id` IS NOT NULL) OR
    (`request_kind`='DEPRECIATION_RUN' AND `depreciation_run_id` IS NOT NULL)),
  ADD CONSTRAINT `ck_acc_approval_applied_ref` CHECK (`status`<>'APPLIED' OR `request_kind` IN
    ('PERIOD_CLOSE','PERIOD_REOPEN','YEAR_CLOSE','YEAR_REOPEN','BANK_RECONCILIATION','REPORTING_POLICY','REPORT_SNAPSHOT','SCHEDULE_SETUP','SCHEDULE_CHANGE','SCHEDULE_CANCEL','ASSET_ACTIVATE','ASSET_CHANGE','FUND_SETUP','FUND_DESIGNATION','FUND_COMMAND') OR `applied_journal_id` IS NOT NULL);
