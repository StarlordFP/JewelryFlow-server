-- AlterTable: item name for stock display (description remains for PO line notes)
ALTER TABLE "purchase_order_lines" ADD COLUMN "itemName" TEXT;

-- Backfill existing rows so itemName is non-null before NOT NULL constraint
UPDATE "purchase_order_lines" SET "itemName" = "description" WHERE "itemName" IS NULL;

ALTER TABLE "purchase_order_lines" ALTER COLUMN "itemName" SET NOT NULL;
