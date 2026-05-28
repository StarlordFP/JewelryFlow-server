/*
  Warnings:

  - You are about to drop the column `netWeightLal` on the `stock_items` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "JyalaChargeType" AS ENUM ('PERCENTAGE', 'FLAT');

-- AlterEnum
ALTER TYPE "StockItemStatus" ADD VALUE 'RESERVED';

-- AlterTable
ALTER TABLE "stock_items" DROP COLUMN "netWeightLal",
ADD COLUMN     "applyLuxuryTax" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "applyVat" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "jertyGram" DECIMAL(10,4) NOT NULL DEFAULT 0,
ADD COLUMN     "jertyLal" DECIMAL(10,4) NOT NULL DEFAULT 0,
ADD COLUMN     "jertyTola" DECIMAL(10,4) NOT NULL DEFAULT 0,
ADD COLUMN     "makingChargeNpr" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "malaChargeNpr" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "motiChargeNpr" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "otherChargeNpr" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "stoneChargeNpr" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "totalJyalaNpr" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "createdByUserId" TEXT;

-- CreateTable
CREATE TABLE "daily_rates" (
    "id" TEXT NOT NULL,
    "metalTypeId" TEXT NOT NULL,
    "ratePerGram" DECIMAL(12,2) NOT NULL,
    "ratePerTola" DECIMAL(12,2) NOT NULL,
    "ratePerLal" DECIMAL(12,2) NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "updatedByUserId" TEXT NOT NULL,

    CONSTRAINT "daily_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jyala_rules" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "metalTypeId" TEXT NOT NULL,
    "chargeType" "JyalaChargeType" NOT NULL,
    "minValue" DECIMAL(10,2) NOT NULL,
    "maxValue" DECIMAL(10,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "jyala_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jerty_brackets" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "minWeightGram" DECIMAL(10,4) NOT NULL,
    "maxWeightGram" DECIMAL(10,4) NOT NULL,
    "jertyGram" DECIMAL(10,4) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "jerty_brackets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "luxury_tax_rules" (
    "id" TEXT NOT NULL,
    "rate" DECIMAL(5,4) NOT NULL,
    "appliesTo" TEXT NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "luxury_tax_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vat_rules" (
    "id" TEXT NOT NULL,
    "rate" DECIMAL(5,4) NOT NULL,
    "appliesTo" TEXT NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "vat_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addon_types" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "addon_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_item_addons" (
    "id" TEXT NOT NULL,
    "stockItemId" TEXT NOT NULL,
    "addonTypeId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "valuationNpr" DECIMAL(12,2) NOT NULL,
    "notes" TEXT,

    CONSTRAINT "stock_item_addons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_lines" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "stockItemId" TEXT NOT NULL,
    "metalValueNpr" DECIMAL(12,2) NOT NULL,
    "jertyGram" DECIMAL(10,4) NOT NULL,
    "jyalaNpr" DECIMAL(12,2) NOT NULL,
    "luxuryTaxNpr" DECIMAL(12,2) NOT NULL,
    "vatNpr" DECIMAL(12,2) NOT NULL,
    "addonValueNpr" DECIMAL(12,2) NOT NULL,
    "lineTotalNpr" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "transaction_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "toolName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "jyala_rules_categoryId_metalTypeId_key" ON "jyala_rules"("categoryId", "metalTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "addon_types_name_key" ON "addon_types"("name");

-- AddForeignKey
ALTER TABLE "daily_rates" ADD CONSTRAINT "daily_rates_metalTypeId_fkey" FOREIGN KEY ("metalTypeId") REFERENCES "metal_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_rates" ADD CONSTRAINT "daily_rates_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jyala_rules" ADD CONSTRAINT "jyala_rules_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "item_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jyala_rules" ADD CONSTRAINT "jyala_rules_metalTypeId_fkey" FOREIGN KEY ("metalTypeId") REFERENCES "metal_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jerty_brackets" ADD CONSTRAINT "jerty_brackets_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "item_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_metalTypeId_fkey" FOREIGN KEY ("metalTypeId") REFERENCES "metal_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_item_addons" ADD CONSTRAINT "stock_item_addons_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "stock_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_item_addons" ADD CONSTRAINT "stock_item_addons_addonTypeId_fkey" FOREIGN KEY ("addonTypeId") REFERENCES "addon_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_lines" ADD CONSTRAINT "transaction_lines_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_lines" ADD CONSTRAINT "transaction_lines_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "stock_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
