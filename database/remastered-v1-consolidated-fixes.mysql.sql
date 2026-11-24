-- Arya Tarray Remastered V1 consolidated corrective upgrade.
-- Generated from repository HEAD 2e290ee to the corrected Prisma schema.
-- Run only through an approved, backed-up operational change. The preflight
-- executes before any DDL so a child/parent mismatch cannot leave a partial FK
-- replacement. This script contains no credentials and no seed data.

DELIMITER $$
CREATE PROCEDURE arya_preflight_remastered_v1_fixes()
BEGIN
  IF EXISTS (
    SELECT 1 FROM arya_item_sale_purchase p
    LEFT JOIN arya_event_code_child c ON c.event_code_child_id = p.event_code_child_id AND c.event_code_id = p.event_code_id
    WHERE c.event_code_child_id IS NULL
  ) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Preflight failed: ITEM_SALE purchase child belongs to another parent'; END IF;
  IF EXISTS (
    SELECT 1 FROM arya_item_sale_purchase p
    JOIN arya_bank_transaction t ON t.bank_transaction_id = p.bank_transaction_id
    WHERE p.status = 'CONFIRMED' AND p.total_amount > t.original_amount
  ) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Preflight failed: confirmed ITEM_SALE allocation exceeds original bank amount'; END IF;
  IF EXISTS (
    SELECT 1 FROM arya_member_event_subscription s
    LEFT JOIN arya_event_code_child c ON c.event_code_child_id = s.event_code_child_id AND c.event_code_id = s.event_code_id
    WHERE s.event_code_child_id IS NOT NULL AND c.event_code_child_id IS NULL
  ) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Preflight failed: subscription child belongs to another parent'; END IF;
  IF EXISTS (
    SELECT 1 FROM arya_bank_transaction t
    LEFT JOIN arya_event_code_child c ON c.event_code_child_id = t.event_code_child_id AND c.event_code_id = t.event_code_id
    WHERE t.event_code_child_id IS NOT NULL AND c.event_code_child_id IS NULL
  ) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Preflight failed: bank transaction child belongs to another parent'; END IF;
  IF EXISTS (
    SELECT 1 FROM arya_reconciliation_correction_item i
    LEFT JOIN arya_event_code_child b ON b.event_code_child_id = i.before_event_code_child_id AND b.event_code_id = i.before_event_code_id
    LEFT JOIN arya_event_code_child p ON p.event_code_child_id = i.proposed_event_code_child_id AND p.event_code_id = i.proposed_event_code_id
    WHERE (i.before_event_code_child_id IS NOT NULL AND b.event_code_child_id IS NULL)
       OR (i.proposed_event_code_child_id IS NOT NULL AND p.event_code_child_id IS NULL)
  ) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Preflight failed: correction child belongs to another parent'; END IF;
END$$
DELIMITER ;
CALL arya_preflight_remastered_v1_fixes();
DROP PROCEDURE arya_preflight_remastered_v1_fixes;

-- DropForeignKey
ALTER TABLE `arya_item_sale_purchase` DROP FOREIGN KEY `fk_item_sale_purchase_child`;

-- DropForeignKey
ALTER TABLE `arya_member_event_subscription` DROP FOREIGN KEY `fk_member_event_sub_event_code_child`;

-- DropForeignKey
ALTER TABLE `arya_bank_transaction` DROP FOREIGN KEY `fk_bank_transaction_event_code_child`;

-- DropForeignKey
ALTER TABLE `arya_reconciliation_correction_item` DROP FOREIGN KEY `fk_correction_item_before_event_child`;

-- DropForeignKey
ALTER TABLE `arya_reconciliation_correction_item` DROP FOREIGN KEY `fk_correction_item_proposed_event_child`;

-- AlterTable
ALTER TABLE `arya_bank_statement_upload_duplicate` ADD COLUMN `imported_bank_transaction_id` CHAR(36) NULL,
    ADD COLUMN `match_type` VARCHAR(20) NOT NULL DEFAULT 'EXACT',
    ADD COLUMN `resolution_reason` VARCHAR(1000) NULL,
    ADD COLUMN `resolution_status` VARCHAR(20) NOT NULL DEFAULT 'CONFIRMED',
    ADD COLUMN `resolved_at` DATETIME(3) NULL,
    ADD COLUMN `resolved_by` CHAR(36) NULL;

-- AlterTable
ALTER TABLE `arya_bank_transaction` ADD COLUMN `evidence_fingerprint` CHAR(64) NULL;

-- CreateTable
CREATE TABLE `arya_login_throttle` (
    `throttle_key` CHAR(64) NOT NULL,
    `window_start` DATETIME(3) NOT NULL,
    `failure_count` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `blocked_until` DATETIME(3) NULL,
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_login_throttle_blocked_until`(`blocked_until`),
    PRIMARY KEY (`throttle_key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `arya_item_sale_fund` (
    `item_sale_fund_id` CHAR(36) NOT NULL,
    `bank_transaction_id` CHAR(36) NOT NULL,
    `item_sale_purchase_id` CHAR(36) NULL,
    `owner_member_id` CHAR(36) NULL,
    `ownership_status` VARCHAR(20) NOT NULL DEFAULT 'SUSPENSE',
    `original_amount` DECIMAL(20, 2) NOT NULL,
    `allocated_sale_amount` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    `unallocated_amount` DECIMAL(20, 2) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    `version` INTEGER UNSIGNED NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` CHAR(36) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_by` CHAR(36) NOT NULL,

    UNIQUE INDEX `uk_item_sale_fund_transaction`(`bank_transaction_id`),
    UNIQUE INDEX `uk_item_sale_fund_purchase`(`item_sale_purchase_id`),
    INDEX `idx_item_sale_fund_owner_status`(`owner_member_id`, `status`),
    INDEX `idx_item_sale_fund_ownership_status`(`ownership_status`, `status`),
    PRIMARY KEY (`item_sale_fund_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `arya_item_sale_fund_ledger` (
    `item_sale_fund_ledger_id` CHAR(36) NOT NULL,
    `item_sale_fund_id` CHAR(36) NOT NULL,
    `item_sale_purchase_id` CHAR(36) NULL,
    `entry_type` VARCHAR(30) NOT NULL,
    `amount_delta` DECIMAL(20, 2) NOT NULL,
    `balance_after` DECIMAL(20, 2) NOT NULL,
    `idempotency_key` VARCHAR(191) NOT NULL,
    `reversal_of_entry_id` CHAR(36) NULL,
    `reason` VARCHAR(1000) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` CHAR(36) NOT NULL,

    UNIQUE INDEX `uk_item_sale_fund_ledger_idempotency`(`idempotency_key`),
    UNIQUE INDEX `uk_item_sale_fund_ledger_reversal`(`reversal_of_entry_id`),
    INDEX `idx_item_sale_fund_ledger_fund_created`(`item_sale_fund_id`, `created_at`),
    INDEX `idx_item_sale_fund_ledger_purchase`(`item_sale_purchase_id`),
    INDEX `idx_item_sale_fund_ledger_created_by`(`created_by`),
    PRIMARY KEY (`item_sale_fund_ledger_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `arya_member_event_subscription_audit` (
    `member_event_subscription_audit_id` CHAR(36) NOT NULL,
    `member_event_subscription_id` CHAR(36) NOT NULL,
    `member_event_coverage_id` CHAR(36) NULL,
    `action` VARCHAR(40) NOT NULL,
    `before_data` JSON NULL,
    `after_data` JSON NULL,
    `reason` VARCHAR(1000) NOT NULL,
    `action_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `action_by` CHAR(36) NOT NULL,

    INDEX `idx_member_event_subscription_audit_subscription`(`member_event_subscription_id`, `action_at`),
    INDEX `idx_member_event_subscription_audit_coverage`(`member_event_coverage_id`),
    INDEX `idx_member_event_subscription_audit_action_by`(`action_by`),
    PRIMARY KEY (`member_event_subscription_audit_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `uk_event_code_child_id_parent` ON `arya_event_code_child`(`event_code_child_id`, `event_code_id`);

-- CreateIndex
CREATE INDEX `idx_bank_statement_duplicate_match_resolution` ON `arya_bank_statement_upload_duplicate`(`match_type`, `resolution_status`);

-- CreateIndex
CREATE INDEX `idx_bank_statement_duplicate_imported` ON `arya_bank_statement_upload_duplicate`(`imported_bank_transaction_id`);

-- CreateIndex
CREATE INDEX `idx_bank_statement_duplicate_resolved_by` ON `arya_bank_statement_upload_duplicate`(`resolved_by`);

-- CreateIndex
CREATE UNIQUE INDEX `uk_bank_transaction_evidence_fingerprint` ON `arya_bank_transaction`(`evidence_fingerprint`);

-- AddForeignKey
ALTER TABLE `arya_item_sale_purchase` ADD CONSTRAINT `fk_item_sale_purchase_child_parent` FOREIGN KEY (`event_code_child_id`, `event_code_id`) REFERENCES `arya_event_code_child`(`event_code_child_id`, `event_code_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_item_sale_fund` ADD CONSTRAINT `fk_item_sale_fund_transaction` FOREIGN KEY (`bank_transaction_id`) REFERENCES `arya_bank_transaction`(`bank_transaction_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_item_sale_fund` ADD CONSTRAINT `fk_item_sale_fund_purchase` FOREIGN KEY (`item_sale_purchase_id`) REFERENCES `arya_item_sale_purchase`(`item_sale_purchase_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_item_sale_fund` ADD CONSTRAINT `fk_item_sale_fund_owner` FOREIGN KEY (`owner_member_id`) REFERENCES `arya_member`(`member_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_item_sale_fund` ADD CONSTRAINT `fk_item_sale_fund_created_by` FOREIGN KEY (`created_by`) REFERENCES `arya_user`(`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_item_sale_fund` ADD CONSTRAINT `fk_item_sale_fund_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `arya_user`(`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_item_sale_fund_ledger` ADD CONSTRAINT `fk_item_sale_fund_ledger_fund` FOREIGN KEY (`item_sale_fund_id`) REFERENCES `arya_item_sale_fund`(`item_sale_fund_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_item_sale_fund_ledger` ADD CONSTRAINT `fk_item_sale_fund_ledger_purchase` FOREIGN KEY (`item_sale_purchase_id`) REFERENCES `arya_item_sale_purchase`(`item_sale_purchase_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_item_sale_fund_ledger` ADD CONSTRAINT `fk_item_sale_fund_ledger_reversal` FOREIGN KEY (`reversal_of_entry_id`) REFERENCES `arya_item_sale_fund_ledger`(`item_sale_fund_ledger_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_item_sale_fund_ledger` ADD CONSTRAINT `fk_item_sale_fund_ledger_created_by` FOREIGN KEY (`created_by`) REFERENCES `arya_user`(`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_member_event_subscription` ADD CONSTRAINT `fk_member_event_sub_event_code_child_parent` FOREIGN KEY (`event_code_child_id`, `event_code_id`) REFERENCES `arya_event_code_child`(`event_code_child_id`, `event_code_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_member_event_subscription_audit` ADD CONSTRAINT `fk_member_event_subscription_audit_subscription` FOREIGN KEY (`member_event_subscription_id`) REFERENCES `arya_member_event_subscription`(`member_event_subscription_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_member_event_subscription_audit` ADD CONSTRAINT `fk_member_event_subscription_audit_action_by` FOREIGN KEY (`action_by`) REFERENCES `arya_user`(`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_bank_statement_upload_duplicate` ADD CONSTRAINT `fk_bank_statement_duplicate_imported_transaction` FOREIGN KEY (`imported_bank_transaction_id`) REFERENCES `arya_bank_transaction`(`bank_transaction_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_bank_statement_upload_duplicate` ADD CONSTRAINT `fk_bank_statement_duplicate_resolved_by` FOREIGN KEY (`resolved_by`) REFERENCES `arya_user`(`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_bank_transaction` ADD CONSTRAINT `fk_bank_transaction_event_code_child_parent` FOREIGN KEY (`event_code_child_id`, `event_code_id`) REFERENCES `arya_event_code_child`(`event_code_child_id`, `event_code_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_reconciliation_correction_item` ADD CONSTRAINT `fk_correction_item_before_event_child_parent` FOREIGN KEY (`before_event_code_child_id`, `before_event_code_id`) REFERENCES `arya_event_code_child`(`event_code_child_id`, `event_code_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_reconciliation_correction_item` ADD CONSTRAINT `fk_correction_item_proposed_event_child_parent` FOREIGN KEY (`proposed_event_code_child_id`, `proposed_event_code_id`) REFERENCES `arya_event_code_child`(`event_code_child_id`, `event_code_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Evidence-based, idempotent historical ITEM_SALE fund backfill. It never
-- changes the bank transaction, purchase, inventory, owner, or GL. Unknown
-- owners remain SUSPENSE and pending purchases retain the full receipt as a
-- liability. Existing fund rows and ledger evidence are never overwritten.
INSERT INTO arya_item_sale_fund (
  item_sale_fund_id, bank_transaction_id, item_sale_purchase_id,
  owner_member_id, ownership_status, original_amount,
  allocated_sale_amount, unallocated_amount, status, version,
  created_at, created_by, updated_at, updated_by
)
SELECT
  UUID(), t.bank_transaction_id, p.item_sale_purchase_id,
  CASE WHEN mi.verification_status = 'VERIFIED' THEN mi.member_id ELSE NULL END,
  CASE WHEN mi.verification_status = 'VERIFIED' AND mi.member_id IS NOT NULL THEN 'ATTRIBUTED' ELSE 'SUSPENSE' END,
  t.original_amount,
  CASE WHEN p.status = 'CONFIRMED' THEN p.total_amount ELSE 0 END,
  t.original_amount - CASE WHEN p.status = 'CONFIRMED' THEN p.total_amount ELSE 0 END,
  CASE WHEN p.status = 'CONFIRMED' AND p.total_amount = t.original_amount THEN 'SETTLED' ELSE 'OPEN' END,
  1, CURRENT_TIMESTAMP(3), COALESCE(p.created_by, s.uploaded_by), CURRENT_TIMESTAMP(3), COALESCE(p.updated_by, s.uploaded_by)
FROM arya_bank_transaction t
JOIN arya_bank_statement_upload s ON s.statement_upload_id = t.statement_upload_id
JOIN arya_event_code e ON e.event_code_id = t.event_code_id AND e.event_type = 'ITEM_SALE'
LEFT JOIN arya_item_sale_purchase p ON p.bank_transaction_id = t.bank_transaction_id
LEFT JOIN arya_member_identity mi ON mi.member_identity_id = t.member_identity_id
LEFT JOIN arya_item_sale_fund existing ON existing.bank_transaction_id = t.bank_transaction_id
WHERE t.status = 'FINALIZED'
  AND t.reconciliation_excluded_at IS NULL
  AND t.original_amount > 0
  AND existing.item_sale_fund_id IS NULL;

INSERT INTO arya_item_sale_fund_ledger (
  item_sale_fund_ledger_id, item_sale_fund_id, item_sale_purchase_id,
  entry_type, amount_delta, balance_after, idempotency_key,
  reason, created_at, created_by
)
SELECT
  UUID(), f.item_sale_fund_id, f.item_sale_purchase_id,
  'SOURCE_RECEIPT', f.original_amount, f.original_amount,
  CONCAT('ITEM_SALE_SOURCE:', f.bank_transaction_id),
  'Historical evidence-based ITEM_SALE fund backfill', CURRENT_TIMESTAMP(3), f.created_by
FROM arya_item_sale_fund f
LEFT JOIN arya_item_sale_fund_ledger l
  ON l.idempotency_key = CONCAT('ITEM_SALE_SOURCE:', f.bank_transaction_id)
WHERE l.item_sale_fund_ledger_id IS NULL;

INSERT INTO arya_item_sale_fund_ledger (
  item_sale_fund_ledger_id, item_sale_fund_id, item_sale_purchase_id,
  entry_type, amount_delta, balance_after, idempotency_key,
  reason, created_at, created_by
)
SELECT
  UUID(), f.item_sale_fund_id, f.item_sale_purchase_id,
  'SALE_ALLOCATION', -f.allocated_sale_amount, f.unallocated_amount,
  CONCAT('ITEM_SALE_BACKFILL_ALLOCATION:', f.bank_transaction_id),
  'Historical confirmed ITEM_SALE allocation backfill', CURRENT_TIMESTAMP(3), f.created_by
FROM arya_item_sale_fund f
LEFT JOIN arya_item_sale_fund_ledger l
  ON l.idempotency_key = CONCAT('ITEM_SALE_BACKFILL_ALLOCATION:', f.bank_transaction_id)
WHERE f.allocated_sale_amount > 0
  AND l.item_sale_fund_ledger_id IS NULL;

-- ---------------------------------------------------------------------------
-- Final Remastered V1 revision: safe duplicate fingerprint index and
-- authorized ITEM_SALE wallet allocation. Existing rows receive zero wallet
-- allocations; no historical bank amount, purchase, or ledger row is changed.
-- ---------------------------------------------------------------------------

-- The fingerprint is evidence metadata, not a unique bank transaction ID.
-- Keep it indexed for matching, but never reject two legitimate BCA transfers.
ALTER TABLE `arya_bank_transaction` DROP INDEX `uk_bank_transaction_evidence_fingerprint`;
CREATE INDEX `idx_bank_transaction_evidence_fingerprint` ON `arya_bank_transaction`(`evidence_fingerprint`);

ALTER TABLE `arya_item_sale_purchase`
    ADD COLUMN `wallet_applied_amount` DECIMAL(20, 2) NOT NULL DEFAULT 0;

ALTER TABLE `arya_item_sale_fund`
    ADD COLUMN `other_allocated_amount` DECIMAL(20, 2) NOT NULL DEFAULT 0;

CREATE TABLE `arya_item_sale_fund_allocation` (
    `item_sale_fund_allocation_id` CHAR(36) NOT NULL,
    `source_item_sale_fund_id` CHAR(36) NOT NULL,
    `item_sale_purchase_id` CHAR(36) NOT NULL,
    `amount` DECIMAL(20, 2) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    `idempotency_key` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(1000) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` CHAR(36) NOT NULL,
    `reversed_at` DATETIME(3) NULL,
    `reversed_by` CHAR(36) NULL,
    `reversal_reason` VARCHAR(1000) NULL,

    UNIQUE INDEX `uk_item_sale_fund_allocation_idempotency`(`idempotency_key`),
    INDEX `idx_item_sale_fund_allocation_source_status`(`source_item_sale_fund_id`, `status`),
    INDEX `idx_item_sale_fund_allocation_purchase_status`(`item_sale_purchase_id`, `status`),
    INDEX `idx_item_sale_fund_allocation_created_by`(`created_by`),
    INDEX `idx_item_sale_fund_allocation_reversed_by`(`reversed_by`),
    PRIMARY KEY (`item_sale_fund_allocation_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `arya_item_sale_fund_allocation` ADD CONSTRAINT `fk_item_sale_fund_allocation_source` FOREIGN KEY (`source_item_sale_fund_id`) REFERENCES `arya_item_sale_fund`(`item_sale_fund_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `arya_item_sale_fund_allocation` ADD CONSTRAINT `fk_item_sale_fund_allocation_purchase` FOREIGN KEY (`item_sale_purchase_id`) REFERENCES `arya_item_sale_purchase`(`item_sale_purchase_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `arya_item_sale_fund_allocation` ADD CONSTRAINT `fk_item_sale_fund_allocation_created_by` FOREIGN KEY (`created_by`) REFERENCES `arya_user`(`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `arya_item_sale_fund_allocation` ADD CONSTRAINT `fk_item_sale_fund_allocation_reversed_by` FOREIGN KEY (`reversed_by`) REFERENCES `arya_user`(`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
