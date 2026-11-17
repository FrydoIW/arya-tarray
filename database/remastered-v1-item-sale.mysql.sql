-- Arya Tarray Remastered V1 - Enhancement 3 ITEM_SALE
-- Target: arya_tarray_prod only. Additive and safe to rerun after a partial DDL failure.
-- MySQL 8.0.42+ / utf8mb4. No seed data and no destructive table operation.

CREATE TABLE IF NOT EXISTS arya_item_sale_config (
  event_code_child_id CHAR(36) NOT NULL,
  unit_price DECIMAL(20,2) NOT NULL,
  stock_on_hand INT UNSIGNED NOT NULL DEFAULT 0,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_by CHAR(36) NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  updated_by CHAR(36) NOT NULL,
  PRIMARY KEY (event_code_child_id),
  KEY idx_item_sale_config_updated_by (updated_by),
  CONSTRAINT fk_item_sale_config_child FOREIGN KEY (event_code_child_id) REFERENCES arya_event_code_child (event_code_child_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_item_sale_config_created_by FOREIGN KEY (created_by) REFERENCES arya_user (user_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_item_sale_config_updated_by FOREIGN KEY (updated_by) REFERENCES arya_user (user_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_item_sale_config_price CHECK (unit_price > 0),
  CONSTRAINT chk_item_sale_config_version CHECK (version > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS arya_item_sale_purchase (
  item_sale_purchase_id CHAR(36) NOT NULL,
  bank_transaction_id CHAR(36) NOT NULL,
  event_code_id CHAR(36) NOT NULL,
  event_code_child_id CHAR(36) NOT NULL,
  member_identity_id CHAR(36) NULL,
  buyer_member_id CHAR(36) NULL,
  quantity INT UNSIGNED NOT NULL,
  unit_price_snapshot DECIMAL(20,2) NOT NULL,
  total_amount DECIMAL(20,2) NOT NULL,
  payment_amount_snapshot DECIMAL(20,2) NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
  resolution_reason VARCHAR(1000) NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  confirmed_at DATETIME(3) NULL,
  confirmed_by CHAR(36) NULL,
  reversed_at DATETIME(3) NULL,
  reversed_by CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_by CHAR(36) NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  updated_by CHAR(36) NOT NULL,
  PRIMARY KEY (item_sale_purchase_id),
  UNIQUE KEY uk_item_sale_purchase_transaction (bank_transaction_id),
  KEY idx_item_sale_purchase_status_updated (status, updated_at),
  KEY idx_item_sale_purchase_child_status (event_code_child_id, status),
  KEY idx_item_sale_purchase_buyer_status (buyer_member_id, status),
  KEY idx_item_sale_purchase_identity (member_identity_id),
  KEY idx_item_sale_purchase_event (event_code_id),
  KEY idx_item_sale_purchase_confirmed_by (confirmed_by),
  KEY idx_item_sale_purchase_reversed_by (reversed_by),
  KEY idx_item_sale_purchase_created_by (created_by),
  KEY idx_item_sale_purchase_updated_by (updated_by),
  CONSTRAINT fk_item_sale_purchase_transaction FOREIGN KEY (bank_transaction_id) REFERENCES arya_bank_transaction (bank_transaction_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_item_sale_purchase_event FOREIGN KEY (event_code_id) REFERENCES arya_event_code (event_code_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_item_sale_purchase_child FOREIGN KEY (event_code_child_id) REFERENCES arya_event_code_child (event_code_child_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_item_sale_purchase_identity FOREIGN KEY (member_identity_id) REFERENCES arya_member_identity (member_identity_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_item_sale_purchase_buyer FOREIGN KEY (buyer_member_id) REFERENCES arya_member (member_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_item_sale_purchase_confirmed_by FOREIGN KEY (confirmed_by) REFERENCES arya_user (user_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_item_sale_purchase_reversed_by FOREIGN KEY (reversed_by) REFERENCES arya_user (user_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_item_sale_purchase_created_by FOREIGN KEY (created_by) REFERENCES arya_user (user_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_item_sale_purchase_updated_by FOREIGN KEY (updated_by) REFERENCES arya_user (user_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_item_sale_purchase_quantity CHECK (quantity > 0),
  CONSTRAINT chk_item_sale_purchase_price CHECK (unit_price_snapshot > 0),
  CONSTRAINT chk_item_sale_purchase_total CHECK (total_amount = unit_price_snapshot * quantity),
  CONSTRAINT chk_item_sale_purchase_payment CHECK (payment_amount_snapshot IS NULL OR payment_amount_snapshot >= 0),
  CONSTRAINT chk_item_sale_purchase_status CHECK (status IN ('DRAFT','REVIEW_REQUIRED','PENDING_BUYER','PENDING_STOCK','CONFIRMED','REVERSED','VOIDED')),
  CONSTRAINT chk_item_sale_purchase_version CHECK (version > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS arya_item_sale_inventory_movement (
  item_sale_inventory_movement_id CHAR(36) NOT NULL,
  event_code_child_id CHAR(36) NOT NULL,
  item_sale_purchase_id CHAR(36) NULL,
  movement_type VARCHAR(30) NOT NULL,
  quantity_delta INT NOT NULL,
  stock_before INT UNSIGNED NOT NULL,
  stock_after INT UNSIGNED NOT NULL,
  source_reference VARCHAR(191) NOT NULL,
  idempotency_key VARCHAR(191) NOT NULL,
  reversal_of_movement_id CHAR(36) NULL,
  reason VARCHAR(1000) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_by CHAR(36) NOT NULL,
  PRIMARY KEY (item_sale_inventory_movement_id),
  UNIQUE KEY uk_item_sale_inventory_idempotency (idempotency_key),
  UNIQUE KEY uk_item_sale_inventory_reversal (reversal_of_movement_id),
  KEY idx_item_sale_inventory_child_created (event_code_child_id, created_at),
  KEY idx_item_sale_inventory_purchase_created (item_sale_purchase_id, created_at),
  KEY idx_item_sale_inventory_created_by (created_by),
  CONSTRAINT fk_item_sale_inventory_child FOREIGN KEY (event_code_child_id) REFERENCES arya_event_code_child (event_code_child_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_item_sale_inventory_purchase FOREIGN KEY (item_sale_purchase_id) REFERENCES arya_item_sale_purchase (item_sale_purchase_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_item_sale_inventory_reversal FOREIGN KEY (reversal_of_movement_id) REFERENCES arya_item_sale_inventory_movement (item_sale_inventory_movement_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_item_sale_inventory_created_by FOREIGN KEY (created_by) REFERENCES arya_user (user_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_item_sale_inventory_type CHECK (movement_type IN ('OPENING_STOCK','STOCK_IN','SALE','SALE_REVERSAL','MANUAL_ADJUSTMENT')),
  CONSTRAINT chk_item_sale_inventory_delta CHECK (
    (movement_type = 'OPENING_STOCK' AND quantity_delta >= 0)
    OR (movement_type IN ('STOCK_IN','SALE_REVERSAL') AND quantity_delta > 0)
    OR (movement_type = 'SALE' AND quantity_delta < 0)
    OR (movement_type = 'MANUAL_ADJUSTMENT' AND quantity_delta <> 0)
  ),
  CONSTRAINT chk_item_sale_inventory_balance CHECK (stock_after = stock_before + quantity_delta),
  CONSTRAINT chk_item_sale_inventory_purchase CHECK (
    (movement_type IN ('SALE','SALE_REVERSAL') AND item_sale_purchase_id IS NOT NULL)
    OR movement_type NOT IN ('SALE','SALE_REVERSAL')
  ),
  CONSTRAINT chk_item_sale_inventory_reversal_ref CHECK (
    (movement_type = 'SALE_REVERSAL' AND reversal_of_movement_id IS NOT NULL)
    OR (movement_type <> 'SALE_REVERSAL' AND reversal_of_movement_id IS NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS arya_item_sale_audit (
  item_sale_audit_id CHAR(36) NOT NULL,
  entity_type VARCHAR(30) NOT NULL,
  entity_id CHAR(36) NOT NULL,
  action VARCHAR(50) NOT NULL,
  before_data JSON NULL,
  after_data JSON NULL,
  reason VARCHAR(1000) NOT NULL,
  action_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  action_by CHAR(36) NOT NULL,
  PRIMARY KEY (item_sale_audit_id),
  KEY idx_item_sale_audit_entity_action (entity_type, entity_id, action_at),
  KEY idx_item_sale_audit_action_by (action_by),
  CONSTRAINT fk_item_sale_audit_action_by FOREIGN KEY (action_by) REFERENCES arya_user (user_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_item_sale_audit_entity CHECK (entity_type IN ('ITEM_CONFIG','PURCHASE'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- MySQL 8.0 has no ADD COLUMN IF NOT EXISTS. Use information_schema so this
-- part is also safe to rerun after an interrupted migration.
SET @item_sale_before_qty_sql = (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE arya_reconciliation_correction_item ADD COLUMN before_item_sale_quantity INT UNSIGNED NULL AFTER proposed_event_campaign_id',
    'SELECT 1')
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'arya_reconciliation_correction_item'
    AND column_name = 'before_item_sale_quantity'
);
PREPARE item_sale_stmt FROM @item_sale_before_qty_sql;
EXECUTE item_sale_stmt;
DEALLOCATE PREPARE item_sale_stmt;

SET @item_sale_proposed_qty_sql = (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE arya_reconciliation_correction_item ADD COLUMN proposed_item_sale_quantity INT UNSIGNED NULL AFTER before_item_sale_quantity',
    'SELECT 1')
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'arya_reconciliation_correction_item'
    AND column_name = 'proposed_item_sale_quantity'
);
PREPARE item_sale_stmt FROM @item_sale_proposed_qty_sql;
EXECUTE item_sale_stmt;
DEALLOCATE PREPARE item_sale_stmt;

SET @item_sale_qty_check_sql = (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE arya_reconciliation_correction_item ADD CONSTRAINT chk_correction_item_sale_qty CHECK ((before_item_sale_quantity IS NULL OR before_item_sale_quantity > 0) AND (proposed_item_sale_quantity IS NULL OR proposed_item_sale_quantity > 0))',
    'SELECT 1')
  FROM information_schema.table_constraints
  WHERE constraint_schema = DATABASE()
    AND table_name = 'arya_reconciliation_correction_item'
    AND constraint_name = 'chk_correction_item_sale_qty'
);
PREPARE item_sale_stmt FROM @item_sale_qty_check_sql;
EXECUTE item_sale_stmt;
DEALLOCATE PREPARE item_sale_stmt;
