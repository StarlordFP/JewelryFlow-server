-- AlterTable
ALTER TABLE "karigar_disputes" ADD COLUMN     "resolvedByUserId" TEXT;

-- AlterTable
ALTER TABLE "production_orders" ADD COLUMN     "createdByUserId" TEXT;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "karigar_disputes" ADD CONSTRAINT "karigar_disputes_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
