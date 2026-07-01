-- AlterTable
ALTER TABLE "metal_types" ADD COLUMN "buyDiscountPctOverride" DECIMAL(5,2);

-- CreateTable
CREATE TABLE "system_settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- CreateEnum
CREATE TYPE "FetchedRateSnapshotStatus" AS ENUM ('PENDING', 'SUSPICIOUS', 'FAILED', 'CONFIRMED');

-- CreateTable
CREATE TABLE "fetched_rate_snapshots" (
    "id" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,
    "nepaliDateLabel" TEXT,
    "fineGoldPer10g" DECIMAL(12,2),
    "silverPer10g" DECIMAL(12,2),
    "status" "FetchedRateSnapshotStatus" NOT NULL,
    "warningReason" TEXT,
    "rawSnippet" TEXT,
    "consumedAt" TIMESTAMP(3),
    "consumedByDailyRateIds" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "fetched_rate_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fetched_rate_snapshots_fetchedAt_idx" ON "fetched_rate_snapshots"("fetchedAt" DESC);

-- Seed default buy discount
INSERT INTO "system_settings" ("key", "value") VALUES ('buyDiscountPct', '5');
