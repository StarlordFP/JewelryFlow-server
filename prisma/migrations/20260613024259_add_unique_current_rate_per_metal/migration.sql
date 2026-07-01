-- Prevent two isCurrent=true rates for the same metal
CREATE UNIQUE INDEX "unique_current_rate_per_metal"
ON "daily_rates"("metalTypeId")
WHERE "isCurrent" = true;