/*
  Warnings:

  - You are about to drop the column `rateAtTrade` on the `trades` table. All the data in the column will be lost.
  - Added the required column `rateAtTradePerGram` to the `trades` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "trades" DROP COLUMN "rateAtTrade",
ADD COLUMN     "rateAtTradePerGram" DECIMAL(12,2) NOT NULL;
