-- Stage 2.4 reviewed proposal. Execute only under a separately approved record.
-- Exact local DEV and isolated TEST. No startup provisioning or prior migration replay.
-- Preconditions: asset/category/run/run-line, journal-draft and approval tables empty.
ALTER TABLE `arya_accounting_asset_category`
  ADD COLUMN `gain_account_id` CHAR(36) NULL,
  ADD COLUMN `loss_account_id` CHAR(36) NULL,
  ADD COLUMN `impairment_expense_account_id` CHAR(36) NULL,
  ADD COLUMN `impairment_allowance_account_id` CHAR(36) NULL,
  ADD COLUMN `disposal_clearing_account_id` CHAR(36) NULL,
  ADD COLUMN `policy` JSON NULL,
  ADD COLUMN `revision` INT UNSIGNED NOT NULL DEFAULT 1,
  ADD KEY `idx_acc_asset_cat_gain` (`gain_account_id`),
  ADD KEY `idx_acc_asset_cat_loss` (`loss_account_id`),
  ADD KEY `idx_acc_asset_cat_imp_exp` (`impairment_expense_account_id`),
  ADD KEY `idx_acc_asset_cat_imp_allow` (`impairment_allowance_account_id`),
  ADD KEY `idx_acc_asset_cat_clearing` (`disposal_clearing_account_id`),
  ADD CONSTRAINT `fk_acc_asset_cat_gain` FOREIGN KEY (`gain_account_id`) REFERENCES `arya_accounting_account` (`accounting_account_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `fk_acc_asset_cat_loss` FOREIGN KEY (`loss_account_id`) REFERENCES `arya_accounting_account` (`accounting_account_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `fk_acc_asset_cat_imp_exp` FOREIGN KEY (`impairment_expense_account_id`) REFERENCES `arya_accounting_account` (`accounting_account_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `fk_acc_asset_cat_imp_allow` FOREIGN KEY (`impairment_allowance_account_id`) REFERENCES `arya_accounting_account` (`accounting_account_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `fk_acc_asset_cat_clearing` FOREIGN KEY (`disposal_clearing_account_id`) REFERENCES `arya_accounting_account` (`accounting_account_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `ck_acc_asset_cat_revision` CHECK (`revision`>0),
  ADD CONSTRAINT `ck_acc_asset_cat_policy` CHECK (`policy` IS NULL OR JSON_TYPE(`policy`)='OBJECT');

ALTER TABLE `arya_accounting_fixed_asset`
  ADD COLUMN `description` VARCHAR(1000) NULL,
  ADD COLUMN `location` VARCHAR(255) NULL,
  ADD COLUMN `custodian_id` CHAR(36) NULL,
  ADD COLUMN `vendor_id` CHAR(36) NULL,
  ADD COLUMN `source_document_id` CHAR(36) NULL,
  ADD COLUMN `created_by` CHAR(36) NOT NULL,
  ADD COLUMN `updated_by` CHAR(36) NOT NULL,
  ADD COLUMN `revision` INT UNSIGNED NOT NULL DEFAULT 1,
  ADD COLUMN `depreciation_start_on` DATE NOT NULL,
  ADD COLUMN `policy_snapshot` JSON NULL,
  ADD KEY `idx_acc_asset_custodian` (`custodian_id`),
  ADD KEY `idx_acc_asset_vendor` (`vendor_id`),
  ADD KEY `idx_acc_asset_document` (`source_document_id`),
  ADD KEY `idx_acc_asset_creator` (`created_by`),
  ADD KEY `idx_acc_asset_updater` (`updated_by`),
  ADD CONSTRAINT `fk_acc_asset_custodian` FOREIGN KEY (`custodian_id`) REFERENCES `arya_user` (`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `fk_acc_asset_vendor` FOREIGN KEY (`vendor_id`) REFERENCES `arya_accounting_counterparty` (`counterparty_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `fk_acc_asset_document` FOREIGN KEY (`source_document_id`) REFERENCES `arya_accounting_document` (`accounting_document_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `fk_acc_asset_creator` FOREIGN KEY (`created_by`) REFERENCES `arya_user` (`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `fk_acc_asset_updater` FOREIGN KEY (`updated_by`) REFERENCES `arya_user` (`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ALTER COLUMN `status` SET DEFAULT 'DRAFT',
  DROP CHECK `ck_acc_fixed_asset_status`,
  DROP CHECK `ck_acc_fixed_asset_disposal`,
  ADD CONSTRAINT `ck_acc_fixed_asset_status` CHECK (`status` IN ('DRAFT','ACTIVE','DISPOSED','WRITTEN_OFF','CANCELLED')),
  ADD CONSTRAINT `ck_acc_fixed_asset_disposal` CHECK (
    (`status` IN ('DISPOSED','WRITTEN_OFF') AND `disposed_on` IS NOT NULL AND `disposal_journal_id` IS NOT NULL) OR
    (`status` NOT IN ('DISPOSED','WRITTEN_OFF') AND `disposed_on` IS NULL AND `disposal_journal_id` IS NULL)),
  ADD CONSTRAINT `ck_acc_asset_revision` CHECK (`revision`>0),
  ADD CONSTRAINT `ck_acc_asset_policy` CHECK (`policy_snapshot` IS NULL OR JSON_TYPE(`policy_snapshot`)='OBJECT');

ALTER TABLE `arya_accounting_journal_draft`
  ADD COLUMN `fixed_asset_id` CHAR(36) NULL,
  ADD COLUMN `asset_metadata` JSON NULL,
  ADD COLUMN `asset_source_line_id` CHAR(36) NULL,
  ADD COLUMN `asset_cost_line_id` CHAR(36) NULL,
  ADD KEY `idx_acc_draft_asset` (`fixed_asset_id`),
  ADD UNIQUE KEY `uk_acc_draft_asset_source` (`asset_source_line_id`),
  ADD UNIQUE KEY `uk_acc_draft_asset_cost` (`asset_cost_line_id`),
  ADD CONSTRAINT `fk_acc_draft_asset` FOREIGN KEY (`fixed_asset_id`) REFERENCES `arya_accounting_fixed_asset` (`fixed_asset_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `fk_acc_draft_asset_source` FOREIGN KEY (`asset_source_line_id`) REFERENCES `arya_accounting_journal_line` (`accounting_journal_line_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `fk_acc_draft_asset_cost` FOREIGN KEY (`asset_cost_line_id`) REFERENCES `arya_accounting_journal_line` (`accounting_journal_line_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  DROP CHECK `ck_acc_draft_status`,
  ADD CONSTRAINT `ck_acc_draft_status` CHECK (`status` IN ('DRAFT','POSTED','CANCELLED','APPLIED')),
  ADD CONSTRAINT `ck_acc_draft_asset` CHECK (`source_kind` NOT IN ('ASSET_CHANGE','ASSET_JOURNAL') OR
    (`fixed_asset_id` IS NOT NULL AND `asset_metadata` IS NOT NULL AND JSON_TYPE(`asset_metadata`)='OBJECT'));

ALTER TABLE `arya_accounting_depreciation_run`
  ADD COLUMN `revision` INT UNSIGNED NOT NULL DEFAULT 1,
  ADD CONSTRAINT `ck_acc_dep_run_revision` CHECK (`revision`>0);

ALTER TABLE `arya_accounting_depreciation_run_asset`
  ADD COLUMN `accounting_period_id` CHAR(36) NOT NULL,
  ADD COLUMN `active_period_id` CHAR(36) NULL,
  ADD COLUMN `asset_snapshot` JSON NOT NULL,
  ADD KEY `idx_acc_dep_asset_period` (`accounting_period_id`),
  ADD KEY `idx_acc_dep_active_period` (`active_period_id`),
  ADD UNIQUE KEY `uk_acc_dep_asset_active_period` (`fixed_asset_id`,`active_period_id`),
  ADD CONSTRAINT `fk_acc_dep_asset_period` FOREIGN KEY (`accounting_period_id`) REFERENCES `arya_accounting_period` (`accounting_period_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `fk_acc_dep_active_period` FOREIGN KEY (`active_period_id`) REFERENCES `arya_accounting_period` (`accounting_period_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `ck_acc_dep_active_period` CHECK (`active_period_id` IS NULL OR `active_period_id`=`accounting_period_id`),
  ADD CONSTRAINT `ck_acc_dep_asset_snapshot` CHECK (JSON_TYPE(`asset_snapshot`)='OBJECT');

ALTER TABLE `arya_accounting_approval_request`
  ADD COLUMN `fixed_asset_id` CHAR(36) NULL,
  ADD COLUMN `depreciation_run_id` CHAR(36) NULL,
  ADD KEY `idx_acc_approval_asset` (`fixed_asset_id`),
  ADD KEY `idx_acc_approval_dep_run` (`depreciation_run_id`),
  ADD CONSTRAINT `fk_acc_approval_asset` FOREIGN KEY (`fixed_asset_id`) REFERENCES `arya_accounting_fixed_asset` (`fixed_asset_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `fk_acc_approval_dep_run` FOREIGN KEY (`depreciation_run_id`) REFERENCES `arya_accounting_depreciation_run` (`depreciation_run_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  DROP CHECK `ck_acc_approval_one_source`,
  DROP CHECK `ck_acc_approval_source_id`,
  DROP CHECK `ck_acc_approval_kind_source`,
  DROP CHECK `ck_acc_approval_applied_ref`,
  ADD CONSTRAINT `ck_acc_approval_one_source` CHECK (
    (`journal_draft_id` IS NOT NULL)+(`accounting_document_id` IS NOT NULL)+(`accounting_settlement_id` IS NOT NULL)+
    (`accounting_period_id` IS NOT NULL)+(`original_journal_id` IS NOT NULL)+(`fund_restriction_id` IS NOT NULL)+
    (`accounting_schedule_id` IS NOT NULL)+(`accounting_schedule_period_id` IS NOT NULL)+
    (`fixed_asset_id` IS NOT NULL)+(`depreciation_run_id` IS NOT NULL)=1),
  ADD CONSTRAINT `ck_acc_approval_source_id` CHECK (`source_document_id`=COALESCE(
    `journal_draft_id`,`accounting_document_id`,`accounting_settlement_id`,`accounting_period_id`,`original_journal_id`,
    `fund_restriction_id`,`accounting_schedule_id`,`accounting_schedule_period_id`,`fixed_asset_id`,`depreciation_run_id`)),
  ADD CONSTRAINT `ck_acc_approval_kind_source` CHECK (
    (`request_kind` IN ('MANUAL_JOURNAL','ADJUSTING_JOURNAL','ACCRUAL_DOCUMENT','ACCRUAL_ADJUSTMENT','ASSET_CHANGE','ASSET_JOURNAL') AND `journal_draft_id` IS NOT NULL) OR
    (`request_kind` IN ('AP_INVOICE','AR_DOCUMENT','AR_ADJUSTMENT') AND `accounting_document_id` IS NOT NULL) OR
    (`request_kind`='SETTLEMENT' AND `accounting_settlement_id` IS NOT NULL) OR
    (`request_kind` IN ('PERIOD_CLOSE','PERIOD_REOPEN') AND `accounting_period_id` IS NOT NULL) OR
    (`request_kind`='JOURNAL_REVERSAL' AND `original_journal_id` IS NOT NULL) OR
    (`request_kind`='FUND_RELEASE' AND `fund_restriction_id` IS NOT NULL) OR
    (`request_kind` IN ('SCHEDULE_SETUP','SCHEDULE_CHANGE','SCHEDULE_CANCEL','SCHEDULE_TERMINATE') AND `accounting_schedule_id` IS NOT NULL) OR
    (`request_kind`='SCHEDULE_PERIOD' AND `accounting_schedule_period_id` IS NOT NULL) OR
    (`request_kind`='ASSET_ACTIVATE' AND `fixed_asset_id` IS NOT NULL) OR
    (`request_kind`='DEPRECIATION_RUN' AND `depreciation_run_id` IS NOT NULL)),
  ADD CONSTRAINT `ck_acc_approval_applied_ref` CHECK (`status`<>'APPLIED' OR
    `request_kind` IN ('PERIOD_CLOSE','PERIOD_REOPEN','SCHEDULE_SETUP','SCHEDULE_CHANGE','SCHEDULE_CANCEL','ASSET_ACTIVATE','ASSET_CHANGE') OR `applied_journal_id` IS NOT NULL);
