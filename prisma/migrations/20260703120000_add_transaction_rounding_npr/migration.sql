-- Add bill-total rounding adjustment to transactions (sell flow).
ALTER TABLE "transactions" ADD COLUMN "roundingNpr" DECIMAL(12, 2) NOT NULL DEFAULT 0;
