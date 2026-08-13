-- DATA INTEGRITY GUARDS
-- These triggers prevent accidental bulk deletion of critical tables.
-- To perform legitimate bulk maintenance (e.g. clearing test data from
-- dev DB), run: ALTER TABLE transactions DISABLE TRIGGER ALL;
-- Remember to re-enable: ALTER TABLE transactions ENABLE TRIGGER ALL;
-- NEVER disable these triggers in a production database.

-- ─── Integrity alerts table ───────────────────────────────────────────────────

CREATE TABLE "integrity_alerts" (
    "id" TEXT NOT NULL,
    "checkName" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,

    CONSTRAINT "integrity_alerts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "integrity_alerts_detectedAt_idx" ON "integrity_alerts"("detectedAt" DESC);
CREATE INDEX "integrity_alerts_resolvedAt_idx" ON "integrity_alerts"("resolvedAt");

-- ─── Bulk-delete guards (statement-level, >10 rows per DELETE) ────────────────
-- Skipped automatically when current_database() contains 'test'.

CREATE OR REPLACE FUNCTION prevent_bulk_critical_delete()
RETURNS TRIGGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  IF current_database() LIKE '%test%' THEN
    RETURN NULL;
  END IF;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  IF deleted_count > 10 THEN
    RAISE EXCEPTION 'Bulk deletion of % is not allowed. Delete records individually or use a specific where clause. If this is intentional maintenance, disable this trigger first.', TG_TABLE_NAME;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER guard_bulk_transaction_delete
  AFTER DELETE ON transactions
  FOR EACH STATEMENT
  EXECUTE FUNCTION prevent_bulk_critical_delete();

CREATE TRIGGER guard_bulk_stock_items_delete
  AFTER DELETE ON stock_items
  FOR EACH STATEMENT
  EXECUTE FUNCTION prevent_bulk_critical_delete();

CREATE TRIGGER guard_bulk_customers_delete
  AFTER DELETE ON customers
  FOR EACH STATEMENT
  EXECUTE FUNCTION prevent_bulk_critical_delete();
