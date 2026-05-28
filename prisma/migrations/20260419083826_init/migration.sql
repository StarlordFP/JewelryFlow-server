/*
  Warnings:

  - You are about to alter the column `grossWeightLal` on the `stock_items` table. The data in that column could be lost. The data in that column will be cast from `Integer` to `Decimal(10,4)`.
  - You are about to alter the column `grossWeightLal` on the `trade_items` table. The data in that column could be lost. The data in that column will be cast from `Integer` to `Decimal(10,4)`.
  - You are about to alter the column `givenWeightLal` on the `trades` table. The data in that column could be lost. The data in that column will be cast from `Integer` to `Decimal(10,4)`.
  - Added the required column `grossWeightGram` to the `stock_items` table without a default value. This is not possible if the table is not empty.
  - Added the required column `grossWeightTola` to the `stock_items` table without a default value. This is not possible if the table is not empty.
  - Added the required column `grossWeightGram` to the `trade_items` table without a default value. This is not possible if the table is not empty.
  - Added the required column `grossWeightTola` to the `trade_items` table without a default value. This is not possible if the table is not empty.
  - Added the required column `givenWeightGram` to the `trades` table without a default value. This is not possible if the table is not empty.
  - Added the required column `givenWeightTola` to the `trades` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "stock_items" ADD COLUMN     "grossWeightGram" DECIMAL(10,4) NOT NULL,
ADD COLUMN     "grossWeightTola" DECIMAL(10,4) NOT NULL,
ALTER COLUMN "grossWeightLal" SET DATA TYPE DECIMAL(10,4);

-- AlterTable
ALTER TABLE "trade_items" ADD COLUMN     "grossWeightGram" DECIMAL(10,4) NOT NULL,
ADD COLUMN     "grossWeightTola" DECIMAL(10,4) NOT NULL,
ALTER COLUMN "grossWeightLal" SET DATA TYPE DECIMAL(10,4);

-- AlterTable
ALTER TABLE "trades" ADD COLUMN     "givenWeightGram" DECIMAL(10,4) NOT NULL,
ADD COLUMN     "givenWeightTola" DECIMAL(10,4) NOT NULL,
ALTER COLUMN "givenWeightLal" SET DATA TYPE DECIMAL(10,4);
