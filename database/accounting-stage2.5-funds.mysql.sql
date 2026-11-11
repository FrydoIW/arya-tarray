-- Stage 2.5 proposal. Execute only through its explicitly approved operational record.
-- Exact local DEV and isolated TEST; no prior patch replay or startup provisioning.
-- Precondition: fund/restriction/designation/release, journal-draft and approval tables empty.
ALTER TABLE `arya_accounting_fund`
  ADD COLUMN `description` VARCHAR(1000) NULL,
  ADD COLUMN `effective_on` DATE NOT NULL,
  ADD COLUMN `expires_on` DATE NULL,
  ADD COLUMN `source_reference` VARCHAR(255) NOT NULL,
  ADD COLUMN `policy` JSON NULL,
  ADD COLUMN `revision` INT UNSIGNED NOT NULL DEFAULT 1,
  ADD COLUMN `created_by` CHAR(36) NOT NULL,
  ADD COLUMN `updated_by` CHAR(36) NOT NULL,
  ADD KEY `idx_acc_fund_creator` (`created_by`),
  ADD KEY `idx_acc_fund_updater` (`updated_by`),
  ADD CONSTRAINT `fk_acc_fund_creator` FOREIGN KEY (`created_by`) REFERENCES `arya_user` (`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `fk_acc_fund_updater` FOREIGN KEY (`updated_by`) REFERENCES `arya_user` (`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ALTER COLUMN `status` SET DEFAULT 'DRAFT',
  DROP CHECK `ck_acc_fund_class`, DROP CHECK `ck_acc_fund_status`,
  ADD CONSTRAINT `ck_acc_fund_class` CHECK (`fund_class` IN ('UNRESTRICTED','DONOR_RESTRICTED','CONDITIONAL_LIABILITY','CONDITIONAL_REVIEW')),
  ADD CONSTRAINT `ck_acc_fund_status` CHECK (`status` IN ('DRAFT','ACTIVE','CLOSED')),
  ADD CONSTRAINT `ck_acc_fund_dates` CHECK (`expires_on` IS NULL OR `expires_on`>=`effective_on`),
  ADD CONSTRAINT `ck_acc_fund_revision` CHECK (`revision`>0),
  ADD CONSTRAINT `ck_acc_fund_policy` CHECK (`policy` IS NULL OR JSON_TYPE(`policy`)='OBJECT');

ALTER TABLE `arya_accounting_fund_restriction`
  ADD COLUMN `source_journal_line_id` CHAR(36) NOT NULL,
  ADD COLUMN `original_amount` DECIMAL(20,2) NOT NULL,
  ADD COLUMN `terms_evidence` VARCHAR(1000) NOT NULL,
  ADD COLUMN `criteria` JSON NOT NULL,
  ADD COLUMN `event_campaign_id` CHAR(36) NULL,
  ADD COLUMN `classification_journal_id` CHAR(36) NULL,
  ADD COLUMN `revision` INT UNSIGNED NOT NULL DEFAULT 1,
  ADD COLUMN `created_by` CHAR(36) NOT NULL,
  ADD COLUMN `updated_by` CHAR(36) NOT NULL,
  ADD KEY `idx_acc_restriction_source_line` (`source_journal_line_id`),
  ADD KEY `idx_acc_restriction_campaign` (`event_campaign_id`),
  ADD KEY `idx_acc_restriction_creator` (`created_by`),
  ADD KEY `idx_acc_restriction_updater` (`updated_by`),
  ADD UNIQUE KEY `uk_acc_restriction_classification` (`classification_journal_id`),
  ADD CONSTRAINT `fk_acc_restriction_source_line` FOREIGN KEY (`source_journal_line_id`) REFERENCES `arya_accounting_journal_line` (`accounting_journal_line_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `fk_acc_restriction_campaign` FOREIGN KEY (`event_campaign_id`) REFERENCES `arya_event_campaign` (`event_campaign_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `fk_acc_restriction_classification` FOREIGN KEY (`classification_journal_id`) REFERENCES `arya_accounting_journal` (`accounting_journal_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `fk_acc_restriction_creator` FOREIGN KEY (`created_by`) REFERENCES `arya_user` (`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `fk_acc_restriction_updater` FOREIGN KEY (`updated_by`) REFERENCES `arya_user` (`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ALTER COLUMN `status` SET DEFAULT 'DRAFT', DROP CHECK `ck_acc_restriction_status`,
  ADD CONSTRAINT `ck_acc_restriction_status` CHECK (`status` IN ('DRAFT','ACTIVE','SATISFIED','CANCELLED')),
  ADD CONSTRAINT `ck_acc_restriction_amount` CHECK (`original_amount`>0),
  ADD CONSTRAINT `ck_acc_restriction_revision` CHECK (`revision`>0),
  ADD CONSTRAINT `ck_acc_restriction_criteria` CHECK (JSON_TYPE(`criteria`)='OBJECT' AND CHAR_LENGTH(TRIM(`terms_evidence`))>0),
  ADD CONSTRAINT `ck_acc_restriction_classification` CHECK (`status` NOT IN ('ACTIVE','SATISFIED') OR `classification_journal_id` IS NOT NULL);

ALTER TABLE `arya_accounting_fund_designation`
  ADD COLUMN `amount` DECIMAL(20,2) NOT NULL,
  ADD COLUMN `effective_on` DATE NOT NULL,
  ADD COLUMN `revision` INT UNSIGNED NOT NULL DEFAULT 1,
  ADD COLUMN `created_by` CHAR(36) NOT NULL,
  ADD COLUMN `updated_by` CHAR(36) NOT NULL,
  MODIFY COLUMN `approved_at` DATETIME(3) NULL,
  MODIFY COLUMN `approved_by` CHAR(36) NULL,
  ADD KEY `idx_acc_designation_creator` (`created_by`),
  ADD KEY `idx_acc_designation_updater` (`updated_by`),
  ADD CONSTRAINT `fk_acc_designation_creator` FOREIGN KEY (`created_by`) REFERENCES `arya_user` (`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `fk_acc_designation_updater` FOREIGN KEY (`updated_by`) REFERENCES `arya_user` (`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ALTER COLUMN `status` SET DEFAULT 'DRAFT', DROP CHECK `ck_acc_designation_status`,
  ADD CONSTRAINT `ck_acc_designation_status` CHECK (`status` IN ('DRAFT','ACTIVE','RELEASED','CANCELLED')),
  ADD CONSTRAINT `ck_acc_designation_amount` CHECK (`amount`>0 AND `revision`>0),
  ADD CONSTRAINT `ck_acc_designation_approval` CHECK ((`approved_at` IS NULL)=(`approved_by` IS NULL) AND
    (`status` NOT IN ('ACTIVE','RELEASED') OR `approved_by` IS NOT NULL));

ALTER TABLE `arya_accounting_fund_release`
  ADD COLUMN `amount` DECIMAL(20,2) NOT NULL,
  ADD COLUMN `satisfaction_date` DATE NOT NULL,
  ADD COLUMN `eligibility_evidence` VARCHAR(1000) NOT NULL,
  ADD COLUMN `evidence_reference` VARCHAR(255) NOT NULL,
  ADD COLUMN `evidence_key` VARCHAR(100) NOT NULL,
  ADD COLUMN `active_evidence_key` VARCHAR(100) NULL,
  ADD COLUMN `evidence_journal_line_id` CHAR(36) NULL,
  ADD COLUMN `target_fund_id` CHAR(36) NOT NULL,
  ADD KEY `idx_acc_release_evidence` (`evidence_journal_line_id`),
  ADD KEY `idx_acc_release_target` (`target_fund_id`),
  ADD UNIQUE KEY `uk_acc_release_active_evidence` (`fund_restriction_id`,`active_evidence_key`),
  ADD CONSTRAINT `fk_acc_release_evidence` FOREIGN KEY (`evidence_journal_line_id`) REFERENCES `arya_accounting_journal_line` (`accounting_journal_line_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `fk_acc_release_target` FOREIGN KEY (`target_fund_id`) REFERENCES `arya_accounting_fund` (`accounting_fund_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `ck_acc_release_amount` CHECK (`amount`>0),
  ADD CONSTRAINT `ck_acc_release_date` CHECK (`satisfaction_date`<=`release_date`),
  ADD CONSTRAINT `ck_acc_release_active_key` CHECK (`active_evidence_key` IS NULL OR `active_evidence_key`=`evidence_key`),
  ADD CONSTRAINT `ck_acc_release_evidence` CHECK (CHAR_LENGTH(TRIM(`eligibility_evidence`))>0 AND CHAR_LENGTH(TRIM(`evidence_reference`))>0);

ALTER TABLE `arya_accounting_journal_draft`
  ADD COLUMN `accounting_fund_id` CHAR(36) NULL,
  ADD COLUMN `fund_restriction_id` CHAR(36) NULL,
  ADD COLUMN `fund_designation_id` CHAR(36) NULL,
  ADD COLUMN `fund_source_line_id` CHAR(36) NULL,
  ADD COLUMN `fund_bank_transaction_id` CHAR(36) NULL,
  ADD COLUMN `fund_active_bank_id` CHAR(36) NULL,
  ADD COLUMN `fund_parent_id` CHAR(36) NULL,
  ADD COLUMN `fund_metadata` JSON NULL,
  ADD KEY `idx_acc_draft_fund` (`accounting_fund_id`),
  ADD KEY `idx_acc_draft_fund_restriction` (`fund_restriction_id`),
  ADD KEY `idx_acc_draft_fund_designation` (`fund_designation_id`),
  ADD KEY `idx_acc_draft_fund_source` (`fund_source_line_id`),
  ADD KEY `idx_acc_draft_fund_bank` (`fund_bank_transaction_id`),
  ADD KEY `idx_acc_draft_fund_parent` (`fund_parent_id`),
  ADD UNIQUE KEY `uk_acc_draft_fund_active_bank` (`fund_active_bank_id`),
  ADD CONSTRAINT `fk_acc_draft_fund` FOREIGN KEY (`accounting_fund_id`) REFERENCES `arya_accounting_fund` (`accounting_fund_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `fk_acc_draft_fund_restriction` FOREIGN KEY (`fund_restriction_id`) REFERENCES `arya_accounting_fund_restriction` (`fund_restriction_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `fk_acc_draft_fund_designation` FOREIGN KEY (`fund_designation_id`) REFERENCES `arya_accounting_fund_designation` (`fund_designation_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `fk_acc_draft_fund_source` FOREIGN KEY (`fund_source_line_id`) REFERENCES `arya_accounting_journal_line` (`accounting_journal_line_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `fk_acc_draft_fund_bank` FOREIGN KEY (`fund_bank_transaction_id`) REFERENCES `arya_bank_transaction` (`bank_transaction_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `fk_acc_draft_fund_active_bank` FOREIGN KEY (`fund_active_bank_id`) REFERENCES `arya_bank_transaction` (`bank_transaction_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `fk_acc_draft_fund_parent` FOREIGN KEY (`fund_parent_id`) REFERENCES `arya_accounting_journal_draft` (`journal_draft_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `ck_acc_draft_fund_metadata` CHECK (`source_kind` NOT IN ('FUND_COMMAND','FUND_JOURNAL') OR
    (`accounting_fund_id` IS NOT NULL AND `fund_metadata` IS NOT NULL AND JSON_TYPE(`fund_metadata`)='OBJECT')),
  ADD CONSTRAINT `ck_acc_draft_fund_bank` CHECK (`fund_active_bank_id` IS NULL OR `fund_active_bank_id`=`fund_bank_transaction_id`),
  ADD CONSTRAINT `ck_acc_draft_fund_parent` CHECK (`fund_parent_id` IS NULL OR (`fund_parent_id`<>`journal_draft_id` AND `source_kind`='FUND_COMMAND'));

ALTER TABLE `arya_accounting_approval_request`
  ADD COLUMN `accounting_fund_id` CHAR(36) NULL,
  ADD COLUMN `fund_designation_id` CHAR(36) NULL,
  ADD COLUMN `release_evidence_line_id` CHAR(36) NULL,
  ADD KEY `idx_acc_approval_fund` (`accounting_fund_id`),
  ADD KEY `idx_acc_approval_designation` (`fund_designation_id`),
  ADD KEY `idx_acc_approval_release_evidence` (`release_evidence_line_id`),
  ADD CONSTRAINT `fk_acc_approval_fund` FOREIGN KEY (`accounting_fund_id`) REFERENCES `arya_accounting_fund` (`accounting_fund_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `fk_acc_approval_designation` FOREIGN KEY (`fund_designation_id`) REFERENCES `arya_accounting_fund_designation` (`fund_designation_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `fk_acc_approval_release_evidence` FOREIGN KEY (`release_evidence_line_id`) REFERENCES `arya_accounting_journal_line` (`accounting_journal_line_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  DROP CHECK `ck_acc_approval_one_source`, DROP CHECK `ck_acc_approval_source_id`, DROP CHECK `ck_acc_approval_kind_source`, DROP CHECK `ck_acc_approval_applied_ref`,
  ADD CONSTRAINT `ck_acc_approval_one_source` CHECK (
    (`journal_draft_id` IS NOT NULL)+(`accounting_document_id` IS NOT NULL)+(`accounting_settlement_id` IS NOT NULL)+(`accounting_period_id` IS NOT NULL)+
    (`original_journal_id` IS NOT NULL)+(`fund_restriction_id` IS NOT NULL)+(`accounting_schedule_id` IS NOT NULL)+(`accounting_schedule_period_id` IS NOT NULL)+
    (`fixed_asset_id` IS NOT NULL)+(`depreciation_run_id` IS NOT NULL)+(`accounting_fund_id` IS NOT NULL)+(`fund_designation_id` IS NOT NULL)=1),
  ADD CONSTRAINT `ck_acc_approval_source_id` CHECK (`source_document_id`=COALESCE(`journal_draft_id`,`accounting_document_id`,`accounting_settlement_id`,`accounting_period_id`,
    `original_journal_id`,`fund_restriction_id`,`accounting_schedule_id`,`accounting_schedule_period_id`,`fixed_asset_id`,`depreciation_run_id`,`accounting_fund_id`,`fund_designation_id`)),
  ADD CONSTRAINT `ck_acc_approval_kind_source` CHECK (
    (`request_kind` IN ('MANUAL_JOURNAL','ADJUSTING_JOURNAL','ACCRUAL_DOCUMENT','ACCRUAL_ADJUSTMENT','ASSET_CHANGE','ASSET_JOURNAL','FUND_COMMAND','FUND_JOURNAL') AND `journal_draft_id` IS NOT NULL) OR
    (`request_kind` IN ('AP_INVOICE','AR_DOCUMENT','AR_ADJUSTMENT') AND `accounting_document_id` IS NOT NULL) OR
    (`request_kind`='SETTLEMENT' AND `accounting_settlement_id` IS NOT NULL) OR
    (`request_kind` IN ('PERIOD_CLOSE','PERIOD_REOPEN') AND `accounting_period_id` IS NOT NULL) OR
    (`request_kind`='JOURNAL_REVERSAL' AND `original_journal_id` IS NOT NULL) OR
    (`request_kind` IN ('FUND_RELEASE','FUND_RESTRICTION') AND `fund_restriction_id` IS NOT NULL) OR
    (`request_kind`='FUND_SETUP' AND `accounting_fund_id` IS NOT NULL) OR
    (`request_kind`='FUND_DESIGNATION' AND `fund_designation_id` IS NOT NULL) OR
    (`request_kind` IN ('SCHEDULE_SETUP','SCHEDULE_CHANGE','SCHEDULE_CANCEL','SCHEDULE_TERMINATE') AND `accounting_schedule_id` IS NOT NULL) OR
    (`request_kind`='SCHEDULE_PERIOD' AND `accounting_schedule_period_id` IS NOT NULL) OR
    (`request_kind`='ASSET_ACTIVATE' AND `fixed_asset_id` IS NOT NULL) OR
    (`request_kind`='DEPRECIATION_RUN' AND `depreciation_run_id` IS NOT NULL)),
  ADD CONSTRAINT `ck_acc_approval_applied_ref` CHECK (`status`<>'APPLIED' OR
    `request_kind` IN ('PERIOD_CLOSE','PERIOD_REOPEN','SCHEDULE_SETUP','SCHEDULE_CHANGE','SCHEDULE_CANCEL','ASSET_ACTIVATE','ASSET_CHANGE','FUND_SETUP','FUND_DESIGNATION','FUND_COMMAND') OR `applied_journal_id` IS NOT NULL),
  ADD CONSTRAINT `ck_acc_approval_release_evidence` CHECK (`release_evidence_line_id` IS NULL OR `request_kind`='FUND_RELEASE');
