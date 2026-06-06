-- ─── DAILY RATES ──────────────────────────────────────────────────────────────
CREATE INDEX "idx_daily_rates_metal_current"
  ON "daily_rates"("metalTypeId", "isCurrent");

CREATE INDEX "idx_daily_rates_effective_date"
  ON "daily_rates"("effectiveDate" DESC);

-- ─── STOCK ITEMS ──────────────────────────────────────────────────────────────
CREATE INDEX "idx_stock_items_status"
  ON "stock_items"("status");

CREATE INDEX "idx_stock_items_category_metal"
  ON "stock_items"("categoryId", "metalTypeId");

CREATE INDEX "idx_stock_items_category_metal_weight"
  ON "stock_items"("categoryId", "metalTypeId", "grossWeightGram");

CREATE INDEX "idx_stock_items_created_at"
  ON "stock_items"("createdAt" DESC);

-- ─── TRANSACTIONS ─────────────────────────────────────────────────────────────
CREATE INDEX "idx_transactions_customer_id"
  ON "transactions"("customerId");

CREATE INDEX "idx_transactions_tx_type"
  ON "transactions"("txType");

CREATE INDEX "idx_transactions_created_at"
  ON "transactions"("createdAt" DESC);

CREATE INDEX "idx_transactions_balance"
  ON "transactions"("balanceNpr")
  WHERE "balanceNpr" > 0;

CREATE INDEX "idx_transactions_exchange_group"
  ON "transactions"("exchangeGroupId")
  WHERE "exchangeGroupId" IS NOT NULL;

-- ─── TRANSACTION LINES ────────────────────────────────────────────────────────
CREATE INDEX "idx_transaction_lines_transaction_id"
  ON "transaction_lines"("transactionId");

CREATE INDEX "idx_transaction_lines_stock_item_id"
  ON "transaction_lines"("stockItemId")
  WHERE "stockItemId" IS NOT NULL;

-- ─── PRODUCTION ORDERS ────────────────────────────────────────────────────────
CREATE INDEX "idx_production_orders_karigar_id"
  ON "production_orders"("karigarId");

CREATE INDEX "idx_production_orders_status"
  ON "production_orders"("status");

-- ─── PRODUCTION ISSUES ────────────────────────────────────────────────────────
CREATE INDEX "idx_production_issues_order_id"
  ON "production_issues"("productionOrderId");

-- ─── PRODUCTION RETURNS ───────────────────────────────────────────────────────
CREATE INDEX "idx_production_returns_order_id"
  ON "production_returns"("productionOrderId");

CREATE INDEX "idx_production_returns_issue_id"
  ON "production_returns"("productionIssueId");

-- ─── KARIGAR DISPUTES ─────────────────────────────────────────────────────────
CREATE INDEX "idx_karigar_disputes_karigar_id"
  ON "karigar_disputes"("karigarId");

CREATE INDEX "idx_karigar_disputes_status_pending"
  ON "karigar_disputes"("status")
  WHERE "status" = 'PENDING';

-- ─── KARIGAR PAYMENTS ─────────────────────────────────────────────────────────
CREATE INDEX "idx_karigar_payments_karigar_id"
  ON "karigar_payments"("karigarId");

CREATE INDEX "idx_karigar_payments_order_id"
  ON "karigar_payments"("productionOrderId");

-- ─── PURCHASE ORDERS ──────────────────────────────────────────────────────────
CREATE INDEX "idx_purchase_orders_supplier_id"
  ON "purchase_orders"("supplierId");

CREATE INDEX "idx_purchase_orders_status"
  ON "purchase_orders"("status");

-- ─── TRADES ───────────────────────────────────────────────────────────────────
CREATE INDEX "idx_trades_supplier_id"
  ON "trades"("supplierId");

CREATE INDEX "idx_trades_status"
  ON "trades"("status");

-- ─── PAYMENT RECORDS ──────────────────────────────────────────────────────────
CREATE INDEX "idx_payment_records_transaction_id"
  ON "payment_records"("transactionId");

-- ─── CUSTOMERS ────────────────────────────────────────────────────────────────
CREATE INDEX "idx_customers_name"
  ON "customers"("name");

CREATE INDEX "idx_customers_is_active"
  ON "customers"("isActive")
  WHERE "isActive" = true;

-- ─── USER ROLES ───────────────────────────────────────────────────────────────
CREATE INDEX "idx_user_roles_user_id"
  ON "user_roles"("userId");