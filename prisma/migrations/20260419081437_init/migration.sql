-- CreateEnum
CREATE TYPE "TradeStatus" AS ENUM ('PENDING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StockItemOrigin" AS ENUM ('PURCHASED', 'KARIGAR', 'TRADE');

-- CreateEnum
CREATE TYPE "StockItemStatus" AS ENUM ('IN_STOCK', 'SOLD', 'RETURNED', 'SCRAPPED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metal_types" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "purityFactor" DECIMAL(5,4) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "metal_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "item_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trade_parties" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trade_parties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trades" (
    "id" TEXT NOT NULL,
    "tradePartyId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "givenWeightLal" INTEGER NOT NULL,
    "givenMetalTypeId" TEXT NOT NULL,
    "rateAtTrade" DECIMAL(12,2) NOT NULL,
    "cashAdjustment" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "TradeStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trade_items" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "grossWeightLal" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trade_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_items" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "origin" "StockItemOrigin" NOT NULL,
    "categoryId" TEXT NOT NULL,
    "metalTypeId" TEXT,
    "grossWeightLal" INTEGER NOT NULL,
    "karat" INTEGER,
    "netWeightLal" INTEGER,
    "status" "StockItemStatus" NOT NULL DEFAULT 'IN_STOCK',
    "tradeItemId" TEXT,
    "productionItemId" TEXT,
    "photoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phoneHash" TEXT,
    "phoneHint" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "customerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buyback_records" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,

    CONSTRAINT "buyback_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "metal_types_name_key" ON "metal_types"("name");

-- CreateIndex
CREATE UNIQUE INDEX "item_categories_name_key" ON "item_categories"("name");

-- CreateIndex
CREATE UNIQUE INDEX "stock_items_sku_key" ON "stock_items"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "stock_items_tradeItemId_key" ON "stock_items"("tradeItemId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_items_productionItemId_key" ON "stock_items"("productionItemId");

-- CreateIndex
CREATE UNIQUE INDEX "customers_phoneHash_key" ON "customers"("phoneHash");

-- CreateIndex
CREATE UNIQUE INDEX "buyback_records_transactionId_key" ON "buyback_records"("transactionId");

-- AddForeignKey
ALTER TABLE "trades" ADD CONSTRAINT "trades_tradePartyId_fkey" FOREIGN KEY ("tradePartyId") REFERENCES "trade_parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trades" ADD CONSTRAINT "trades_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trades" ADD CONSTRAINT "trades_givenMetalTypeId_fkey" FOREIGN KEY ("givenMetalTypeId") REFERENCES "metal_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_items" ADD CONSTRAINT "trade_items_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "trades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "item_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_tradeItemId_fkey" FOREIGN KEY ("tradeItemId") REFERENCES "trade_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyback_records" ADD CONSTRAINT "buyback_records_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyback_records" ADD CONSTRAINT "buyback_records_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
