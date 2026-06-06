-- DropForeignKey
ALTER TABLE "transaction_lines" DROP CONSTRAINT "transaction_lines_stockItemId_fkey";

-- AlterTable
ALTER TABLE "transaction_lines" ALTER COLUMN "stockItemId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "transaction_lines" ADD CONSTRAINT "transaction_lines_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "stock_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
