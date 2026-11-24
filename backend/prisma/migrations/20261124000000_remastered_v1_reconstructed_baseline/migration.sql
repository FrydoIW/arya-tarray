-- CreateTable
CREATE TABLE `arya_member` (
    `member_id` CHAR(36) NOT NULL,
    `member_code` VARCHAR(30) NOT NULL,
    `member_name` VARCHAR(150) NOT NULL,
    `initial_name` VARCHAR(100) NULL,
    `birth_date` DATE NULL,
    `phone` VARCHAR(50) NULL,
    `email` VARCHAR(150) NULL,
    `address` VARCHAR(500) NULL,
    `city` VARCHAR(100) NULL,
    `registration_source` VARCHAR(20) NOT NULL DEFAULT 'MANUAL',
    `active_flag` BOOLEAN NOT NULL DEFAULT true,
    `remark` VARCHAR(500) NULL,
    `registered_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `registered_by` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` CHAR(36) NULL,
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_by` CHAR(36) NULL,

    UNIQUE INDEX `uk_member_code`(`member_code`),
    INDEX `idx_member_name`(`member_name`),
    INDEX `idx_member_initial_name`(`initial_name`),
    INDEX `idx_member_city`(`city`),
    INDEX `idx_member_active`(`active_flag`),
    INDEX `fk_member_registered_by`(`registered_by`),
    INDEX `fk_member_created_by`(`created_by`),
    INDEX `fk_member_updated_by`(`updated_by`),
    PRIMARY KEY (`member_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `arya_member_identity` (
    `member_identity_id` CHAR(36) NOT NULL,
    `member_id` CHAR(36) NULL,
    `source_type` VARCHAR(20) NOT NULL DEFAULT 'STATEMENT',
    `bank_name` VARCHAR(100) NULL,
    `account_number` VARCHAR(100) NULL,
    `account_type` VARCHAR(100) NULL,
    `account_name` VARCHAR(200) NOT NULL,
    `initial_name` VARCHAR(100) NULL,
    `normalized_name` VARCHAR(200) NOT NULL,
    `identity_key` VARCHAR(191) NOT NULL,
    `verification_status` VARCHAR(20) NOT NULL DEFAULT 'UNVERIFIED',
    `first_seen_statement_upload_id` CHAR(36) NULL,
    `first_seen_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_seen_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `verified_at` DATETIME(3) NULL,
    `verified_by` CHAR(36) NULL,
    `remark` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` CHAR(36) NULL,
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_by` CHAR(36) NULL,

    UNIQUE INDEX `uk_member_identity_key`(`identity_key`),
    INDEX `idx_member_identity_member`(`member_id`),
    INDEX `idx_member_identity_status`(`verification_status`),
    INDEX `idx_member_identity_normalized_name`(`normalized_name`),
    INDEX `idx_member_identity_account_name`(`account_name`),
    INDEX `idx_member_identity_account_number`(`account_number`),
    INDEX `idx_member_identity_last_seen`(`last_seen_at`),
    INDEX `fk_member_identity_first_statement`(`first_seen_statement_upload_id`),
    INDEX `fk_member_identity_verified_by`(`verified_by`),
    INDEX `fk_member_identity_created_by`(`created_by`),
    INDEX `fk_member_identity_updated_by`(`updated_by`),
    PRIMARY KEY (`member_identity_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `arya_member_identity_history` (
    `member_identity_history_id` CHAR(36) NOT NULL,
    `member_identity_id` CHAR(36) NOT NULL,
    `action` VARCHAR(20) NOT NULL,
    `from_member_id` CHAR(36) NULL,
    `to_member_id` CHAR(36) NULL,
    `status_before` VARCHAR(20) NOT NULL,
    `status_after` VARCHAR(20) NOT NULL,
    `reason` VARCHAR(1000) NULL,
    `action_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `action_by` CHAR(36) NOT NULL,

    INDEX `idx_member_identity_history_identity_action_at`(`member_identity_id`, `action_at`),
    INDEX `idx_member_identity_history_from_member`(`from_member_id`, `action_at`),
    INDEX `idx_member_identity_history_to_member`(`to_member_id`, `action_at`),
    INDEX `idx_member_identity_history_action_by`(`action_by`),
    PRIMARY KEY (`member_identity_history_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `arya_role` (
    `role_id` CHAR(36) NOT NULL,
    `role_code` VARCHAR(50) NOT NULL,
    `role_name` VARCHAR(100) NOT NULL,
    `description` VARCHAR(255) NULL,
    `active_flag` BOOLEAN NOT NULL DEFAULT true,
    `created_by` CHAR(36) NULL,
    `updated_by` CHAR(36) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    PRIMARY KEY (`role_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `arya_user` (
    `user_id` CHAR(36) NOT NULL,
    `full_name` VARCHAR(150) NOT NULL,
    `email` VARCHAR(150) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    `created_by` CHAR(36) NULL,
    `updated_by` CHAR(36) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    PRIMARY KEY (`user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

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
CREATE TABLE `arya_user_role` (
    `user_id` CHAR(36) NOT NULL,
    `role_id` CHAR(36) NOT NULL,

    PRIMARY KEY (`user_id`, `role_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `arya_menu` (
    `menu_id` CHAR(36) NOT NULL,
    `parent_menu_id` CHAR(36) NULL,
    `menu_code` VARCHAR(100) NOT NULL,
    `menu_name` VARCHAR(150) NOT NULL,
    `route` VARCHAR(255) NULL,
    `menu_type` VARCHAR(20) NOT NULL,
    `display_order` INTEGER NOT NULL DEFAULT 0,
    `active_flag` BOOLEAN NOT NULL DEFAULT true,
    `created_by` CHAR(36) NULL,
    `updated_by` CHAR(36) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    PRIMARY KEY (`menu_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `arya_role_menu` (
    `role_id` CHAR(36) NOT NULL,
    `menu_id` CHAR(36) NOT NULL,
    `created_by` CHAR(36) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    PRIMARY KEY (`role_id`, `menu_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `arya_event_code` (
    `event_code_id` CHAR(36) NOT NULL,
    `code` CHAR(3) NOT NULL,
    `event_name` VARCHAR(150) NOT NULL,
    `category` VARCHAR(50) NULL,
    `event_type` VARCHAR(20) NOT NULL DEFAULT 'STANDARD',
    `description` VARCHAR(500) NULL,
    `active_flag` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `created_by` CHAR(36) NULL,
    `updated_at` DATETIME(0) NOT NULL,
    `updated_by` CHAR(36) NULL,

    INDEX `idx_event_code_type`(`event_type`),
    PRIMARY KEY (`event_code_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `arya_event_campaign` (
    `event_campaign_id` CHAR(36) NOT NULL,
    `event_code_id` CHAR(36) NOT NULL,
    `campaign_name` VARCHAR(200) NOT NULL,
    `start_date` DATE NULL,
    `end_date` DATE NULL,
    `target_amount` DECIMAL(20, 2) NULL,
    `active_flag` BOOLEAN NOT NULL DEFAULT true,
    `remark` VARCHAR(1000) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `created_by` CHAR(36) NULL,
    `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_by` CHAR(36) NULL,

    INDEX `idx_event_campaign_event_active`(`event_code_id`, `active_flag`),
    INDEX `idx_event_campaign_period`(`start_date`, `end_date`),
    INDEX `idx_event_campaign_created_by`(`created_by`),
    INDEX `idx_event_campaign_updated_by`(`updated_by`),
    PRIMARY KEY (`event_campaign_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `arya_event_time_rule` (
    `event_code_id` CHAR(36) NOT NULL,
    `unit_amount` DECIMAL(20, 2) NOT NULL,
    `duration_months` INTEGER UNSIGNED NOT NULL DEFAULT 1,
    `active_flag` BOOLEAN NOT NULL DEFAULT true,
    `remark` VARCHAR(1000) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `created_by` CHAR(36) NULL,
    `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_by` CHAR(36) NULL,

    INDEX `idx_event_time_rule_created_by`(`created_by`),
    INDEX `idx_event_time_rule_updated_by`(`updated_by`),
    PRIMARY KEY (`event_code_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `arya_event_code_child` (
    `event_code_child_id` CHAR(36) NOT NULL,
    `event_code_id` CHAR(36) NOT NULL,
    `child_code` VARCHAR(30) NOT NULL,
    `child_name` VARCHAR(150) NOT NULL,
    `description` VARCHAR(500) NULL,
    `display_order` INTEGER NOT NULL DEFAULT 0,
    `active_flag` BOOLEAN NOT NULL DEFAULT true,
    `capacity` INTEGER UNSIGNED NULL,
    `unit_amount` DECIMAL(20, 2) NULL,
    `duration_months` INTEGER UNSIGNED NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `created_by` CHAR(36) NULL,
    `updated_at` DATETIME(0) NOT NULL,
    `updated_by` CHAR(36) NULL,

    INDEX `idx_event_code_child_parent_active`(`event_code_id`, `active_flag`),
    INDEX `idx_event_code_child_created_by`(`created_by`),
    INDEX `idx_event_code_child_updated_by`(`updated_by`),
    UNIQUE INDEX `uk_event_code_child_parent_code`(`event_code_id`, `child_code`),
    UNIQUE INDEX `uk_event_code_child_id_parent`(`event_code_child_id`, `event_code_id`),
    PRIMARY KEY (`event_code_child_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `arya_event_code_child_capacity_change` (
    `event_code_child_capacity_change_id` CHAR(36) NOT NULL,
    `event_code_child_id` CHAR(36) NOT NULL,
    `before_capacity` INTEGER UNSIGNED NULL,
    `after_capacity` INTEGER UNSIGNED NOT NULL,
    `reason` VARCHAR(500) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `created_by` CHAR(36) NULL,

    INDEX `idx_child_capacity_change_child_created`(`event_code_child_id`, `created_at`),
    INDEX `idx_child_capacity_change_created_by`(`created_by`),
    PRIMARY KEY (`event_code_child_capacity_change_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `arya_item_sale_config` (
    `event_code_child_id` CHAR(36) NOT NULL,
    `unit_price` DECIMAL(20, 2) NOT NULL,
    `stock_on_hand` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `version` INTEGER UNSIGNED NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` CHAR(36) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_by` CHAR(36) NOT NULL,

    INDEX `idx_item_sale_config_updated_by`(`updated_by`),
    PRIMARY KEY (`event_code_child_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `arya_item_sale_purchase` (
    `item_sale_purchase_id` CHAR(36) NOT NULL,
    `bank_transaction_id` CHAR(36) NOT NULL,
    `event_code_id` CHAR(36) NOT NULL,
    `event_code_child_id` CHAR(36) NOT NULL,
    `member_identity_id` CHAR(36) NULL,
    `buyer_member_id` CHAR(36) NULL,
    `quantity` INTEGER UNSIGNED NOT NULL,
    `unit_price_snapshot` DECIMAL(20, 2) NOT NULL,
    `total_amount` DECIMAL(20, 2) NOT NULL,
    `payment_amount_snapshot` DECIMAL(20, 2) NULL,
    `wallet_applied_amount` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    `status` VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
    `resolution_reason` VARCHAR(1000) NULL,
    `version` INTEGER UNSIGNED NOT NULL DEFAULT 1,
    `confirmed_at` DATETIME(3) NULL,
    `confirmed_by` CHAR(36) NULL,
    `reversed_at` DATETIME(3) NULL,
    `reversed_by` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` CHAR(36) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_by` CHAR(36) NOT NULL,

    UNIQUE INDEX `uk_item_sale_purchase_transaction`(`bank_transaction_id`),
    INDEX `idx_item_sale_purchase_status_updated`(`status`, `updated_at`),
    INDEX `idx_item_sale_purchase_child_status`(`event_code_child_id`, `status`),
    INDEX `idx_item_sale_purchase_buyer_status`(`buyer_member_id`, `status`),
    INDEX `idx_item_sale_purchase_identity`(`member_identity_id`),
    PRIMARY KEY (`item_sale_purchase_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `arya_item_sale_inventory_movement` (
    `item_sale_inventory_movement_id` CHAR(36) NOT NULL,
    `event_code_child_id` CHAR(36) NOT NULL,
    `item_sale_purchase_id` CHAR(36) NULL,
    `movement_type` VARCHAR(30) NOT NULL,
    `quantity_delta` INTEGER NOT NULL,
    `stock_before` INTEGER UNSIGNED NOT NULL,
    `stock_after` INTEGER UNSIGNED NOT NULL,
    `source_reference` VARCHAR(191) NOT NULL,
    `idempotency_key` VARCHAR(191) NOT NULL,
    `reversal_of_movement_id` CHAR(36) NULL,
    `reason` VARCHAR(1000) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` CHAR(36) NOT NULL,

    UNIQUE INDEX `uk_item_sale_inventory_idempotency`(`idempotency_key`),
    UNIQUE INDEX `uk_item_sale_inventory_reversal`(`reversal_of_movement_id`),
    INDEX `idx_item_sale_inventory_child_created`(`event_code_child_id`, `created_at`),
    INDEX `idx_item_sale_inventory_purchase_created`(`item_sale_purchase_id`, `created_at`),
    INDEX `idx_item_sale_inventory_created_by`(`created_by`),
    PRIMARY KEY (`item_sale_inventory_movement_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `arya_item_sale_audit` (
    `item_sale_audit_id` CHAR(36) NOT NULL,
    `entity_type` VARCHAR(30) NOT NULL,
    `entity_id` CHAR(36) NOT NULL,
    `action` VARCHAR(50) NOT NULL,
    `before_data` JSON NULL,
    `after_data` JSON NULL,
    `reason` VARCHAR(1000) NOT NULL,
    `action_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `action_by` CHAR(36) NOT NULL,

    INDEX `idx_item_sale_audit_entity_action`(`entity_type`, `entity_id`, `action_at`),
    INDEX `idx_item_sale_audit_action_by`(`action_by`),
    PRIMARY KEY (`item_sale_audit_id`)
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
    `other_allocated_amount` DECIMAL(20, 2) NOT NULL DEFAULT 0,
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
CREATE TABLE `arya_member_event_subscription` (
    `member_event_subscription_id` CHAR(36) NOT NULL,
    `member_id` CHAR(36) NOT NULL,
    `event_code_id` CHAR(36) NOT NULL,
    `event_code_child_id` CHAR(36) NULL,
    `reference_no` VARCHAR(100) NULL,
    `display_name` VARCHAR(200) NULL,
    `start_date` DATE NULL,
    `valid_until` DATE NULL,
    `active_flag` BOOLEAN NOT NULL DEFAULT true,
    `remark` VARCHAR(1000) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` CHAR(36) NULL,
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_by` CHAR(36) NULL,

    INDEX `idx_member_event_sub_member_event`(`member_id`, `event_code_id`, `active_flag`),
    INDEX `idx_member_event_sub_event`(`event_code_id`, `active_flag`),
    INDEX `idx_member_event_sub_event_code_child`(`event_code_child_id`),
    INDEX `idx_member_event_sub_reference`(`reference_no`),
    INDEX `idx_member_event_sub_valid_until`(`valid_until`),
    INDEX `idx_member_event_sub_created_by`(`created_by`),
    INDEX `idx_member_event_sub_updated_by`(`updated_by`),
    UNIQUE INDEX `uk_member_event_sub_member_child`(`member_id`, `event_code_child_id`),
    PRIMARY KEY (`member_event_subscription_id`)
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

-- CreateTable
CREATE TABLE `arya_member_event_coverage` (
    `member_event_coverage_id` CHAR(36) NOT NULL,
    `member_event_subscription_id` CHAR(36) NOT NULL,
    `bank_transaction_id` CHAR(36) NULL,
    `coverage_source` VARCHAR(20) NOT NULL DEFAULT 'TRANSACTION',
    `coverage_status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    `unit_amount_snapshot` DECIMAL(20, 2) NULL,
    `duration_months_snapshot` INTEGER UNSIGNED NULL,
    `granted_units` INTEGER UNSIGNED NULL,
    `amount_applied` DECIMAL(20, 2) NULL,
    `coverage_from` DATE NOT NULL,
    `coverage_to` DATE NOT NULL,
    `remark` VARCHAR(1000) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` CHAR(36) NULL,
    `voided_at` DATETIME(3) NULL,
    `voided_by` CHAR(36) NULL,
    `void_reason` VARCHAR(1000) NULL,

    INDEX `idx_member_event_cov_subscription`(`member_event_subscription_id`, `coverage_status`, `coverage_to`),
    INDEX `idx_member_event_cov_transaction`(`bank_transaction_id`),
    INDEX `idx_member_event_cov_period`(`coverage_from`, `coverage_to`),
    INDEX `idx_member_event_cov_created_by`(`created_by`),
    INDEX `idx_member_event_cov_voided_by`(`voided_by`),
    PRIMARY KEY (`member_event_coverage_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `arya_member_event_balance_ledger` (
    `member_event_balance_ledger_id` CHAR(36) NOT NULL,
    `member_event_subscription_id` CHAR(36) NOT NULL,
    `bank_transaction_id` CHAR(36) NULL,
    `member_event_coverage_id` CHAR(36) NULL,
    `member_event_carry_transfer_id` CHAR(36) NULL,
    `entry_type` VARCHAR(20) NOT NULL,
    `entry_status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    `amount_delta` DECIMAL(20, 2) NOT NULL,
    `effective_date` DATE NOT NULL,
    `posting_sequence` BIGINT UNSIGNED NOT NULL,
    `unit_amount_snapshot` DECIMAL(20, 2) NULL,
    `duration_months_snapshot` INTEGER UNSIGNED NULL,
    `remark` VARCHAR(1000) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` CHAR(36) NULL,
    `voided_at` DATETIME(3) NULL,
    `voided_by` CHAR(36) NULL,
    `void_reason` VARCHAR(1000) NULL,

    INDEX `idx_member_event_balance_subscription`(`member_event_subscription_id`, `entry_status`, `effective_date`),
    INDEX `idx_member_event_balance_subscription_sequence`(`member_event_subscription_id`, `entry_status`, `posting_sequence`),
    INDEX `idx_member_event_balance_transaction`(`bank_transaction_id`),
    INDEX `idx_member_event_balance_coverage`(`member_event_coverage_id`),
    INDEX `idx_member_event_balance_carry_transfer`(`member_event_carry_transfer_id`),
    INDEX `idx_member_event_balance_type`(`entry_type`, `entry_status`),
    INDEX `idx_member_event_balance_created_by`(`created_by`),
    INDEX `idx_member_event_balance_voided_by`(`voided_by`),
    UNIQUE INDEX `uq_member_event_balance_subscription_sequence`(`member_event_subscription_id`, `posting_sequence`),
    PRIMARY KEY (`member_event_balance_ledger_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `arya_member_event_carry_transfer` (
    `member_event_carry_transfer_id` CHAR(36) NOT NULL,
    `member_id` CHAR(36) NOT NULL,
    `source_subscription_id` CHAR(36) NULL,
    `source_campaign_id` CHAR(36) NULL,
    `destination_subscription_id` CHAR(36) NULL,
    `destination_campaign_id` CHAR(36) NULL,
    `amount` DECIMAL(20, 2) NOT NULL,
    `effective_date` DATE NOT NULL,
    `reason` VARCHAR(1000) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    `idempotency_key` VARCHAR(100) NOT NULL,
    `request_hash` CHAR(64) NOT NULL,
    `reversal_of_transfer_id` CHAR(36) NULL,
    `destination_unit_amount_snapshot` DECIMAL(20, 2) NOT NULL,
    `destination_duration_months_snapshot` INTEGER UNSIGNED NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` CHAR(36) NOT NULL,
    `reversed_at` DATETIME(3) NULL,
    `reversed_by` CHAR(36) NULL,

    UNIQUE INDEX `uq_member_event_carry_transfer_idempotency`(`idempotency_key`),
    UNIQUE INDEX `uq_member_event_carry_transfer_reversal`(`reversal_of_transfer_id`),
    INDEX `idx_member_event_carry_transfer_member_date`(`member_id`, `effective_date`),
    INDEX `idx_member_event_carry_transfer_source`(`source_subscription_id`, `status`, `effective_date`),
    INDEX `idx_member_event_carry_transfer_source_campaign`(`source_campaign_id`, `status`, `effective_date`),
    INDEX `idx_member_event_carry_transfer_destination`(`destination_subscription_id`, `status`, `effective_date`),
    INDEX `idx_member_event_carry_transfer_campaign_destination`(`destination_campaign_id`, `status`, `effective_date`),
    INDEX `idx_member_event_carry_transfer_created_by`(`created_by`),
    INDEX `idx_member_event_carry_transfer_reversed_by`(`reversed_by`),
    PRIMARY KEY (`member_event_carry_transfer_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `arya_member_event_campaign_allocation` (
    `member_event_campaign_allocation_id` CHAR(36) NOT NULL,
    `member_id` CHAR(36) NOT NULL,
    `event_campaign_id` CHAR(36) NOT NULL,
    `member_event_carry_transfer_id` CHAR(36) NULL,
    `bank_transaction_id` CHAR(36) NULL,
    `amount_delta` DECIMAL(20, 2) NOT NULL,
    `allocation_type` VARCHAR(30) NOT NULL,
    `allocation_status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    `effective_date` DATE NOT NULL,
    `reason` VARCHAR(1000) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` CHAR(36) NOT NULL,
    `reversal_of_allocation_id` CHAR(36) NULL,
    `voided_at` DATETIME(3) NULL,
    `voided_by` CHAR(36) NULL,
    `void_reason` VARCHAR(1000) NULL,

    UNIQUE INDEX `uq_member_event_campaign_allocation_transfer`(`member_event_carry_transfer_id`),
    UNIQUE INDEX `uq_member_event_campaign_allocation_reversal`(`reversal_of_allocation_id`),
    INDEX `idx_member_event_campaign_allocation_member_campaign`(`member_id`, `event_campaign_id`, `allocation_status`, `effective_date`),
    INDEX `idx_member_event_campaign_allocation_campaign`(`event_campaign_id`, `allocation_status`, `effective_date`),
    INDEX `idx_member_event_campaign_allocation_transaction`(`bank_transaction_id`),
    INDEX `idx_member_event_campaign_allocation_created_by`(`created_by`),
    INDEX `idx_member_event_campaign_allocation_voided_by`(`voided_by`),
    PRIMARY KEY (`member_event_campaign_allocation_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `arya_member_event_campaign_wallet_ledger` (
    `member_event_campaign_wallet_ledger_id` CHAR(36) NOT NULL,
    `member_id` CHAR(36) NOT NULL,
    `event_campaign_id` CHAR(36) NOT NULL,
    `bank_transaction_id` CHAR(36) NULL,
    `member_event_carry_transfer_id` CHAR(36) NULL,
    `entry_type` VARCHAR(30) NOT NULL,
    `entry_status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    `amount_delta` DECIMAL(20, 2) NOT NULL,
    `effective_date` DATE NOT NULL,
    `posting_sequence` BIGINT UNSIGNED NOT NULL,
    `remark` VARCHAR(1000) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` CHAR(36) NOT NULL,
    `voided_at` DATETIME(3) NULL,
    `voided_by` CHAR(36) NULL,
    `void_reason` VARCHAR(1000) NULL,

    INDEX `idx_member_event_campaign_wallet_member_campaign`(`member_id`, `event_campaign_id`, `entry_status`, `effective_date`),
    INDEX `idx_member_event_campaign_wallet_sequence`(`member_id`, `event_campaign_id`, `entry_status`, `posting_sequence`),
    INDEX `idx_member_event_campaign_wallet_campaign`(`event_campaign_id`, `entry_status`, `effective_date`),
    INDEX `idx_member_event_campaign_wallet_transaction`(`bank_transaction_id`),
    INDEX `idx_member_event_campaign_wallet_transfer`(`member_event_carry_transfer_id`),
    INDEX `idx_member_event_campaign_wallet_created_by`(`created_by`),
    INDEX `idx_member_event_campaign_wallet_voided_by`(`voided_by`),
    UNIQUE INDEX `uq_member_event_campaign_wallet_sequence`(`member_id`, `event_campaign_id`, `posting_sequence`),
    PRIMARY KEY (`member_event_campaign_wallet_ledger_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `arya_member_event_campaign_participation` (
    `member_event_campaign_participation_id` CHAR(36) NOT NULL,
    `member_id` CHAR(36) NOT NULL,
    `event_campaign_id` CHAR(36) NOT NULL,
    `active_flag` BOOLEAN NOT NULL DEFAULT true,
    `remark` VARCHAR(1000) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` CHAR(36) NOT NULL,

    INDEX `idx_member_event_campaign_participation_member_active`(`member_id`, `active_flag`),
    INDEX `idx_member_event_campaign_participation_campaign_active`(`event_campaign_id`, `active_flag`),
    INDEX `idx_member_event_campaign_participation_created_by`(`created_by`),
    UNIQUE INDEX `uq_member_event_campaign_participation_member_campaign`(`member_id`, `event_campaign_id`),
    PRIMARY KEY (`member_event_campaign_participation_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `arya_bank_account` (
    `bank_account_id` CHAR(36) NOT NULL,
    `bank_code` VARCHAR(30) NOT NULL,
    `bank_name` VARCHAR(100) NOT NULL,
    `account_no` VARCHAR(100) NOT NULL,
    `account_name` VARCHAR(200) NOT NULL,
    `currency_code` CHAR(3) NOT NULL DEFAULT 'IDR',
    `opening_balance` DECIMAL(19, 2) NULL,
    `opening_balance_date` DATE NULL,
    `opening_balance_locked_at` DATETIME(3) NULL,
    `active_flag` BOOLEAN NOT NULL DEFAULT true,
    `created_by` CHAR(36) NULL,
    `updated_by` CHAR(36) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    UNIQUE INDEX `uk_bank_account_bank_account_no`(`bank_code`, `account_no`),
    PRIMARY KEY (`bank_account_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `arya_bank_statement_upload` (
    `statement_upload_id` CHAR(36) NOT NULL,
    `bank_account_id` CHAR(36) NOT NULL,
    `file_name` VARCHAR(255) NOT NULL,
    `period_from` DATE NULL,
    `period_to` DATE NULL,
    `total_transaction` INTEGER NOT NULL DEFAULT 0,
    `total_credit` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    `total_debit` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    `status` VARCHAR(20) NOT NULL DEFAULT 'RAW',
    `uploaded_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `uploaded_by` CHAR(36) NOT NULL,
    `executed_at` DATETIME(0) NULL,
    `executed_by` CHAR(36) NULL,
    `finalized_at` DATETIME(0) NULL,
    `finalized_by` CHAR(36) NULL,
    `remark` VARCHAR(1000) NULL,
    `withdrawn_at` DATETIME(3) NULL,
    `withdrawn_by` CHAR(36) NULL,
    `withdrawal_reason` VARCHAR(1000) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    INDEX `idx_bank_statement_account_status`(`bank_account_id`, `status`),
    INDEX `idx_bank_statement_withdrawn_by`(`withdrawn_by`),
    PRIMARY KEY (`statement_upload_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `arya_bank_statement_upload_attempt` (
    `upload_attempt_id` CHAR(36) NOT NULL,
    `bank_account_id` CHAR(36) NOT NULL,
    `file_name` VARCHAR(255) NOT NULL,
    `source_total_transaction` INTEGER NOT NULL,
    `source_total_credit` DECIMAL(20, 2) NOT NULL,
    `source_total_debit` DECIMAL(20, 2) NOT NULL,
    `imported_transaction_count` INTEGER NOT NULL,
    `duplicate_transaction_count` INTEGER NOT NULL,
    `uploaded_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `uploaded_by` CHAR(36) NOT NULL,
    `statement_upload_id` CHAR(36) NULL,

    UNIQUE INDEX `uk_bank_statement_attempt_statement`(`statement_upload_id`),
    INDEX `idx_bank_statement_attempt_account_uploaded`(`bank_account_id`, `uploaded_at`),
    INDEX `idx_bank_statement_attempt_uploaded_by`(`uploaded_by`),
    PRIMARY KEY (`upload_attempt_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `arya_bank_statement_upload_duplicate` (
    `duplicate_id` CHAR(36) NOT NULL,
    `upload_attempt_id` CHAR(36) NOT NULL,
    `matched_statement_upload_id` CHAR(36) NOT NULL,
    `matched_bank_transaction_id` CHAR(36) NOT NULL,
    `source_transaction_no` INTEGER NOT NULL,
    `source_worksheet_row` INTEGER NULL,
    `source_sheet_name` VARCHAR(150) NULL,
    `transaction_date` DATE NULL,
    `transaction_type` VARCHAR(20) NULL,
    `reference_no` VARCHAR(150) NULL,
    `sender_name` VARCHAR(255) NULL,
    `source_description` TEXT NULL,
    `original_amount` DECIMAL(20, 2) NOT NULL,
    `signature_hash` CHAR(64) NOT NULL,
    `match_type` VARCHAR(20) NOT NULL DEFAULT 'EXACT',
    `imported_bank_transaction_id` CHAR(36) NULL,
    `resolution_status` VARCHAR(20) NOT NULL DEFAULT 'CONFIRMED',
    `resolved_at` DATETIME(3) NULL,
    `resolved_by` CHAR(36) NULL,
    `resolution_reason` VARCHAR(1000) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_bank_statement_duplicate_attempt`(`upload_attempt_id`),
    INDEX `idx_bank_statement_duplicate_matched_statement`(`matched_statement_upload_id`),
    INDEX `idx_bank_statement_duplicate_matched_transaction`(`matched_bank_transaction_id`),
    INDEX `idx_bank_statement_duplicate_signature`(`signature_hash`),
    INDEX `idx_bank_statement_duplicate_match_resolution`(`match_type`, `resolution_status`),
    INDEX `idx_bank_statement_duplicate_imported`(`imported_bank_transaction_id`),
    INDEX `idx_bank_statement_duplicate_resolved_by`(`resolved_by`),
    PRIMARY KEY (`duplicate_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `arya_bank_transaction` (
    `member_identity_id` CHAR(36) NULL,
    `bank_transaction_id` CHAR(36) NOT NULL,
    `statement_upload_id` CHAR(36) NOT NULL,
    `row_no` INTEGER NULL,
    `transaction_date` DATE NULL,
    `transaction_type` VARCHAR(20) NULL,
    `reference_no` VARCHAR(150) NULL,
    `sender_name` VARCHAR(255) NULL,
    `description` TEXT NULL,
    `original_amount` DECIMAL(20, 2) NOT NULL,
    `suffix_code` CHAR(3) NULL,
    `suggested_event_code_id` CHAR(36) NULL,
    `event_code_id` CHAR(36) NULL,
    `event_code_child_id` CHAR(36) NULL,
    `event_campaign_id` CHAR(36) NULL,
    `base_amount` DECIMAL(20, 2) NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'RAW',
    `remark` VARCHAR(1000) NULL,
    `source_type` VARCHAR(20) NOT NULL DEFAULT 'BANK',
    `correction_reason` VARCHAR(1000) NULL,
    `manual_added_at` DATETIME(0) NULL,
    `manual_added_by` CHAR(36) NULL,
    `reconciliation_excluded_at` DATETIME(0) NULL,
    `reconciliation_excluded_by` CHAR(36) NULL,
    `reconciliation_exclusion_reason` VARCHAR(1000) NULL,
    `evidence_fingerprint` CHAR(64) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    INDEX `idx_bank_transaction_member_identity`(`member_identity_id`),
    INDEX `idx_bank_transaction_event_campaign`(`event_campaign_id`),
    INDEX `idx_bank_transaction_event_code_child`(`event_code_child_id`),
    INDEX `idx_bank_transaction_manual_added_by`(`manual_added_by`),
    INDEX `idx_bank_transaction_reconciliation_excluded`(`reconciliation_excluded_at`),
    INDEX `idx_bank_transaction_excluded_by`(`reconciliation_excluded_by`),
    INDEX `idx_bank_transaction_evidence_fingerprint`(`evidence_fingerprint`),
    PRIMARY KEY (`bank_transaction_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `arya_bank_transaction_history` (
    `transaction_history_id` CHAR(36) NOT NULL,
    `bank_transaction_id` CHAR(36) NOT NULL,
    `field_name` VARCHAR(100) NULL,
    `old_value` TEXT NULL,
    `new_value` TEXT NULL,
    `remark` VARCHAR(1000) NULL,
    `changed_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `changed_by` CHAR(36) NOT NULL,

    PRIMARY KEY (`transaction_history_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `arya_reconciliation_approval` (
    `approval_id` CHAR(36) NOT NULL,
    `statement_upload_id` CHAR(36) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    `submitted_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `submitted_by` CHAR(36) NOT NULL,
    `decided_at` DATETIME(0) NULL,
    `decided_by` CHAR(36) NULL,
    `remark` VARCHAR(1000) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    UNIQUE INDEX `arya_reconciliation_approval_statement_upload_id_key`(`statement_upload_id`),
    INDEX `arya_reconciliation_approval_status_submitted_at_idx`(`status`, `submitted_at`),
    PRIMARY KEY (`approval_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `arya_reconciliation_approval_approver` (
    `reconciliation_approval_approver_id` CHAR(36) NOT NULL,
    `reconciliation_approval_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_reconciliation_approval_approver_user`(`user_id`),
    UNIQUE INDEX `uk_reconciliation_approval_approver`(`reconciliation_approval_id`, `user_id`),
    PRIMARY KEY (`reconciliation_approval_approver_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `arya_reconciliation_correction_proposal` (
    `correction_proposal_id` CHAR(36) NOT NULL,
    `approval_id` CHAR(36) NOT NULL,
    `statement_upload_id` CHAR(36) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    `proposed_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `proposed_by` CHAR(36) NOT NULL,
    `decided_at` DATETIME(0) NULL,
    `decided_by` CHAR(36) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    INDEX `idx_correction_proposal_approval_status`(`approval_id`, `status`),
    INDEX `idx_correction_proposal_statement_status`(`statement_upload_id`, `status`),
    INDEX `idx_correction_proposal_proposed_by`(`proposed_by`),
    INDEX `idx_correction_proposal_decided_by`(`decided_by`),
    PRIMARY KEY (`correction_proposal_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `arya_reconciliation_correction_item` (
    `correction_item_id` CHAR(36) NOT NULL,
    `correction_proposal_id` CHAR(36) NOT NULL,
    `action` VARCHAR(20) NOT NULL,
    `bank_transaction_id` CHAR(36) NULL,
    `before_event_code_id` CHAR(36) NULL,
    `before_event_code_child_id` CHAR(36) NULL,
    `before_event_campaign_id` CHAR(36) NULL,
    `proposed_event_code_id` CHAR(36) NULL,
    `proposed_event_code_child_id` CHAR(36) NULL,
    `proposed_event_campaign_id` CHAR(36) NULL,
    `before_item_sale_quantity` INTEGER UNSIGNED NULL,
    `proposed_item_sale_quantity` INTEGER UNSIGNED NULL,
    `before_remark` VARCHAR(1000) NULL,
    `proposed_remark` VARCHAR(1000) NULL,
    `correction_reason` VARCHAR(1000) NULL,
    `manual_transaction_date` DATE NULL,
    `manual_transaction_type` VARCHAR(20) NULL,
    `manual_description` TEXT NULL,
    `manual_original_amount` DECIMAL(20, 2) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_correction_item_proposal_action`(`correction_proposal_id`, `action`),
    INDEX `idx_correction_item_transaction`(`bank_transaction_id`),
    INDEX `idx_correction_item_before_event`(`before_event_code_id`),
    INDEX `idx_correction_item_proposed_event`(`proposed_event_code_id`),
    INDEX `idx_correction_item_before_event_child`(`before_event_code_child_id`),
    INDEX `idx_correction_item_proposed_event_child`(`proposed_event_code_child_id`),
    INDEX `idx_correction_item_before_campaign`(`before_event_campaign_id`),
    INDEX `idx_correction_item_proposed_campaign`(`proposed_event_campaign_id`),
    PRIMARY KEY (`correction_item_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `arya_reconciliation_correction_approver` (
    `correction_approver_id` CHAR(36) NOT NULL,
    `correction_proposal_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_correction_approver_user`(`user_id`),
    UNIQUE INDEX `uk_correction_approver`(`correction_proposal_id`, `user_id`),
    PRIMARY KEY (`correction_approver_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `arya_reconciliation_approval_history` (
    `approval_history_id` CHAR(36) NOT NULL,
    `approval_id` CHAR(36) NOT NULL,
    `action` VARCHAR(50) NOT NULL,
    `remark` VARCHAR(1000) NULL,
    `action_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `action_by` CHAR(36) NOT NULL,

    INDEX `arya_reconciliation_approval_history_approval_id_action_at_idx`(`approval_id`, `action_at`),
    PRIMARY KEY (`approval_history_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `arya_approval_config` (
    `approval_config_id` CHAR(36) NOT NULL,
    `menu_id` CHAR(36) NOT NULL,
    `active_flag` BOOLEAN NOT NULL DEFAULT true,
    `created_by` CHAR(36) NULL,
    `updated_by` CHAR(36) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    UNIQUE INDEX `arya_approval_config_menu_id_key`(`menu_id`),
    PRIMARY KEY (`approval_config_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `arya_approval_config_approver` (
    `approval_config_id` CHAR(36) NOT NULL,
    `approver_user_id` CHAR(36) NOT NULL,
    `created_by` CHAR(36) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    PRIMARY KEY (`approval_config_id`, `approver_user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `arya_member` ADD CONSTRAINT `fk_member_registered_by` FOREIGN KEY (`registered_by`) REFERENCES `arya_user`(`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_member` ADD CONSTRAINT `fk_member_created_by` FOREIGN KEY (`created_by`) REFERENCES `arya_user`(`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_member` ADD CONSTRAINT `fk_member_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `arya_user`(`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_member_identity` ADD CONSTRAINT `fk_member_identity_member` FOREIGN KEY (`member_id`) REFERENCES `arya_member`(`member_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_member_identity` ADD CONSTRAINT `fk_member_identity_first_statement` FOREIGN KEY (`first_seen_statement_upload_id`) REFERENCES `arya_bank_statement_upload`(`statement_upload_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_member_identity` ADD CONSTRAINT `fk_member_identity_verified_by` FOREIGN KEY (`verified_by`) REFERENCES `arya_user`(`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_member_identity` ADD CONSTRAINT `fk_member_identity_created_by` FOREIGN KEY (`created_by`) REFERENCES `arya_user`(`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_member_identity` ADD CONSTRAINT `fk_member_identity_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `arya_user`(`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_member_identity_history` ADD CONSTRAINT `fk_member_identity_history_identity` FOREIGN KEY (`member_identity_id`) REFERENCES `arya_member_identity`(`member_identity_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_member_identity_history` ADD CONSTRAINT `fk_member_identity_history_from_member` FOREIGN KEY (`from_member_id`) REFERENCES `arya_member`(`member_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_member_identity_history` ADD CONSTRAINT `fk_member_identity_history_to_member` FOREIGN KEY (`to_member_id`) REFERENCES `arya_member`(`member_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_member_identity_history` ADD CONSTRAINT `fk_member_identity_history_action_by` FOREIGN KEY (`action_by`) REFERENCES `arya_user`(`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_role` ADD CONSTRAINT `arya_role_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `arya_user`(`user_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `arya_role` ADD CONSTRAINT `arya_role_updated_by_fkey` FOREIGN KEY (`updated_by`) REFERENCES `arya_user`(`user_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `arya_user` ADD CONSTRAINT `arya_user_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `arya_user`(`user_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `arya_user` ADD CONSTRAINT `arya_user_updated_by_fkey` FOREIGN KEY (`updated_by`) REFERENCES `arya_user`(`user_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `arya_user_role` ADD CONSTRAINT `arya_user_role_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `arya_user`(`user_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `arya_user_role` ADD CONSTRAINT `arya_user_role_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `arya_role`(`role_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `arya_menu` ADD CONSTRAINT `arya_menu_parent_menu_id_fkey` FOREIGN KEY (`parent_menu_id`) REFERENCES `arya_menu`(`menu_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `arya_menu` ADD CONSTRAINT `arya_menu_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `arya_user`(`user_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `arya_menu` ADD CONSTRAINT `arya_menu_updated_by_fkey` FOREIGN KEY (`updated_by`) REFERENCES `arya_user`(`user_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `arya_role_menu` ADD CONSTRAINT `arya_role_menu_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `arya_role`(`role_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `arya_role_menu` ADD CONSTRAINT `arya_role_menu_menu_id_fkey` FOREIGN KEY (`menu_id`) REFERENCES `arya_menu`(`menu_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `arya_role_menu` ADD CONSTRAINT `arya_role_menu_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `arya_user`(`user_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `arya_event_code` ADD CONSTRAINT `arya_event_code_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `arya_user`(`user_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `arya_event_code` ADD CONSTRAINT `arya_event_code_updated_by_fkey` FOREIGN KEY (`updated_by`) REFERENCES `arya_user`(`user_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `arya_event_campaign` ADD CONSTRAINT `fk_event_campaign_event_code` FOREIGN KEY (`event_code_id`) REFERENCES `arya_event_code`(`event_code_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_event_campaign` ADD CONSTRAINT `fk_event_campaign_created_by` FOREIGN KEY (`created_by`) REFERENCES `arya_user`(`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_event_campaign` ADD CONSTRAINT `fk_event_campaign_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `arya_user`(`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_event_time_rule` ADD CONSTRAINT `fk_event_time_rule_event_code` FOREIGN KEY (`event_code_id`) REFERENCES `arya_event_code`(`event_code_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_event_time_rule` ADD CONSTRAINT `fk_event_time_rule_created_by` FOREIGN KEY (`created_by`) REFERENCES `arya_user`(`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_event_time_rule` ADD CONSTRAINT `fk_event_time_rule_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `arya_user`(`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_event_code_child` ADD CONSTRAINT `fk_event_code_child_event_code` FOREIGN KEY (`event_code_id`) REFERENCES `arya_event_code`(`event_code_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_event_code_child` ADD CONSTRAINT `fk_event_code_child_created_by` FOREIGN KEY (`created_by`) REFERENCES `arya_user`(`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_event_code_child` ADD CONSTRAINT `fk_event_code_child_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `arya_user`(`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_event_code_child_capacity_change` ADD CONSTRAINT `fk_child_capacity_change_child` FOREIGN KEY (`event_code_child_id`) REFERENCES `arya_event_code_child`(`event_code_child_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_event_code_child_capacity_change` ADD CONSTRAINT `fk_child_capacity_change_created_by` FOREIGN KEY (`created_by`) REFERENCES `arya_user`(`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_item_sale_config` ADD CONSTRAINT `fk_item_sale_config_child` FOREIGN KEY (`event_code_child_id`) REFERENCES `arya_event_code_child`(`event_code_child_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_item_sale_config` ADD CONSTRAINT `fk_item_sale_config_created_by` FOREIGN KEY (`created_by`) REFERENCES `arya_user`(`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_item_sale_config` ADD CONSTRAINT `fk_item_sale_config_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `arya_user`(`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_item_sale_purchase` ADD CONSTRAINT `fk_item_sale_purchase_transaction` FOREIGN KEY (`bank_transaction_id`) REFERENCES `arya_bank_transaction`(`bank_transaction_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_item_sale_purchase` ADD CONSTRAINT `fk_item_sale_purchase_event` FOREIGN KEY (`event_code_id`) REFERENCES `arya_event_code`(`event_code_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_item_sale_purchase` ADD CONSTRAINT `fk_item_sale_purchase_child_parent` FOREIGN KEY (`event_code_child_id`, `event_code_id`) REFERENCES `arya_event_code_child`(`event_code_child_id`, `event_code_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_item_sale_purchase` ADD CONSTRAINT `fk_item_sale_purchase_identity` FOREIGN KEY (`member_identity_id`) REFERENCES `arya_member_identity`(`member_identity_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_item_sale_purchase` ADD CONSTRAINT `fk_item_sale_purchase_buyer` FOREIGN KEY (`buyer_member_id`) REFERENCES `arya_member`(`member_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_item_sale_purchase` ADD CONSTRAINT `fk_item_sale_purchase_confirmed_by` FOREIGN KEY (`confirmed_by`) REFERENCES `arya_user`(`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_item_sale_purchase` ADD CONSTRAINT `fk_item_sale_purchase_reversed_by` FOREIGN KEY (`reversed_by`) REFERENCES `arya_user`(`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_item_sale_purchase` ADD CONSTRAINT `fk_item_sale_purchase_created_by` FOREIGN KEY (`created_by`) REFERENCES `arya_user`(`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_item_sale_purchase` ADD CONSTRAINT `fk_item_sale_purchase_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `arya_user`(`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_item_sale_inventory_movement` ADD CONSTRAINT `fk_item_sale_inventory_child` FOREIGN KEY (`event_code_child_id`) REFERENCES `arya_event_code_child`(`event_code_child_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_item_sale_inventory_movement` ADD CONSTRAINT `fk_item_sale_inventory_purchase` FOREIGN KEY (`item_sale_purchase_id`) REFERENCES `arya_item_sale_purchase`(`item_sale_purchase_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_item_sale_inventory_movement` ADD CONSTRAINT `fk_item_sale_inventory_reversal` FOREIGN KEY (`reversal_of_movement_id`) REFERENCES `arya_item_sale_inventory_movement`(`item_sale_inventory_movement_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_item_sale_inventory_movement` ADD CONSTRAINT `fk_item_sale_inventory_created_by` FOREIGN KEY (`created_by`) REFERENCES `arya_user`(`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_item_sale_audit` ADD CONSTRAINT `fk_item_sale_audit_action_by` FOREIGN KEY (`action_by`) REFERENCES `arya_user`(`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

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
ALTER TABLE `arya_item_sale_fund_allocation` ADD CONSTRAINT `fk_item_sale_fund_allocation_source` FOREIGN KEY (`source_item_sale_fund_id`) REFERENCES `arya_item_sale_fund`(`item_sale_fund_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_item_sale_fund_allocation` ADD CONSTRAINT `fk_item_sale_fund_allocation_purchase` FOREIGN KEY (`item_sale_purchase_id`) REFERENCES `arya_item_sale_purchase`(`item_sale_purchase_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_item_sale_fund_allocation` ADD CONSTRAINT `fk_item_sale_fund_allocation_created_by` FOREIGN KEY (`created_by`) REFERENCES `arya_user`(`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_item_sale_fund_allocation` ADD CONSTRAINT `fk_item_sale_fund_allocation_reversed_by` FOREIGN KEY (`reversed_by`) REFERENCES `arya_user`(`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_item_sale_fund_ledger` ADD CONSTRAINT `fk_item_sale_fund_ledger_fund` FOREIGN KEY (`item_sale_fund_id`) REFERENCES `arya_item_sale_fund`(`item_sale_fund_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_item_sale_fund_ledger` ADD CONSTRAINT `fk_item_sale_fund_ledger_purchase` FOREIGN KEY (`item_sale_purchase_id`) REFERENCES `arya_item_sale_purchase`(`item_sale_purchase_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_item_sale_fund_ledger` ADD CONSTRAINT `fk_item_sale_fund_ledger_reversal` FOREIGN KEY (`reversal_of_entry_id`) REFERENCES `arya_item_sale_fund_ledger`(`item_sale_fund_ledger_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_item_sale_fund_ledger` ADD CONSTRAINT `fk_item_sale_fund_ledger_created_by` FOREIGN KEY (`created_by`) REFERENCES `arya_user`(`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_member_event_subscription` ADD CONSTRAINT `fk_member_event_sub_member` FOREIGN KEY (`member_id`) REFERENCES `arya_member`(`member_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_member_event_subscription` ADD CONSTRAINT `fk_member_event_sub_event_code` FOREIGN KEY (`event_code_id`) REFERENCES `arya_event_code`(`event_code_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_member_event_subscription` ADD CONSTRAINT `fk_member_event_sub_event_code_child_parent` FOREIGN KEY (`event_code_child_id`, `event_code_id`) REFERENCES `arya_event_code_child`(`event_code_child_id`, `event_code_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_member_event_subscription` ADD CONSTRAINT `fk_member_event_sub_created_by` FOREIGN KEY (`created_by`) REFERENCES `arya_user`(`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_member_event_subscription` ADD CONSTRAINT `fk_member_event_sub_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `arya_user`(`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_member_event_subscription_audit` ADD CONSTRAINT `fk_member_event_subscription_audit_subscription` FOREIGN KEY (`member_event_subscription_id`) REFERENCES `arya_member_event_subscription`(`member_event_subscription_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_member_event_subscription_audit` ADD CONSTRAINT `fk_member_event_subscription_audit_action_by` FOREIGN KEY (`action_by`) REFERENCES `arya_user`(`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_member_event_coverage` ADD CONSTRAINT `fk_member_event_cov_subscription` FOREIGN KEY (`member_event_subscription_id`) REFERENCES `arya_member_event_subscription`(`member_event_subscription_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_member_event_coverage` ADD CONSTRAINT `fk_member_event_cov_transaction` FOREIGN KEY (`bank_transaction_id`) REFERENCES `arya_bank_transaction`(`bank_transaction_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_member_event_coverage` ADD CONSTRAINT `fk_member_event_cov_created_by` FOREIGN KEY (`created_by`) REFERENCES `arya_user`(`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_member_event_coverage` ADD CONSTRAINT `fk_member_event_cov_voided_by` FOREIGN KEY (`voided_by`) REFERENCES `arya_user`(`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_member_event_balance_ledger` ADD CONSTRAINT `fk_member_event_balance_subscription` FOREIGN KEY (`member_event_subscription_id`) REFERENCES `arya_member_event_subscription`(`member_event_subscription_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_member_event_balance_ledger` ADD CONSTRAINT `fk_member_event_balance_transaction` FOREIGN KEY (`bank_transaction_id`) REFERENCES `arya_bank_transaction`(`bank_transaction_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_member_event_balance_ledger` ADD CONSTRAINT `fk_member_event_balance_coverage` FOREIGN KEY (`member_event_coverage_id`) REFERENCES `arya_member_event_coverage`(`member_event_coverage_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_member_event_balance_ledger` ADD CONSTRAINT `fk_member_event_balance_carry_transfer` FOREIGN KEY (`member_event_carry_transfer_id`) REFERENCES `arya_member_event_carry_transfer`(`member_event_carry_transfer_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_member_event_balance_ledger` ADD CONSTRAINT `fk_member_event_balance_created_by` FOREIGN KEY (`created_by`) REFERENCES `arya_user`(`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_member_event_balance_ledger` ADD CONSTRAINT `fk_member_event_balance_voided_by` FOREIGN KEY (`voided_by`) REFERENCES `arya_user`(`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_member_event_carry_transfer` ADD CONSTRAINT `fk_member_event_carry_transfer_member` FOREIGN KEY (`member_id`) REFERENCES `arya_member`(`member_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_member_event_carry_transfer` ADD CONSTRAINT `fk_member_event_carry_transfer_source_subscription` FOREIGN KEY (`source_subscription_id`) REFERENCES `arya_member_event_subscription`(`member_event_subscription_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_member_event_carry_transfer` ADD CONSTRAINT `fk_member_event_carry_transfer_source_campaign` FOREIGN KEY (`source_campaign_id`) REFERENCES `arya_event_campaign`(`event_campaign_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_member_event_carry_transfer` ADD CONSTRAINT `fk_member_event_carry_transfer_destination_subscription` FOREIGN KEY (`destination_subscription_id`) REFERENCES `arya_member_event_subscription`(`member_event_subscription_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_member_event_carry_transfer` ADD CONSTRAINT `fk_member_event_carry_transfer_destination_campaign` FOREIGN KEY (`destination_campaign_id`) REFERENCES `arya_event_campaign`(`event_campaign_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_member_event_carry_transfer` ADD CONSTRAINT `fk_member_event_carry_transfer_created_by` FOREIGN KEY (`created_by`) REFERENCES `arya_user`(`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_member_event_carry_transfer` ADD CONSTRAINT `fk_member_event_carry_transfer_reversed_by` FOREIGN KEY (`reversed_by`) REFERENCES `arya_user`(`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_member_event_carry_transfer` ADD CONSTRAINT `fk_member_event_carry_transfer_reversal_of` FOREIGN KEY (`reversal_of_transfer_id`) REFERENCES `arya_member_event_carry_transfer`(`member_event_carry_transfer_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_member_event_campaign_allocation` ADD CONSTRAINT `fk_member_event_campaign_allocation_member` FOREIGN KEY (`member_id`) REFERENCES `arya_member`(`member_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_member_event_campaign_allocation` ADD CONSTRAINT `fk_member_event_campaign_allocation_campaign` FOREIGN KEY (`event_campaign_id`) REFERENCES `arya_event_campaign`(`event_campaign_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_member_event_campaign_allocation` ADD CONSTRAINT `fk_member_event_campaign_allocation_transfer` FOREIGN KEY (`member_event_carry_transfer_id`) REFERENCES `arya_member_event_carry_transfer`(`member_event_carry_transfer_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_member_event_campaign_allocation` ADD CONSTRAINT `fk_member_event_campaign_allocation_transaction` FOREIGN KEY (`bank_transaction_id`) REFERENCES `arya_bank_transaction`(`bank_transaction_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_member_event_campaign_allocation` ADD CONSTRAINT `fk_member_event_campaign_allocation_created_by` FOREIGN KEY (`created_by`) REFERENCES `arya_user`(`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_member_event_campaign_allocation` ADD CONSTRAINT `fk_member_event_campaign_allocation_voided_by` FOREIGN KEY (`voided_by`) REFERENCES `arya_user`(`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_member_event_campaign_allocation` ADD CONSTRAINT `fk_member_event_campaign_allocation_reversal_of` FOREIGN KEY (`reversal_of_allocation_id`) REFERENCES `arya_member_event_campaign_allocation`(`member_event_campaign_allocation_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_member_event_campaign_wallet_ledger` ADD CONSTRAINT `fk_member_event_campaign_wallet_member` FOREIGN KEY (`member_id`) REFERENCES `arya_member`(`member_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_member_event_campaign_wallet_ledger` ADD CONSTRAINT `fk_member_event_campaign_wallet_campaign` FOREIGN KEY (`event_campaign_id`) REFERENCES `arya_event_campaign`(`event_campaign_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_member_event_campaign_wallet_ledger` ADD CONSTRAINT `fk_member_event_campaign_wallet_transaction` FOREIGN KEY (`bank_transaction_id`) REFERENCES `arya_bank_transaction`(`bank_transaction_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_member_event_campaign_wallet_ledger` ADD CONSTRAINT `fk_member_event_campaign_wallet_transfer` FOREIGN KEY (`member_event_carry_transfer_id`) REFERENCES `arya_member_event_carry_transfer`(`member_event_carry_transfer_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_member_event_campaign_wallet_ledger` ADD CONSTRAINT `fk_member_event_campaign_wallet_created_by` FOREIGN KEY (`created_by`) REFERENCES `arya_user`(`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_member_event_campaign_wallet_ledger` ADD CONSTRAINT `fk_member_event_campaign_wallet_voided_by` FOREIGN KEY (`voided_by`) REFERENCES `arya_user`(`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_member_event_campaign_participation` ADD CONSTRAINT `fk_member_event_campaign_participation_member` FOREIGN KEY (`member_id`) REFERENCES `arya_member`(`member_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_member_event_campaign_participation` ADD CONSTRAINT `fk_member_event_campaign_participation_campaign` FOREIGN KEY (`event_campaign_id`) REFERENCES `arya_event_campaign`(`event_campaign_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_member_event_campaign_participation` ADD CONSTRAINT `fk_member_event_campaign_participation_created_by` FOREIGN KEY (`created_by`) REFERENCES `arya_user`(`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_bank_account` ADD CONSTRAINT `arya_bank_account_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `arya_user`(`user_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `arya_bank_account` ADD CONSTRAINT `arya_bank_account_updated_by_fkey` FOREIGN KEY (`updated_by`) REFERENCES `arya_user`(`user_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `arya_bank_statement_upload` ADD CONSTRAINT `arya_bank_statement_upload_bank_account_id_fkey` FOREIGN KEY (`bank_account_id`) REFERENCES `arya_bank_account`(`bank_account_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `arya_bank_statement_upload` ADD CONSTRAINT `arya_bank_statement_upload_uploaded_by_fkey` FOREIGN KEY (`uploaded_by`) REFERENCES `arya_user`(`user_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `arya_bank_statement_upload` ADD CONSTRAINT `arya_bank_statement_upload_executed_by_fkey` FOREIGN KEY (`executed_by`) REFERENCES `arya_user`(`user_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `arya_bank_statement_upload` ADD CONSTRAINT `arya_bank_statement_upload_finalized_by_fkey` FOREIGN KEY (`finalized_by`) REFERENCES `arya_user`(`user_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `arya_bank_statement_upload` ADD CONSTRAINT `fk_bank_statement_withdrawn_by` FOREIGN KEY (`withdrawn_by`) REFERENCES `arya_user`(`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_bank_statement_upload_attempt` ADD CONSTRAINT `fk_bank_statement_attempt_bank_account` FOREIGN KEY (`bank_account_id`) REFERENCES `arya_bank_account`(`bank_account_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_bank_statement_upload_attempt` ADD CONSTRAINT `fk_bank_statement_attempt_uploaded_by` FOREIGN KEY (`uploaded_by`) REFERENCES `arya_user`(`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_bank_statement_upload_attempt` ADD CONSTRAINT `fk_bank_statement_attempt_statement` FOREIGN KEY (`statement_upload_id`) REFERENCES `arya_bank_statement_upload`(`statement_upload_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_bank_statement_upload_duplicate` ADD CONSTRAINT `fk_bank_statement_duplicate_attempt` FOREIGN KEY (`upload_attempt_id`) REFERENCES `arya_bank_statement_upload_attempt`(`upload_attempt_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_bank_statement_upload_duplicate` ADD CONSTRAINT `fk_bank_statement_duplicate_matched_statement` FOREIGN KEY (`matched_statement_upload_id`) REFERENCES `arya_bank_statement_upload`(`statement_upload_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_bank_statement_upload_duplicate` ADD CONSTRAINT `fk_bank_statement_duplicate_matched_transaction` FOREIGN KEY (`matched_bank_transaction_id`) REFERENCES `arya_bank_transaction`(`bank_transaction_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_bank_statement_upload_duplicate` ADD CONSTRAINT `fk_bank_statement_duplicate_imported_transaction` FOREIGN KEY (`imported_bank_transaction_id`) REFERENCES `arya_bank_transaction`(`bank_transaction_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_bank_statement_upload_duplicate` ADD CONSTRAINT `fk_bank_statement_duplicate_resolved_by` FOREIGN KEY (`resolved_by`) REFERENCES `arya_user`(`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_bank_transaction` ADD CONSTRAINT `fk_bank_transaction_member_identity` FOREIGN KEY (`member_identity_id`) REFERENCES `arya_member_identity`(`member_identity_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_bank_transaction` ADD CONSTRAINT `arya_bank_transaction_statement_upload_id_fkey` FOREIGN KEY (`statement_upload_id`) REFERENCES `arya_bank_statement_upload`(`statement_upload_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `arya_bank_transaction` ADD CONSTRAINT `arya_bank_transaction_suggested_event_code_id_fkey` FOREIGN KEY (`suggested_event_code_id`) REFERENCES `arya_event_code`(`event_code_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `arya_bank_transaction` ADD CONSTRAINT `arya_bank_transaction_event_code_id_fkey` FOREIGN KEY (`event_code_id`) REFERENCES `arya_event_code`(`event_code_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `arya_bank_transaction` ADD CONSTRAINT `fk_bank_transaction_event_code_child_parent` FOREIGN KEY (`event_code_child_id`, `event_code_id`) REFERENCES `arya_event_code_child`(`event_code_child_id`, `event_code_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_bank_transaction` ADD CONSTRAINT `fk_bank_transaction_event_campaign` FOREIGN KEY (`event_campaign_id`) REFERENCES `arya_event_campaign`(`event_campaign_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_bank_transaction` ADD CONSTRAINT `fk_bank_transaction_manual_added_by` FOREIGN KEY (`manual_added_by`) REFERENCES `arya_user`(`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_bank_transaction` ADD CONSTRAINT `fk_bank_transaction_excluded_by` FOREIGN KEY (`reconciliation_excluded_by`) REFERENCES `arya_user`(`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_bank_transaction_history` ADD CONSTRAINT `arya_bank_transaction_history_bank_transaction_id_fkey` FOREIGN KEY (`bank_transaction_id`) REFERENCES `arya_bank_transaction`(`bank_transaction_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `arya_bank_transaction_history` ADD CONSTRAINT `arya_bank_transaction_history_changed_by_fkey` FOREIGN KEY (`changed_by`) REFERENCES `arya_user`(`user_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `arya_reconciliation_approval` ADD CONSTRAINT `arya_reconciliation_approval_statement_upload_id_fkey` FOREIGN KEY (`statement_upload_id`) REFERENCES `arya_bank_statement_upload`(`statement_upload_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `arya_reconciliation_approval` ADD CONSTRAINT `arya_reconciliation_approval_submitted_by_fkey` FOREIGN KEY (`submitted_by`) REFERENCES `arya_user`(`user_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `arya_reconciliation_approval` ADD CONSTRAINT `arya_reconciliation_approval_decided_by_fkey` FOREIGN KEY (`decided_by`) REFERENCES `arya_user`(`user_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `arya_reconciliation_approval_approver` ADD CONSTRAINT `fk_reconciliation_approval_approver_approval` FOREIGN KEY (`reconciliation_approval_id`) REFERENCES `arya_reconciliation_approval`(`approval_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_reconciliation_approval_approver` ADD CONSTRAINT `fk_reconciliation_approval_approver_user` FOREIGN KEY (`user_id`) REFERENCES `arya_user`(`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_reconciliation_correction_proposal` ADD CONSTRAINT `fk_correction_proposal_approval` FOREIGN KEY (`approval_id`) REFERENCES `arya_reconciliation_approval`(`approval_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_reconciliation_correction_proposal` ADD CONSTRAINT `fk_correction_proposal_statement` FOREIGN KEY (`statement_upload_id`) REFERENCES `arya_bank_statement_upload`(`statement_upload_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_reconciliation_correction_proposal` ADD CONSTRAINT `fk_correction_proposal_proposed_by` FOREIGN KEY (`proposed_by`) REFERENCES `arya_user`(`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_reconciliation_correction_proposal` ADD CONSTRAINT `fk_correction_proposal_decided_by` FOREIGN KEY (`decided_by`) REFERENCES `arya_user`(`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_reconciliation_correction_item` ADD CONSTRAINT `fk_correction_item_proposal` FOREIGN KEY (`correction_proposal_id`) REFERENCES `arya_reconciliation_correction_proposal`(`correction_proposal_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_reconciliation_correction_item` ADD CONSTRAINT `fk_correction_item_transaction` FOREIGN KEY (`bank_transaction_id`) REFERENCES `arya_bank_transaction`(`bank_transaction_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_reconciliation_correction_item` ADD CONSTRAINT `fk_correction_item_before_event` FOREIGN KEY (`before_event_code_id`) REFERENCES `arya_event_code`(`event_code_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_reconciliation_correction_item` ADD CONSTRAINT `fk_correction_item_proposed_event` FOREIGN KEY (`proposed_event_code_id`) REFERENCES `arya_event_code`(`event_code_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_reconciliation_correction_item` ADD CONSTRAINT `fk_correction_item_before_event_child_parent` FOREIGN KEY (`before_event_code_child_id`, `before_event_code_id`) REFERENCES `arya_event_code_child`(`event_code_child_id`, `event_code_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_reconciliation_correction_item` ADD CONSTRAINT `fk_correction_item_proposed_event_child_parent` FOREIGN KEY (`proposed_event_code_child_id`, `proposed_event_code_id`) REFERENCES `arya_event_code_child`(`event_code_child_id`, `event_code_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_reconciliation_correction_item` ADD CONSTRAINT `fk_correction_item_before_campaign` FOREIGN KEY (`before_event_campaign_id`) REFERENCES `arya_event_campaign`(`event_campaign_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_reconciliation_correction_item` ADD CONSTRAINT `fk_correction_item_proposed_campaign` FOREIGN KEY (`proposed_event_campaign_id`) REFERENCES `arya_event_campaign`(`event_campaign_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_reconciliation_correction_approver` ADD CONSTRAINT `fk_correction_approver_proposal` FOREIGN KEY (`correction_proposal_id`) REFERENCES `arya_reconciliation_correction_proposal`(`correction_proposal_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_reconciliation_correction_approver` ADD CONSTRAINT `fk_correction_approver_user` FOREIGN KEY (`user_id`) REFERENCES `arya_user`(`user_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `arya_reconciliation_approval_history` ADD CONSTRAINT `arya_reconciliation_approval_history_approval_id_fkey` FOREIGN KEY (`approval_id`) REFERENCES `arya_reconciliation_approval`(`approval_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `arya_reconciliation_approval_history` ADD CONSTRAINT `arya_reconciliation_approval_history_action_by_fkey` FOREIGN KEY (`action_by`) REFERENCES `arya_user`(`user_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `arya_approval_config` ADD CONSTRAINT `arya_approval_config_menu_id_fkey` FOREIGN KEY (`menu_id`) REFERENCES `arya_menu`(`menu_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `arya_approval_config` ADD CONSTRAINT `arya_approval_config_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `arya_user`(`user_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `arya_approval_config` ADD CONSTRAINT `arya_approval_config_updated_by_fkey` FOREIGN KEY (`updated_by`) REFERENCES `arya_user`(`user_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `arya_approval_config_approver` ADD CONSTRAINT `arya_approval_config_approver_approval_config_id_fkey` FOREIGN KEY (`approval_config_id`) REFERENCES `arya_approval_config`(`approval_config_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `arya_approval_config_approver` ADD CONSTRAINT `arya_approval_config_approver_approver_user_id_fkey` FOREIGN KEY (`approver_user_id`) REFERENCES `arya_user`(`user_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `arya_approval_config_approver` ADD CONSTRAINT `arya_approval_config_approver_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `arya_user`(`user_id`) ON DELETE SET NULL ON UPDATE CASCADE;

