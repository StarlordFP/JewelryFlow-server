/*
  Warnings:

  - You are about to drop the column `tradePartyId` on the `trades` table. All the data in the column will be lost.
  - You are about to drop the `trade_parties` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `supplierId` to the `trades` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "SupplierType" AS ENUM ('TRADE', 'DIRECT');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('PENDING', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProductionOrderStatus" AS ENUM ('OPEN', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('PENDING', 'RESOLVED');

-- DropForeignKey
ALTER TABLE "trades" DROP CONSTRAINT "trades_tradePartyId_fkey";

-- AlterTable
ALTER TABLE "stock_items" ADD COLUMN     "entryRateId" TEXT;

-- AlterTable
ALTER TABLE "trades" DROP COLUMN "tradePartyId",
ADD COLUMN     "supplierId" TEXT NOT NULL;

-- DropTable
DROP TABLE "trade_parties";

-- CreateTable
CREATE TABLE "addon_jyala_brackets" (
    "id" TEXT NOT NULL,
    "addonTypeId" TEXT NOT NULL,
    "minCount" INTEGER NOT NULL,
    "maxCount" INTEGER NOT NULL,
    "jyalaPerUnit" DECIMAL(10,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "addon_jyala_brackets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "supplierType" "SupplierType" NOT NULL DEFAULT 'DIRECT',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "totalNpr" DECIMAL(12,2) NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_lines" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "categoryId" TEXT,
    "metalTypeId" TEXT,
    "karat" INTEGER,
    "grossWeightGram" DECIMAL(10,4) NOT NULL,
    "grossWeightTola" DECIMAL(10,4) NOT NULL,
    "grossWeightLal" DECIMAL(10,4) NOT NULL,
    "jertyGram" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "jertyTola" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "jertyLal" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "priceNpr" DECIMAL(12,2) NOT NULL,
    "stockItemId" TEXT,

    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "karigars" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "tolerancePct" DECIMAL(5,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "karigars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_orders" (
    "id" TEXT NOT NULL,
    "karigarId" TEXT NOT NULL,
    "tolerancePct" DECIMAL(5,2) NOT NULL,
    "status" "ProductionOrderStatus" NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_issues" (
    "id" TEXT NOT NULL,
    "productionOrderId" TEXT NOT NULL,
    "metalTypeId" TEXT NOT NULL,
    "issuedWeightGram" DECIMAL(10,4) NOT NULL,
    "issuedWeightTola" DECIMAL(10,4) NOT NULL,
    "issuedWeightLal" DECIMAL(10,4) NOT NULL,
    "rateAtIssuePerGram" DECIMAL(12,2) NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_returns" (
    "id" TEXT NOT NULL,
    "productionOrderId" TEXT NOT NULL,
    "productionIssueId" TEXT NOT NULL,
    "returnedWeightGram" DECIMAL(10,4) NOT NULL,
    "returnedWeightTola" DECIMAL(10,4) NOT NULL,
    "returnedWeightLal" DECIMAL(10,4) NOT NULL,
    "kharcharGram" DECIMAL(10,4) NOT NULL,
    "kharcharTola" DECIMAL(10,4) NOT NULL,
    "kharcharLal" DECIMAL(10,4) NOT NULL,
    "withinTolerance" BOOLEAN NOT NULL DEFAULT true,
    "returnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_items" (
    "id" TEXT NOT NULL,
    "productionReturnId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "grossWeightGram" DECIMAL(10,4) NOT NULL,
    "grossWeightTola" DECIMAL(10,4) NOT NULL,
    "grossWeightLal" DECIMAL(10,4) NOT NULL,

    CONSTRAINT "production_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "karigar_payments" (
    "id" TEXT NOT NULL,
    "karigarId" TEXT NOT NULL,
    "productionOrderId" TEXT NOT NULL,
    "cashAmountNpr" DECIMAL(12,2),
    "metalWeightGram" DECIMAL(10,4),
    "metalWeightTola" DECIMAL(10,4),
    "metalWeightLal" DECIMAL(10,4),
    "metalTypeId" TEXT,
    "deductionNpr" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "deductionNotes" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "karigar_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "karigar_disputes" (
    "id" TEXT NOT NULL,
    "karigarId" TEXT NOT NULL,
    "productionOrderId" TEXT NOT NULL,
    "excessWeightGram" DECIMAL(10,4) NOT NULL,
    "excessWeightTola" DECIMAL(10,4) NOT NULL,
    "excessWeightLal" DECIMAL(10,4) NOT NULL,
    "deductionNpr" DECIMAL(12,2),
    "status" "DisputeStatus" NOT NULL DEFAULT 'PENDING',
    "resolutionNotes" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "karigar_disputes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_lines_stockItemId_key" ON "purchase_order_lines"("stockItemId");

-- AddForeignKey
ALTER TABLE "addon_jyala_brackets" ADD CONSTRAINT "addon_jyala_brackets_addonTypeId_fkey" FOREIGN KEY ("addonTypeId") REFERENCES "addon_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "stock_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_entryRateId_fkey" FOREIGN KEY ("entryRateId") REFERENCES "daily_rates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_productionItemId_fkey" FOREIGN KEY ("productionItemId") REFERENCES "production_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trades" ADD CONSTRAINT "trades_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_karigarId_fkey" FOREIGN KEY ("karigarId") REFERENCES "karigars"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_issues" ADD CONSTRAINT "production_issues_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "production_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_issues" ADD CONSTRAINT "production_issues_metalTypeId_fkey" FOREIGN KEY ("metalTypeId") REFERENCES "metal_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_returns" ADD CONSTRAINT "production_returns_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "production_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_returns" ADD CONSTRAINT "production_returns_productionIssueId_fkey" FOREIGN KEY ("productionIssueId") REFERENCES "production_issues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_items" ADD CONSTRAINT "production_items_productionReturnId_fkey" FOREIGN KEY ("productionReturnId") REFERENCES "production_returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "karigar_payments" ADD CONSTRAINT "karigar_payments_karigarId_fkey" FOREIGN KEY ("karigarId") REFERENCES "karigars"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "karigar_payments" ADD CONSTRAINT "karigar_payments_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "production_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "karigar_payments" ADD CONSTRAINT "karigar_payments_metalTypeId_fkey" FOREIGN KEY ("metalTypeId") REFERENCES "metal_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "karigar_disputes" ADD CONSTRAINT "karigar_disputes_karigarId_fkey" FOREIGN KEY ("karigarId") REFERENCES "karigars"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "karigar_disputes" ADD CONSTRAINT "karigar_disputes_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "production_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
