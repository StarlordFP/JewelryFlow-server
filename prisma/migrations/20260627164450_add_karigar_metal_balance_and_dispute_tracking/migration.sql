-- CreateEnum
CREATE TYPE "DisputeResolutionType" AS ENUM ('CASH_DEDUCTION', 'METAL_CARRYFORWARD');

-- AlterTable
ALTER TABLE "karigar_disputes" ADD COLUMN     "metalTypeId" TEXT,
ADD COLUMN     "productionIssueId" TEXT,
ADD COLUMN     "resolutionType" "DisputeResolutionType";

-- AlterTable
ALTER TABLE "production_issues" ADD COLUMN     "appliedFromBalanceGram" DECIMAL(10,4);

-- AlterTable
ALTER TABLE "production_orders" ADD COLUMN     "toleranceGram" DECIMAL(10,4);

-- CreateTable
CREATE TABLE "karigar_metal_balances" (
    "id" TEXT NOT NULL,
    "karigarId" TEXT NOT NULL,
    "metalTypeId" TEXT NOT NULL,
    "balanceGram" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "karigar_metal_balances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "karigar_metal_balances_karigarId_metalTypeId_key" ON "karigar_metal_balances"("karigarId", "metalTypeId");

-- CreateIndex
CREATE INDEX "karigar_disputes_metalTypeId_idx" ON "karigar_disputes"("metalTypeId");

-- AddForeignKey
ALTER TABLE "karigar_disputes" ADD CONSTRAINT "karigar_disputes_productionIssueId_fkey" FOREIGN KEY ("productionIssueId") REFERENCES "production_issues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "karigar_disputes" ADD CONSTRAINT "karigar_disputes_metalTypeId_fkey" FOREIGN KEY ("metalTypeId") REFERENCES "metal_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "karigar_metal_balances" ADD CONSTRAINT "karigar_metal_balances_karigarId_fkey" FOREIGN KEY ("karigarId") REFERENCES "karigars"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "karigar_metal_balances" ADD CONSTRAINT "karigar_metal_balances_metalTypeId_fkey" FOREIGN KEY ("metalTypeId") REFERENCES "metal_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
