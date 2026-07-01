-- DropIndex (productionIssueId was indexed but not unique)
DROP INDEX IF EXISTS "production_returns_productionIssueId_idx";

-- CreateIndex
CREATE UNIQUE INDEX "production_returns_productionIssueId_key" ON "production_returns"("productionIssueId");
