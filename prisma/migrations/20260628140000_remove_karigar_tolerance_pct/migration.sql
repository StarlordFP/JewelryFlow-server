-- Drop per-karigar default tolerance; tolerance is set per production order only.
ALTER TABLE "karigars" DROP COLUMN "tolerancePct";
