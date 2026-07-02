-- Add DIRECT origin for manual shop entry
ALTER TYPE "StockItemOrigin" ADD VALUE IF NOT EXISTS 'DIRECT' BEFORE 'PURCHASED';

-- ItemCategory: shortCode, isProtected, createdByUserId
ALTER TABLE "item_categories" ADD COLUMN "shortCode" TEXT;
ALTER TABLE "item_categories" ADD COLUMN "isProtected" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "item_categories" ADD COLUMN "createdByUserId" TEXT;

-- Backfill shortCode for seeded categories (exact codes per spec)
UPDATE "item_categories" SET "shortCode" = 'RNG', "isProtected" = true WHERE "name" = 'Ring';
UPDATE "item_categories" SET "shortCode" = 'BNG', "isProtected" = true WHERE "name" = 'Bangle';
UPDATE "item_categories" SET "shortCode" = 'NCK', "isProtected" = true WHERE "name" = 'Necklace';
UPDATE "item_categories" SET "shortCode" = 'EAR', "isProtected" = true WHERE "name" = 'Earring';
UPDATE "item_categories" SET "shortCode" = 'BRC', "isProtected" = true WHERE "name" = 'Bracelet';
UPDATE "item_categories" SET "shortCode" = 'PEN', "isProtected" = true WHERE "name" = 'Pendant';
UPDATE "item_categories" SET "shortCode" = 'MAL', "isProtected" = true WHERE "name" = 'Mala';
UPDATE "item_categories" SET "shortCode" = 'CHN', "isProtected" = true WHERE "name" = 'Chain';
UPDATE "item_categories" SET "shortCode" = 'HAR', "isProtected" = true WHERE "name" = 'Haar';
UPDATE "item_categories" SET "shortCode" = 'SVR', "isProtected" = true WHERE "name" = 'Silver Ring';
UPDATE "item_categories" SET "shortCode" = 'SVB', "isProtected" = true WHERE "name" = 'Silver Bangle';
UPDATE "item_categories" SET "shortCode" = 'SVN', "isProtected" = true WHERE "name" = 'Silver Necklace';
UPDATE "item_categories" SET "shortCode" = 'SVP', "isProtected" = true WHERE "name" = 'Silver Payal';
UPDATE "item_categories" SET "shortCode" = 'UNC', "isProtected" = true WHERE "name" = 'Uncategorised';

-- Fallback for any owner-created categories without shortCode: first 3 uppercase letters
UPDATE "item_categories"
SET "shortCode" = UPPER(LEFT(REGEXP_REPLACE("name", '[^A-Za-z]', '', 'g'), 3))
WHERE "shortCode" IS NULL OR "shortCode" = '';

-- Resolve any remaining duplicates by appending digit
DO $$
DECLARE
  r RECORD;
  base TEXT;
  candidate TEXT;
  n INT;
BEGIN
  FOR r IN
    SELECT id, name, "shortCode"
    FROM "item_categories" c1
    WHERE EXISTS (
      SELECT 1 FROM "item_categories" c2
      WHERE c2."shortCode" = c1."shortCode" AND c2.id <> c1.id
    )
  LOOP
    base := LEFT(r."shortCode", 2);
    n := 2;
    LOOP
      candidate := base || n::TEXT;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM "item_categories" WHERE "shortCode" = candidate AND id <> r.id);
      n := n + 1;
    END LOOP;
    UPDATE "item_categories" SET "shortCode" = candidate WHERE id = r.id;
  END LOOP;
END $$;

ALTER TABLE "item_categories" ALTER COLUMN "shortCode" SET NOT NULL;
CREATE UNIQUE INDEX "item_categories_shortCode_key" ON "item_categories"("shortCode");

-- CategoryKaratSequence table
CREATE TABLE "category_karat_sequences" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "metalTypeId" TEXT NOT NULL,
    "lastSeq" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "category_karat_sequences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "category_karat_sequences_categoryId_metalTypeId_key"
  ON "category_karat_sequences"("categoryId", "metalTypeId");

ALTER TABLE "category_karat_sequences"
  ADD CONSTRAINT "category_karat_sequences_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "item_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "category_karat_sequences"
  ADD CONSTRAINT "category_karat_sequences_metalTypeId_fkey"
  FOREIGN KEY ("metalTypeId") REFERENCES "metal_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
