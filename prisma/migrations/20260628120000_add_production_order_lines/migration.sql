-- CreateEnum
CREATE TYPE "ProductionOrderLineStatus" AS ENUM ('PENDING', 'ISSUED', 'WEIGHED', 'APPROVED');

-- AlterTable
ALTER TABLE "karigar_disputes" ADD COLUMN "productionOrderLineId" TEXT;

-- AlterTable
ALTER TABLE "production_returns" ADD COLUMN "productionOrderLineId" TEXT;

-- CreateTable
CREATE TABLE "production_order_lines" (
    "id" TEXT NOT NULL,
    "productionOrderId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "metalTypeId" TEXT NOT NULL,
    "karat" INTEGER,
    "expectedWeightGram" DECIMAL(10,4) NOT NULL,
    "plannedIssuedWeightGram" DECIMAL(10,4) NOT NULL,
    "status" "ProductionOrderLineStatus" NOT NULL DEFAULT 'PENDING',
    "productionIssueId" TEXT,
    "allowedLossGram" DECIMAL(10,4),
    "productionReturnId" TEXT,
    "actualWeightGram" DECIMAL(10,4),
    "lineLossGram" DECIMAL(10,4),
    "lineSurplusGram" DECIMAL(10,4),
    "lineDeficitGram" DECIMAL(10,4),
    "disputeId" TEXT,
    "stockItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_order_metal_pools" (
    "id" TEXT NOT NULL,
    "productionOrderId" TEXT NOT NULL,
    "metalTypeId" TEXT NOT NULL,
    "pooledSurplusGram" DECIMAL(10,4) NOT NULL DEFAULT 0,

    CONSTRAINT "production_order_metal_pools_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "production_order_lines_productionIssueId_key" ON "production_order_lines"("productionIssueId");

-- CreateIndex
CREATE UNIQUE INDEX "production_order_lines_productionReturnId_key" ON "production_order_lines"("productionReturnId");

-- CreateIndex
CREATE UNIQUE INDEX "production_order_lines_disputeId_key" ON "production_order_lines"("disputeId");

-- CreateIndex
CREATE UNIQUE INDEX "production_order_lines_stockItemId_key" ON "production_order_lines"("stockItemId");

-- CreateIndex
CREATE INDEX "production_order_lines_productionOrderId_idx" ON "production_order_lines"("productionOrderId");

-- CreateIndex
CREATE INDEX "production_order_lines_status_idx" ON "production_order_lines"("status");

-- CreateIndex
CREATE UNIQUE INDEX "production_order_metal_pools_productionOrderId_metalTypeId_key" ON "production_order_metal_pools"("productionOrderId", "metalTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "karigar_disputes_productionOrderLineId_key" ON "karigar_disputes"("productionOrderLineId");

-- CreateIndex
CREATE UNIQUE INDEX "production_returns_productionOrderLineId_key" ON "production_returns"("productionOrderLineId");

-- AddForeignKey
ALTER TABLE "production_order_lines" ADD CONSTRAINT "production_order_lines_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "production_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_order_lines" ADD CONSTRAINT "production_order_lines_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "item_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_order_lines" ADD CONSTRAINT "production_order_lines_metalTypeId_fkey" FOREIGN KEY ("metalTypeId") REFERENCES "metal_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_order_lines" ADD CONSTRAINT "production_order_lines_productionIssueId_fkey" FOREIGN KEY ("productionIssueId") REFERENCES "production_issues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_order_lines" ADD CONSTRAINT "production_order_lines_productionReturnId_fkey" FOREIGN KEY ("productionReturnId") REFERENCES "production_returns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_order_lines" ADD CONSTRAINT "production_order_lines_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "karigar_disputes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_order_lines" ADD CONSTRAINT "production_order_lines_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "stock_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_order_metal_pools" ADD CONSTRAINT "production_order_metal_pools_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "production_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_order_metal_pools" ADD CONSTRAINT "production_order_metal_pools_metalTypeId_fkey" FOREIGN KEY ("metalTypeId") REFERENCES "metal_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
