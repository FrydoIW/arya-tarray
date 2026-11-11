-- Stage 2.3 proposal: apply only through its separately approved operational record.
-- Exact local DEV and isolated TEST only. No USE, startup provisioning or old patch replay.
-- Preconditions: journal drafts, schedules/periods, AP/AR documents and approval requests are empty.
-- Stop for a preserving migration plan if that precondition no longer holds.
ALTER TABLE `arya_accounting_journal_draft`
  ADD COLUMN `accrual_metadata` JSON NULL,
  ADD COLUMN `parent_accrual_draft_id` CHAR(36) NULL,
  ADD KEY `idx_acc_draft_accrual_parent` (`parent_accrual_draft_id`),
  ADD CONSTRAINT `fk_acc_draft_accrual_parent` FOREIGN KEY (`parent_accrual_draft_id`)
    REFERENCES `arya_accounting_journal_draft` (`journal_draft_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  DROP CHECK `ck_acc_draft_type`,
  ADD CONSTRAINT `ck_acc_draft_type` CHECK (`journal_type` IN ('MANUAL','ADJUSTMENT','ACCRUAL')),
  ADD CONSTRAINT `ck_acc_draft_accrual_metadata` CHECK
    (`source_kind` NOT IN ('ACCRUAL_DOCUMENT','ACCRUAL_ADJUSTMENT') OR
      (`accrual_metadata` IS NOT NULL AND JSON_TYPE(`accrual_metadata`)='OBJECT')),
  ADD CONSTRAINT `ck_acc_draft_accrual_parent` CHECK (`parent_accrual_draft_id` IS NULL OR
    (`parent_accrual_draft_id` <> `journal_draft_id` AND `source_kind`='ACCRUAL_ADJUSTMENT'));

ALTER TABLE `arya_accounting_document`
  ADD COLUMN `accrual_draft_id` CHAR(36) NULL,
  ADD KEY `idx_acc_doc_accrual` (`accrual_draft_id`),
  ADD CONSTRAINT `fk_acc_doc_accrual` FOREIGN KEY (`accrual_draft_id`)
    REFERENCES `arya_accounting_journal_draft` (`journal_draft_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `arya_accounting_schedule`
  ADD COLUMN `allocation_method` VARCHAR(20) NOT NULL,
  ADD COLUMN `policy_evidence` VARCHAR(1000) NOT NULL,
  ADD COLUMN `recognition_basis` VARCHAR(1000) NOT NULL,
  ADD COLUMN `revision` INT UNSIGNED NOT NULL DEFAULT 1,
  ADD COLUMN `termination_journal_id` CHAR(36) NULL,
  ADD COLUMN `terminated_on` DATE NULL,
  ADD UNIQUE KEY `uk_acc_schedule_termination` (`termination_journal_id`),
  ADD CONSTRAINT `fk_acc_schedule_termination` FOREIGN KEY (`termination_journal_id`)
    REFERENCES `arya_accounting_journal` (`accounting_journal_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ALTER COLUMN `status` SET DEFAULT 'DRAFT',
  DROP CHECK `ck_acc_schedule_status`,
  ADD CONSTRAINT `ck_acc_schedule_status` CHECK (`status` IN ('DRAFT','ACTIVE','COMPLETED','CANCELLED','TERMINATED')),
  ADD CONSTRAINT `ck_acc_schedule_method` CHECK (`allocation_method` IN ('MONTHLY_EQUAL','ACTUAL_DAYS','CUSTOM')),
  ADD CONSTRAINT `ck_acc_schedule_policy` CHECK (CHAR_LENGTH(TRIM(`policy_evidence`))>0 AND CHAR_LENGTH(TRIM(`recognition_basis`))>0),
  ADD CONSTRAINT `ck_acc_schedule_revision` CHECK (`revision`>0),
  ADD CONSTRAINT `ck_acc_schedule_termination` CHECK
    ((`status`='TERMINATED' AND `termination_journal_id` IS NOT NULL AND `terminated_on` IS NOT NULL) OR
     (`status`<>'TERMINATED' AND `termination_journal_id` IS NULL AND `terminated_on` IS NULL));

ALTER TABLE `arya_accounting_schedule_period`
  ADD COLUMN `recognition_date` DATE NOT NULL;

ALTER TABLE `arya_accounting_approval_request`
  ADD COLUMN `accounting_schedule_id` CHAR(36) NULL,
  ADD COLUMN `accounting_schedule_period_id` CHAR(36) NULL,
  ADD KEY `idx_acc_approval_schedule` (`accounting_schedule_id`),
  ADD KEY `idx_acc_approval_schedule_period` (`accounting_schedule_period_id`),
  ADD CONSTRAINT `fk_acc_approval_schedule` FOREIGN KEY (`accounting_schedule_id`)
    REFERENCES `arya_accounting_schedule` (`accounting_schedule_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `fk_acc_approval_schedule_period` FOREIGN KEY (`accounting_schedule_period_id`)
    REFERENCES `arya_accounting_schedule_period` (`schedule_period_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  DROP CHECK `ck_acc_approval_one_source`,
  DROP CHECK `ck_acc_approval_source_id`,
  DROP CHECK `ck_acc_approval_kind_source`,
  DROP CHECK `ck_acc_approval_applied_ref`,
  ADD CONSTRAINT `ck_acc_approval_one_source` CHECK (
    (`journal_draft_id` IS NOT NULL)+(`accounting_document_id` IS NOT NULL)+
    (`accounting_settlement_id` IS NOT NULL)+(`accounting_period_id` IS NOT NULL)+
    (`original_journal_id` IS NOT NULL)+(`fund_restriction_id` IS NOT NULL)+
    (`accounting_schedule_id` IS NOT NULL)+(`accounting_schedule_period_id` IS NOT NULL)=1),
  ADD CONSTRAINT `ck_acc_approval_source_id` CHECK (`source_document_id`=COALESCE(
    `journal_draft_id`,`accounting_document_id`,`accounting_settlement_id`,`accounting_period_id`,
    `original_journal_id`,`fund_restriction_id`,`accounting_schedule_id`,`accounting_schedule_period_id`)),
  ADD CONSTRAINT `ck_acc_approval_kind_source` CHECK (
    (`request_kind` IN ('MANUAL_JOURNAL','ADJUSTING_JOURNAL','ACCRUAL_DOCUMENT','ACCRUAL_ADJUSTMENT') AND `journal_draft_id` IS NOT NULL) OR
    (`request_kind` IN ('AP_INVOICE','AR_DOCUMENT','AR_ADJUSTMENT') AND `accounting_document_id` IS NOT NULL) OR
    (`request_kind`='SETTLEMENT' AND `accounting_settlement_id` IS NOT NULL) OR
    (`request_kind` IN ('PERIOD_CLOSE','PERIOD_REOPEN') AND `accounting_period_id` IS NOT NULL) OR
    (`request_kind`='JOURNAL_REVERSAL' AND `original_journal_id` IS NOT NULL) OR
    (`request_kind`='FUND_RELEASE' AND `fund_restriction_id` IS NOT NULL) OR
    (`request_kind` IN ('SCHEDULE_SETUP','SCHEDULE_CHANGE','SCHEDULE_CANCEL','SCHEDULE_TERMINATE') AND `accounting_schedule_id` IS NOT NULL) OR
    (`request_kind`='SCHEDULE_PERIOD' AND `accounting_schedule_period_id` IS NOT NULL)),
  ADD CONSTRAINT `ck_acc_approval_applied_ref` CHECK (`status`<>'APPLIED' OR
    `request_kind` IN ('PERIOD_CLOSE','PERIOD_REOPEN','SCHEDULE_SETUP','SCHEDULE_CHANGE','SCHEDULE_CANCEL') OR `applied_journal_id` IS NOT NULL);
