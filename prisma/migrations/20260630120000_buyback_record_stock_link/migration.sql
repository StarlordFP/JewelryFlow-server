-- AlterTable
ALTER TABLE "buyback_records" ADD COLUMN "stockItemId" TEXT,
ADD COLUMN "metalTypeId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "buyback_records_stockItemId_key" ON "buyback_records"("stockItemId");

-- AddForeignKey
ALTER TABLE "buyback_records" ADD CONSTRAINT "buyback_records_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "stock_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyback_records" ADD CONSTRAINT "buyback_records_metalTypeId_fkey" FOREIGN KEY ("metalTypeId") REFERENCES "metal_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;
