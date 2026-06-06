# JewelryFlow ERP Integration Tests — Quick Start

## 🚀 Quick Start

### 1. Setup Database

```bash
# Create test database (if not exists)
npm run db:push

# Seed with test data
npm run db:seed
```

### 2. Run All Integration Tests

```bash
npm run test:integration
```

### 3. Run Specific Flow Tests

```bash
npm run test:integration:rates       # Flow 1: Rates
npm run test:integration:stock       # Flow 2: Stock  
npm run test:integration:sales       # Flow 3: Sales
npm run test:integration:purchase    # Flow 4: Purchase Orders
npm run test:integration:karigar     # Flow 5: Karigar/Production
npm run test:integration:trade       # Flow 6: Trade
```

## 📋 Test Summary

| Flow | File | Tests | Focus |
|------|------|-------|-------|
| Rates | `src/rates/rates.integration.spec.ts` | 7 | Daily rate management, expiry, validation |
| Stock | `src/stock/stock.integration.spec.ts` | 12 | Inventory, weight conversions, pricing |
| Sales | `src/sales/sales.integration.spec.ts` | 15 | Bill generation, payments, returns |
| Purchase | `src/purchase/purchase.integration.spec.ts` | 13 | Purchase orders, receipt, cancellation |
| Karigar | `src/karigar/karigar.integration.spec.ts` | 16 | Production workflow, tolerance, disputes |
| Trade | `src/trade/trade.integration.spec.ts` | 17 | Raw material trading with suppliers |
| **Total** | **6 files** | **80 tests** | **Complete ERP workflow** |

## ✅ What These Tests Validate

### Core Business Logic
- ✅ Rate management (set, expire, history)
- ✅ Weight unit conversions (gram ↔ tola ↔ lal)
- ✅ Price calculations (metal value + jyala + taxes)
- ✅ Bill generation (owner vs customer views)
- ✅ Partial payments and returns
- ✅ SKU generation (PUR-, KAR-, TRD- prefixes)
- ✅ Production workflow with tolerance
- ✅ Dispute creation and resolution
- ✅ Trade status lifecycle

### Data Integrity
- ✅ Foreign key constraints
- ✅ Unique constraints (email, phone hash, SKU)
- ✅ Transaction atomicity
- ✅ Proper cleanup between tests

### API Contract
- ✅ Response format: `{ success: true, data: {...} }`
- ✅ Pagination: `{ data: [...], meta: { total, page, limit } }`
- ✅ Error handling: proper HTTP status codes
- ✅ Input validation: DTO constraints enforced

## 🛠️ Advanced Usage

### Run with Coverage Report

```bash
npm run test:integration:cov
```

View coverage:
```bash
open coverage/integration/lcov-report/index.html
```

### Watch Mode (Live Reload)

```bash
npm run test:integration:watch
```

### Run Single Test

```bash
npx jest src/sales/sales.integration.spec.ts --runInBand --verbose
```

### Run Tests Matching Pattern

```bash
# Tests containing "should verify"
npx jest --testPathPattern=integration --testNamePattern="should verify" --runInBand
```

### Increase Timeout (for slow DBs)

```bash
npx jest src/rates/rates.integration.spec.ts --runInBand --testTimeout=60000
```

## 🔍 Understanding Test Structure

Each test file follows this pattern:

```typescript
describe('Flow X: [Name]', () => {
  // Module-level variables to store IDs for chaining flows
  let goldMetalTypeId: string;
  let stockItemId: string;

  beforeAll(async () => {
    // 1. Create NestJS test app
    // 2. Configure global pipes (validation)
    // 3. Get auth token from seeded user
    // 4. Setup: Create metal types, set rates, etc.
  });

  afterAll(async () => {
    // Clean up test data (child→parent order)
    // Close app
  });

  it('should test endpoint behavior', async () => {
    // Arrange: prepare data
    // Act: call endpoint via supertest
    // Assert: verify response + business logic
  });
});
```

## 🔐 Auth Setup

All tests use a seeded OWNER user:
- **Email**: `owner@jewelryflow.test`
- **Password**: `password123`
- **Role**: OWNER (full access)

To test with different roles, create additional seeded users in `prisma/seed.ts`:

```typescript
const manager = await prisma.user.create({
  data: {
    email: 'manager@jewelryflow.test',
    passwordHash: bcrypt.hashSync('password123', 12),
    name: 'Manager',
    emailVerified: true,
  },
});

await prisma.userRole.create({
  data: {
    userId: manager.id,
    roleId: managerRole.id,
  },
});
```

## 📊 Key Test Scenarios

### Rate Flow
```
1. Get metal types → capture goldMetalTypeId
2. Set today's rate (9500 sell, 9400 buy)
3. Set new rate → old rate expires
4. Verify per-tola/lal derived correctly
5. Get today's rates → only current ones
6. Get rate history → includes expired
```

### Stock Flow
```
1. Get categories → capture categoryId
2. Preview price (before creating item)
3. Create stock item (PURCHASED)
4. Verify weight stored in all 3 units
5. Verify SKU format (PUR-*)
6. Get suggestions for jerty
7. Update notes
```

### Sales Flow (Most Complex)
```
1. Create customer
2. Sell stock item → generates BILL-000001
3. Verify owner bill has jyala breakdown
4. Verify customer bill has only jyala total
5. Verify stock marked SOLD
6. Add partial payment
7. Verify balance decreased
8. Return item → status back to IN_STOCK
9. Create new transaction for balance verification
```

### Purchase Flow
```
1. Create DIRECT supplier
2. Create purchase order
3. Verify status = PENDING
4. Receive PO → status RECEIVED
5. Verify stock item created with PUR- SKU
6. Try to cancel → should fail (already received)
7. Create new PO and cancel → should succeed (PENDING)
```

### Karigar Flow
```
1. Create karigar (tolerance = 2.5%)
2. Create production order
3. Issue 20g raw gold
4. Return 18.5g finished items
5. Kharchar = 20 - 18.5 = 1.5g
6. Percentage = 1.5/20 = 7.5% > 2.5% → Dispute
7. Resolve dispute with deduction
8. Pay karigar
9. Verify stock items created with KAR- SKU
```

### Trade Flow
```
1. Create TRADE supplier
2. Create trade: give 50g, receive 48g items
3. Complete trade → status COMPLETED
4. Verify stock items created with TRD- SKU
5. Get trade party summary → shows stats
6. Try to cancel completed trade → should fail
```

## ⚠️ Common Issues & Solutions

### Tests Hang/Timeout
```bash
# Increase timeout
npx jest --testPathPattern=integration --runInBand --testTimeout=60000
```

### "Database error: relation does not exist"
```bash
# Ensure migrations are applied
npm run db:push

# If still failing, regenerate Prisma client
npx prisma generate
```

### "Failed to get auth token"
```bash
# Verify seeded user exists
npm run db:seed

# Check manually:
npm run db:studio
# Look for user: owner@jewelryflow.test
```

### Port 3000 Already in Use
```bash
# Kill existing NestJS instance (macOS/Linux)
lsof -ti:3000 | xargs kill -9

# Windows
netstat -ano | findstr :3000 | awk '{print $5}' | xargs taskkill /PID /F
```

### "Unique constraint violation"
Tests are using hardcoded test IDs that conflict. Solution:
- Use `Date.now()` in test names
- Run with `--runInBand` (serial execution)
- Clean up properly in `afterAll`

## 🎯 CI/CD Integration

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
      - uses: actions/setup-node@v18
        with:
          node-version: '18'
      
      - run: npm install
      - run: npx prisma db push
      - run: npm run db:seed
      - run: npm run test:integration
      - run: npm run test:integration:cov
      
      - uses: codecov/codecov-action@v3
        with:
          files: ./coverage/integration/coverage-final.json
          fail_ci_if_error: false
```

### Local Pre-commit Hook

```bash
#!/bin/bash
# .git/hooks/pre-commit

echo "Running integration tests..."
npm run test:integration --  --testTimeout=30000

if [ $? -ne 0 ]; then
  echo "Integration tests failed. Commit aborted."
  exit 1
fi
```

## 📚 Key Concepts

### Weight Conversions
- **Master unit**: Gram
- **1 Tola** = 11.664 gram
- **1 Lal** = 0.1 Tola = 1.1664 gram
- **Example**: 10 gram = 0.8574 tola = 8.574 lal

### SKU Format
- **PURCHASED**: `PUR-000001`
- **KARIGAR**: `KAR-000001`
- **TRADE**: `TRD-000001`

### Bill Structure
```typescript
// Owner view: sees jyala breakdown
{
  jyalaOwnerView: {
    makingCharge: "2000.00",
    stoneCharge: "500.00",
    total: "2500.00"
  }
}

// Customer view: sees only total
{
  jyala: "2500.00"  // no breakdown
}
```

### Financial Formula
```
grandTotal = metalValue + jyala + luxuryTax + vat + addon
balance = grandTotal - paidAmount
```

## 📖 Documentation

See [INTEGRATION_TESTS_GUIDE.md](./INTEGRATION_TESTS_GUIDE.md) for:
- Complete test flow descriptions
- Detailed business logic validation
- Troubleshooting guide
- Performance tips
- Future enhancements

## 🤝 Contributing Tests

When adding new endpoints:

1. Create corresponding integration test
2. Follow existing patterns (setup, assertions, cleanup)
3. Test both success and error paths
4. Validate business logic, not just status codes
5. Clean up in `afterAll` in child→parent order
6. Use `Date.now()` for unique test data

---

**Questions?** Check the logs for detailed error messages. Jest runs with `--verbose` by default for integration tests.

**Performance**: All 80 tests complete in ~2-3 minutes on a dev machine with local PostgreSQL.
