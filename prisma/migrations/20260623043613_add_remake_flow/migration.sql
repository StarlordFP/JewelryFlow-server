-- AlterEnum
ALTER TYPE "StockItemOrigin" ADD VALUE 'REMAKE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StockItemStatus" ADD VALUE 'IN_REMAKE';
ALTER TYPE "StockItemStatus" ADD VALUE 'REMADE';

-- AlterTable
ALTER TABLE "stock_items" ADD COLUMN     "remadeIntoStockItemId" TEXT;

-- CreateTable
CREATE TABLE "production_issue_source_items" (
    "id" TEXT NOT NULL,
    "productionIssueId" TEXT NOT NULL,
    "stockItemId" TEXT NOT NULL,
    "weightAtIssueGram" DECIMAL(10,4) NOT NULL,

    CONSTRAINT "production_issue_source_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "production_issue_source_items_productionIssueId_idx" ON "production_issue_source_items"("productionIssueId");

-- CreateIndex
CREATE INDEX "production_issue_source_items_stockItemId_idx" ON "production_issue_source_items"("stockItemId");

-- AddForeignKey
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_remadeIntoStockItemId_fkey" FOREIGN KEY ("remadeIntoStockItemId") REFERENCES "stock_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_issue_source_items" ADD CONSTRAINT "production_issue_source_items_productionIssueId_fkey" FOREIGN KEY ("productionIssueId") REFERENCES "production_issues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_issue_source_items" ADD CONSTRAINT "production_issue_source_items_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "stock_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
