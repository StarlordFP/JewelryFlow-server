/*
  Warnings:

  - You are about to drop the column `ratePerGram` on the `daily_rates` table. All the data in the column will be lost.
  - You are about to drop the column `ratePerLal` on the `daily_rates` table. All the data in the column will be lost.
  - You are about to drop the column `ratePerTola` on the `daily_rates` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[billNumber]` on the table `transactions` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `buyRatePerGram` to the `buyback_records` table without a default value. This is not possible if the table is not empty.
  - Added the required column `metalWeightGram` to the `buyback_records` table without a default value. This is not possible if the table is not empty.
  - Added the required column `metalWeightLal` to the `buyback_records` table without a default value. This is not possible if the table is not empty.
  - Added the required column `metalWeightTola` to the `buyback_records` table without a default value. This is not possible if the table is not empty.
  - Added the required column `totalNpr` to the `buyback_records` table without a default value. This is not possible if the table is not empty.
  - Added the required column `buyRatePerGram` to the `daily_rates` table without a default value. This is not possible if the table is not empty.
  - Added the required column `buyRatePerLal` to the `daily_rates` table without a default value. This is not possible if the table is not empty.
  - Added the required column `buyRatePerTola` to the `daily_rates` table without a default value. This is not possible if the table is not empty.
  - Added the required column `sellRatePerGram` to the `daily_rates` table without a default value. This is not possible if the table is not empty.
  - Added the required column `sellRatePerLal` to the `daily_rates` table without a default value. This is not possible if the table is not empty.
  - Added the required column `sellRatePerTola` to the `daily_rates` table without a default value. This is not possible if the table is not empty.
  - Added the required column `billableGram` to the `transaction_lines` table without a default value. This is not possible if the table is not empty.
  - Added the required column `grossWeightGram` to the `transaction_lines` table without a default value. This is not possible if the table is not empty.
  - Added the required column `ratePerGram` to the `transaction_lines` table without a default value. This is not possible if the table is not empty.
  - Added the required column `billNumber` to the `transactions` table without a default value. This is not possible if the table is not empty.
  - Added the required column `grandTotalNpr` to the `transactions` table without a default value. This is not possible if the table is not empty.
  - Added the required column `subTotalNpr` to the `transactions` table without a default value. This is not possible if the table is not empty.
  - Added the required column `txType` to the `transactions` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `transactions` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('SELL', 'RETURN', 'EXCHANGE', 'BUY_BACK', 'OLD_GOLD');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'ONLINE', 'CHEQUE');

-- DropForeignKey
ALTER TABLE "buyback_records" DROP CONSTRAINT "buyback_records_customerId_fkey";

-- DropForeignKey
ALTER TABLE "transaction_lines" DROP CONSTRAINT "transaction_lines_transactionId_fkey";

-- AlterTable
ALTER TABLE "buyback_records" ADD COLUMN     "buyRatePerGram" DECIMAL(12,2) NOT NULL,
ADD COLUMN     "metalWeightGram" DECIMAL(10,4) NOT NULL,
ADD COLUMN     "metalWeightLal" DECIMAL(10,4) NOT NULL,
ADD COLUMN     "metalWeightTola" DECIMAL(10,4) NOT NULL,
ADD COLUMN     "relatedSaleTxId" TEXT,
ADD COLUMN     "totalNpr" DECIMAL(12,2) NOT NULL,
ALTER COLUMN "customerId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "daily_rates" DROP COLUMN "ratePerGram",
DROP COLUMN "ratePerLal",
DROP COLUMN "ratePerTola",
ADD COLUMN     "buyRatePerGram" DECIMAL(12,2) NOT NULL,
ADD COLUMN     "buyRatePerLal" DECIMAL(12,2) NOT NULL,
ADD COLUMN     "buyRatePerTola" DECIMAL(12,2) NOT NULL,
ADD COLUMN     "sellRatePerGram" DECIMAL(12,2) NOT NULL,
ADD COLUMN     "sellRatePerLal" DECIMAL(12,2) NOT NULL,
ADD COLUMN     "sellRatePerTola" DECIMAL(12,2) NOT NULL;

-- AlterTable
ALTER TABLE "transaction_lines" ADD COLUMN     "billableGram" DECIMAL(10,4) NOT NULL,
ADD COLUMN     "grossWeightGram" DECIMAL(10,4) NOT NULL,
ADD COLUMN     "makingChargeNpr" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "malaChargeNpr" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "motiChargeNpr" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "otherChargeNpr" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "ratePerGram" DECIMAL(12,2) NOT NULL,
ADD COLUMN     "stoneChargeNpr" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "balanceNpr" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "billNumber" TEXT NOT NULL,
ADD COLUMN     "dailyRateId" TEXT,
ADD COLUMN     "discountNpr" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "exchangeGroupId" TEXT,
ADD COLUMN     "grandTotalNpr" DECIMAL(12,2) NOT NULL,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "paidAmountNpr" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'CASH',
ADD COLUMN     "relatedTxId" TEXT,
ADD COLUMN     "returnDeadline" TIMESTAMP(3),
ADD COLUMN     "subTotalNpr" DECIMAL(12,2) NOT NULL,
ADD COLUMN     "txType" "TransactionType" NOT NULL,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateTable
CREATE TABLE "payment_records" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "amountNpr" DECIMAL(12,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "payment_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "transactions_billNumber_key" ON "transactions"("billNumber");

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_dailyRateId_fkey" FOREIGN KEY ("dailyRateId") REFERENCES "daily_rates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_relatedTxId_fkey" FOREIGN KEY ("relatedTxId") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_lines" ADD CONSTRAINT "transaction_lines_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyback_records" ADD CONSTRAINT "buyback_records_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
