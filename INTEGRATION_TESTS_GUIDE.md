# JewelryFlow ERP Integration Tests — Complete Setup Guide

## Overview

This document describes the complete integration test suite for JewelryFlow ERP, covering all 6 business flows:

1. **Rates** — Daily metal rate management
2. **Stock** — Jewelry inventory with weight conversions and pricing
3. **Sales** — Bill generation, payments, and returns
4. **Purchase Orders** — Supplier purchase orders with receipt tracking
5. **Karigar** — Production workflows with weight tolerance and disputes
6. **Trade** — Raw material trading with suppliers

## Test Files

All test files are integration tests (`*.integration.spec.ts`) located in their respective modules:

- `src/rates/rates.integration.spec.ts` — 7 tests
- `src/stock/stock.integration.spec.ts` — 12 tests
- `src/sales/sales.integration.spec.ts` — 15 tests
- `src/purchase/purchase.integration.spec.ts` — 13 tests
- `src/karigar/karigar.integration.spec.ts` — 16 tests
- `src/trade/trade.integration.spec.ts` — 17 tests

**Total: 80 integration tests**

## Prerequisites

### Environment Setup

1. **Database**: PostgreSQL running and accessible via `DATABASE_URL` env var
2. **Seeded Data**: The following must be pre-seeded:
   - User: `owner@jewelryflow.test` / `password123` with OWNER role
   - Metal Types: At least one "Gold" and optionally "Silver"
   - Item Categories: At least one category (e.g., "Ring", "Necklace")
   - Jerty Brackets: Weight-based jerty suggestions
   - Jyala Rules: Pricing rules for categories and metals

### Seed Database

```bash
# Run Prisma seed script
npm run db:seed
```

Or manually using Prisma Studio:

```bash
npm run db:studio
```

## Running Tests

### Run All Integration Tests

```powershell
# Serial execution (recommended for DB isolation)
npx jest --testPathPattern=integration --runInBand --verbose --forceExit
```

### Run Specific Flow Tests

```powershell
# Rates only
npx jest src/rates/rates.integration.spec.ts --runInBand

# Stock only
npx jest src/stock/stock.integration.spec.ts --runInBand

# Sales only
npx jest src/sales/sales.integration.spec.ts --runInBand

# Purchase Orders only
npx jest src/purchase/purchase.integration.spec.ts --runInBand

# Karigar only
npx jest src/karigar/karigar.integration.spec.ts --runInBand

# Trade only
npx jest src/trade/trade.integration.spec.ts --runInBand
```

### With Coverage

```powershell
npx jest --testPathPattern=integration --runInBand --coverage --forceExit
```

### Watch Mode (Development)

```powershell
npx jest --testPathPattern=integration --runInBand --watch
```

## Test Architecture

### Setup Pattern

Each test file follows this structure:

```typescript
beforeAll(async () => {
  // Create app + configure pipes/prefix
  // Get auth token from seeded OWNER user
  // Setup: Get metal types, set daily rates, etc.
});

afterAll(async () => {
  // Clean up test data in child→parent order
  // Close app
});

describe('Flow X: [Name]', () => {
  it('should test endpoint behavior', () => {
    // Arrange: prepare test data
    // Act: call endpoint via supertest
    // Assert: verify response structure and business logic
  });
});
```

### Response Format

All responses are wrapped in:

```typescript
{
  success: true,
  data: { ... }  // Actual payload
}
```

### Data Isolation

- Tests chain IDs across flows (e.g., `goldMetalTypeId` → `stockItemId` → `transactionId`)
- Module-level variables store IDs for sequential test execution
- Each test uses unique names (e.g., `Test ${Date.now()}`) to avoid conflicts
- `afterAll` cleans up in child→parent order to respect FK constraints

## Test Coverage by Flow

### Flow 1: Rates (7 tests)

- ✅ GET metal types — store goldMetalTypeId
- ✅ POST rate — set today's rate, expire previous
- ✅ POST rate — verify isCurrent changes
- ✅ POST rate — reject invalid buy/sell rates
- ✅ GET today's rates — all current rates
- ✅ GET today/:metalTypeId — specific metal rate
- ✅ GET history — paginated history with filters

**Business Logic Validated:**
- Only 1 current rate per metal type
- Sell rate > buy rate
- Per-tola and per-lal derived correctly from per-gram
- History pagination

### Flow 2: Stock (12 tests)

- ✅ GET categories → store categoryId
- ✅ POST price-preview → verify pricing calculation
- ✅ POST stock item → PURCHASED origin, SKU validation
- ✅ POST stock item → SKU format (PUR-)
- ✅ GET stock list → paginated, includes test item
- ✅ GET stock/:id → full item details with all weight units
- ✅ GET stock/:id → weight conversions (gram ↔ tola ↔ lal)
- ✅ GET suggestions → jerty bracket suggestions
- ✅ PATCH stock/:id → update notes
- ✅ POST price-preview with stockItemId → consistency check
- ✅ GET stock → filter by status
- ✅ GET stock → filter by category and metal type
- ✅ Validation: required fields, invalid metalTypeId

**Business Logic Validated:**
- Weight stored in 3 units with correct conversions
- SKU format matches origin (PUR-, KAR-, TRD-)
- Price preview includes metal value + jyala + taxes
- Jerty suggestions from brackets

### Flow 3: Sales (15 tests)

- ✅ POST customer → create test customer
- ✅ POST sell → create SELL transaction with bill number
- ✅ POST sell → ownerBill structure (jyala breakdown visible)
- ✅ POST sell → customerBill structure (no breakdown)
- ✅ POST sell → stock item marked SOLD
- ✅ POST sell → balance = grandTotal - paidAmount
- ✅ POST sell → reject duplicate sale of same item
- ✅ GET sales/:id → transaction details
- ✅ GET sales?customerId=xxx → list customer transactions
- ✅ POST payment/:txId → partial payment
- ✅ POST payment/:txId → creates paymentRecord
- ✅ POST return → within 7-day window
- ✅ POST return → stock item back to IN_STOCK
- ✅ Validation: payment amounts positive
- ✅ Validation: required fields

**Business Logic Validated:**
- Bill number format (BILL-000001)
- Owner bill shows jyala breakdown
- Customer bill shows only jyala total
- Balance = grandTotal - paidAmount
- Partial payments tracked separately
- Returns within 7 days revert stock status

### Flow 4: Purchase Orders (13 tests)

- ✅ POST supplier → DIRECT type
- ✅ GET suppliers → list with pagination
- ✅ POST purchase-order → create PO with lines
- ✅ GET purchase-order/:id → verify details
- ✅ PATCH receive → status RECEIVED, stock item created
- ✅ PATCH receive → stock item has IN_STOCK status
- ✅ PATCH cancel → reject cancel if received
- ✅ PATCH cancel → allow cancel if PENDING
- ✅ GET purchase-orders?supplierId=xxx → filter by supplier
- ✅ GET purchase-orders → filter by status
- ✅ Validation: supplier exists
- ✅ Validation: required fields
- ✅ Validation: weights positive

**Business Logic Validated:**
- PO status lifecycle (PENDING → RECEIVED/CANCELLED)
- Stock items created on receive with PUR- SKU
- Can't cancel received PO
- SKU format validation

### Flow 5: Karigar (16 tests)

- ✅ POST karigar → create with tolerance
- ✅ GET karigars → list
- ✅ POST production-order → create OPEN order
- ✅ POST production-issue → issue raw metal
- ✅ POST production-return → record finished items
- ✅ POST production-return → kharchar calculation (issued - returned)
- ✅ POST production-return → dispute if outside tolerance
- ✅ POST production-return → stock items created with KAR- SKU
- ✅ GET karigar-disputes → list disputes
- ✅ PATCH dispute/:id/resolve → resolve with deduction
- ✅ POST karigar-payment → pay karigar
- ✅ GET karigar/:id/payments → list payments
- ✅ GET karigar/:id → stats (_count)
- ✅ Validation: karigar exists
- ✅ Validation: weights positive
- ✅ Validation: returned ≤ issued

**Business Logic Validated:**
- Kharchar = issuedWeight - returnedWeight
- Tolerance calculation: kharchar/issuedWeight vs tolerancePct
- Dispute created if outside tolerance
- Stock items created with KARIGAR origin and KAR- SKU
- Disputes can be resolved with deductions

### Flow 6: Trade (17 tests)

- ✅ POST trade-party → TRADE type supplier
- ✅ POST trade → give raw metal, receive finished items
- ✅ GET trade/:id → verify details
- ✅ PATCH trade/:id/status → COMPLETED
- ✅ PATCH trade/:id/status → creates stock items with TRD- SKU
- ✅ GET trade-parties/:id/summary → trade stats
- ✅ GET trades → list with pagination
- ✅ GET trades → filter by status
- ✅ GET trades → filter by supplier
- ✅ POST trade → reject if supplier is DIRECT (not TRADE)
- ✅ PATCH trade/:id/status → CANCELLED if PENDING
- ✅ PATCH trade/:id/status → reject cancel if COMPLETED
- ✅ Validation: supplier exists
- ✅ Validation: metal type exists
- ✅ Validation: weight positive
- ✅ Validation: rate positive
- ✅ All other required fields

**Business Logic Validated:**
- Trade status lifecycle (PENDING → COMPLETED/CANCELLED)
- Stock items created on completion with TRD- SKU
- Only TRADE-type suppliers can be used
- Trade stats track given/received weights
- Can't cancel completed trade

## Cleanup Pattern

All tests follow this cleanup order (child → parent):

```typescript
afterAll(async () => {
  // 1. Delete dependent records first
  await prisma.paymentRecord.deleteMany({ where: {...} });
  await prisma.transactionLine.deleteMany({ where: {...} });
  await prisma.transaction.deleteMany({ where: {...} });
  
  // 2. Then delete primary records
  await prisma.stockItem.deleteMany({ where: {...} });
  await prisma.customer.deleteMany({ where: {...} });
  
  // 3. Finally close app
  await app.close();
});
```

## Troubleshooting

### Test Hangs or Timeouts

```powershell
# Increase timeout for slow DB queries
npx jest --testPathPattern=integration --runInBand --testTimeout=10000
```

### Seeded Data Not Found

Verify seed script ran:

```bash
npm run db:seed
# Check logs for errors
# Manually verify data exists:
npm run db:studio
```

### Port Already in Use

NestJS app is trying to use the same port as existing instance:

```powershell
# Kill existing process
lsof -ti:3000 | xargs kill -9  # macOS/Linux
netstat -ano | findstr :3000 | findstr LISTENING | awk '{print $5}' | xargs taskkill /PID /F  # Windows
```

### Database Connection Errors

```powershell
# Verify DATABASE_URL is set
echo $env:DATABASE_URL  # PowerShell
echo $DATABASE_URL      # bash

# Test connection
psql $DATABASE_URL -c "SELECT 1"
```

### Tests Pass Individually But Fail Together

**Cause**: Foreign key or uniqueness constraints between flows.

**Solution**: Ensure `--runInBand` is set to run tests serially:

```powershell
npx jest --testPathPattern=integration --runInBand
```

## Performance Tips

### Optimize Test Execution

1. **Parallel Flows** (separate test files): Run different files in parallel
2. **Serial Within Flow**: Keep tests within one file serial (`--runInBand`)
3. **Connection Pooling**: Set `postgresql://user:pass@host/db?sslmode=require&poolSize=5`
4. **Indexes**: Verify Prisma migrations include all necessary indexes

### Reduce Database Load

```typescript
// Batch deletes instead of individual deletes
await prisma.stockItem.deleteMany({ where: { sku: { startsWith: 'PUR-' } } });

// Use transactions for multi-step operations
await prisma.$transaction(async (tx) => {
  // Multiple operations in one transaction
});
```

## Continuous Integration (CI/CD)

### GitHub Actions Example

```yaml
name: Integration Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: jewelryflow_test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 5432:5432
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install
      - run: npx prisma db push --skip-generate
      - run: npm run db:seed
      - run: npm run test:integration

  scripts:
    test:integration: npx jest --testPathPattern=integration --runInBand --forceExit
```

## Future Enhancements

- [ ] Add authentication/authorization role tests
- [ ] Add concurrency/race condition tests
- [ ] Add performance benchmarks
- [ ] Add GraphQL subscription tests (if added to API)
- [ ] Add webhook/notification tests
- [ ] Add error recovery tests (e.g., retry logic)
- [ ] Add data export/import tests

---

**Last Updated**: 2026-06-05  
**Test Suite Version**: 1.0.0  
**Minimum Node**: 18.x  
**Minimum NestJS**: 10.x
