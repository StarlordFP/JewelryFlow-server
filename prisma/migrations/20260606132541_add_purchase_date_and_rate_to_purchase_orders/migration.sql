-- AlterTable
ALTER TABLE "purchase_order_lines" ADD COLUMN     "rateAtPurchasePerGram" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "purchase_orders" ADD COLUMN     "purchaseDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
