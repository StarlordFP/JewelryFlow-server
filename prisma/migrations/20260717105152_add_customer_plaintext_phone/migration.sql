-- DropIndex
DROP INDEX "customers_phoneHash_key";

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "phone" TEXT;

-- CreateIndex
CREATE INDEX "customers_phone_idx" ON "customers"("phone");
