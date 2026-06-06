-- CreateIndex
CREATE INDEX "customers_isActive_idx" ON "customers"("isActive");

-- CreateIndex
CREATE INDEX "karigar_disputes_status_idx" ON "karigar_disputes"("status");

-- CreateIndex
CREATE INDEX "transaction_lines_stockItemId_idx" ON "transaction_lines"("stockItemId");

-- CreateIndex
CREATE INDEX "transactions_balanceNpr_idx" ON "transactions"("balanceNpr");

-- CreateIndex
CREATE INDEX "transactions_exchangeGroupId_idx" ON "transactions"("exchangeGroupId");

-- RenameIndex
ALTER INDEX "idx_customers_name" RENAME TO "customers_name_idx";

-- RenameIndex
ALTER INDEX "idx_daily_rates_effective_date" RENAME TO "daily_rates_effectiveDate_idx";

-- RenameIndex
ALTER INDEX "idx_daily_rates_metal_current" RENAME TO "daily_rates_metalTypeId_isCurrent_idx";

-- RenameIndex
ALTER INDEX "idx_karigar_disputes_karigar_id" RENAME TO "karigar_disputes_karigarId_idx";

-- RenameIndex
ALTER INDEX "idx_karigar_payments_karigar_id" RENAME TO "karigar_payments_karigarId_idx";

-- RenameIndex
ALTER INDEX "idx_karigar_payments_order_id" RENAME TO "karigar_payments_productionOrderId_idx";

-- RenameIndex
ALTER INDEX "idx_payment_records_transaction_id" RENAME TO "payment_records_transactionId_idx";

-- RenameIndex
ALTER INDEX "idx_production_issues_order_id" RENAME TO "production_issues_productionOrderId_idx";

-- RenameIndex
ALTER INDEX "idx_production_orders_karigar_id" RENAME TO "production_orders_karigarId_idx";

-- RenameIndex
ALTER INDEX "idx_production_orders_status" RENAME TO "production_orders_status_idx";

-- RenameIndex
ALTER INDEX "idx_production_returns_issue_id" RENAME TO "production_returns_productionIssueId_idx";

-- RenameIndex
ALTER INDEX "idx_production_returns_order_id" RENAME TO "production_returns_productionOrderId_idx";

-- RenameIndex
ALTER INDEX "idx_purchase_orders_status" RENAME TO "purchase_orders_status_idx";

-- RenameIndex
ALTER INDEX "idx_purchase_orders_supplier_id" RENAME TO "purchase_orders_supplierId_idx";

-- RenameIndex
ALTER INDEX "idx_stock_items_category_metal" RENAME TO "stock_items_categoryId_metalTypeId_idx";

-- RenameIndex
ALTER INDEX "idx_stock_items_category_metal_weight" RENAME TO "stock_items_categoryId_metalTypeId_grossWeightGram_idx";

-- RenameIndex
ALTER INDEX "idx_stock_items_created_at" RENAME TO "stock_items_createdAt_idx";

-- RenameIndex
ALTER INDEX "idx_stock_items_status" RENAME TO "stock_items_status_idx";

-- RenameIndex
ALTER INDEX "idx_trades_status" RENAME TO "trades_status_idx";

-- RenameIndex
ALTER INDEX "idx_trades_supplier_id" RENAME TO "trades_supplierId_idx";

-- RenameIndex
ALTER INDEX "idx_transaction_lines_transaction_id" RENAME TO "transaction_lines_transactionId_idx";

-- RenameIndex
ALTER INDEX "idx_transactions_created_at" RENAME TO "transactions_createdAt_idx";

-- RenameIndex
ALTER INDEX "idx_transactions_customer_id" RENAME TO "transactions_customerId_idx";

-- RenameIndex
ALTER INDEX "idx_transactions_tx_type" RENAME TO "transactions_txType_idx";

-- RenameIndex
ALTER INDEX "idx_user_roles_user_id" RENAME TO "user_roles_userId_idx";
