import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { assertIntegrationTestDatabase } from '../test-setup/assert-test-database';

/**
 * Integration tests for the Ledger profit / rate-comparison report.
 *
 * Verifies GET /ledger/profit:
 *  - requires auth
 *  - returns the expected { summary, data, meta } shape
 *  - computes metal-level profit for a PURCHASED → SOLD item using the
 *    actual purchase rate as cost basis
 *  - marks lines with no recoverable cost rate as UNKNOWN (excluded from totals)
 *  - supports metalTypeId filtering
 */
describe('Ledger Profit Report Integration Tests (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authToken: string;

  let goldMetalTypeId: string;
  let categoryId: string;
  let supplierId: string;

  // ids created by this suite — used for assertions + targeted cleanup
  const createdStockItemIds: string[] = [];
  let purchasedItemId: string;
  let purchasedBillNumber: string;
  let directItemId: string;
  let directBillNumber: string;

  const SUPPLIER_NAME = 'Ledger Profit Test Supplier';

  // Rates / weights chosen so the math is exact and easy to assert
  const SELL_RATE = 9500; // today's sell rate per gram
  const BUY_RATE = 9400;
  const PURCHASE_RATE = 9000; // what we "bought" the metal at
  const WEIGHT_GRAM = 10;

  beforeAll(async () => {
    assertIntegrationTestDatabase();
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1', {
      exclude: ['docs', 'docs-json', 'docs-yaml'],
    });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );

    await app.init();
    prisma = moduleRef.get<PrismaService>(PrismaService);

    // Auth
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'owner@jewelryflow.test', password: 'password123' });
    authToken = loginRes.body.data.accessToken;

    // Gold metal type
    const metalsRes = await request(app.getHttpServer())
      .get('/api/v1/rates/metal-types')
      .set('Authorization', `Bearer ${authToken}`);
    goldMetalTypeId = metalsRes.body.data.find(
      (m: any) => m.name.toLowerCase().includes('gold'),
    )?.id;

    // Today's rate
    await request(app.getHttpServer())
      .post('/api/v1/rates')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        metalTypeId: goldMetalTypeId,
        sellRatePerGram: SELL_RATE,
        buyRatePerGram: BUY_RATE,
      });

    // Category
    const catRes = await request(app.getHttpServer())
      .get('/api/v1/stock/categories')
      .set('Authorization', `Bearer ${authToken}`);
    categoryId = catRes.body.data[0].id;

    // Supplier (DIRECT) for the purchase-order flow
    const supRes = await request(app.getHttpServer())
      .post('/api/v1/suppliers')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: SUPPLIER_NAME, supplierType: 'DIRECT' });
    supplierId = supRes.body.data.id;
  });

  afterAll(async () => {
    // Child → parent cleanup. Only touch records this suite created.
    const bills = [purchasedBillNumber, directBillNumber].filter(Boolean);
    if (bills.length) {
      await prisma.paymentRecord.deleteMany({
        where: { transaction: { billNumber: { in: bills } } },
      });
      await prisma.transactionLine.deleteMany({
        where: { transaction: { billNumber: { in: bills } } },
      });
      await prisma.transaction.deleteMany({
        where: { billNumber: { in: bills } },
      });
    }
    // Deleting POs cascades their lines (which hold the stockItemId FK)
    await prisma.purchaseOrder.deleteMany({
      where: { supplier: { name: SUPPLIER_NAME } },
    });
    if (createdStockItemIds.length) {
      await prisma.stockItem.deleteMany({
        where: { id: { in: createdStockItemIds } },
      });
    }
    await prisma.supplier.deleteMany({ where: { name: SUPPLIER_NAME } });
    await app.close();
  });

  // ──────────────────────────────────────────────────────────────────────────

  it('should reject unauthenticated access', async () => {
    await request(app.getHttpServer()).get('/api/v1/ledger/profit').expect(401);
  });

  it('should set up a PURCHASED → SOLD item and report its metal profit', async () => {
    // 1. Create a purchase order with a known purchase rate
    const poRes = await request(app.getHttpServer())
      .post('/api/v1/purchase-orders')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        supplierId,
        lines: [
          {
            description: 'Ledger Test Gold Ring',
            categoryId,
            metalTypeId: goldMetalTypeId,
            grossWeight: { value: WEIGHT_GRAM, unit: 'gram' },
            priceNpr: PURCHASE_RATE * WEIGHT_GRAM,
            rateAtPurchasePerGram: PURCHASE_RATE,
          },
        ],
      })
      .expect(201);

    const poId = poRes.body.data.id;

    // 2. Receive it → creates a stock item carrying the purchase rate
    await request(app.getHttpServer())
      .patch(`/api/v1/purchase-orders/${poId}/receive`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({})
      .expect(200);

    // 3. Resolve the created stock item id
    const poDetail = await request(app.getHttpServer())
      .get(`/api/v1/purchase-orders/${poId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    purchasedItemId = poDetail.body.data.lines[0].stockItem.id;
    createdStockItemIds.push(purchasedItemId);
    expect(purchasedItemId).toBeTruthy();

    // 4. Sell it at today's sell rate
    const sellRes = await request(app.getHttpServer())
      .post('/api/v1/sales/sell')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        newCustomerName: 'Ledger Test Customer',
        items: [{ stockItemId: purchasedItemId }],
        payment: { amountNpr: SELL_RATE * WEIGHT_GRAM, method: 'CASH' },
      })
      .expect(201);
    purchasedBillNumber = sellRes.body.data.billNumber;
    expect(purchasedBillNumber).toBeTruthy();

    // 5. Profit report should contain this line with exact math
    const res = await request(app.getHttpServer())
      .get('/api/v1/ledger/profit')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(res.body.data).toHaveProperty('summary');
    expect(res.body.data).toHaveProperty('data');
    expect(res.body.data).toHaveProperty('meta');

    const row = res.body.data.data.find(
      (r: any) => r.billNumber === purchasedBillNumber,
    );
    expect(row).toBeDefined();
    expect(row.costRateSource).toBe('PURCHASE_RATE');
    expect(row.costRatePerGram).toBe(PURCHASE_RATE.toFixed(2));
    expect(row.soldRatePerGram).toBe(SELL_RATE.toFixed(2));
    expect(row.billableGram).toBe(WEIGHT_GRAM.toFixed(4));
    expect(row.metalRevenueNpr).toBe((SELL_RATE * WEIGHT_GRAM).toFixed(2));
    expect(row.metalCostNpr).toBe((PURCHASE_RATE * WEIGHT_GRAM).toFixed(2));
    expect(row.metalProfitNpr).toBe(
      ((SELL_RATE - PURCHASE_RATE) * WEIGHT_GRAM).toFixed(2),
    );
  });

  it('should mark a sold item with no recoverable cost rate as UNKNOWN', async () => {
    // Directly created stock items have no entryRate / purchase rate
    const stockRes = await request(app.getHttpServer())
      .post('/api/v1/stock')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        origin: { type: 'PURCHASED' },
        categoryId,
        metalTypeId: goldMetalTypeId,
        grossWeight: { value: WEIGHT_GRAM, unit: 'gram' },
        jyalaBreakdown: {
          makingChargeNpr: 0,
          stoneChargeNpr: 0,
          motiChargeNpr: 0,
          malaChargeNpr: 0,
          otherChargeNpr: 0,
        },
        applyLuxuryTax: false,
        applyVat: false,
      })
      .expect(201);
    directItemId = stockRes.body.data.id;
    createdStockItemIds.push(directItemId);

    const sellRes = await request(app.getHttpServer())
      .post('/api/v1/sales/sell')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        newCustomerName: 'Ledger Test Customer',
        items: [{ stockItemId: directItemId }],
        payment: { amountNpr: SELL_RATE * WEIGHT_GRAM, method: 'CASH' },
      })
      .expect(201);
    directBillNumber = sellRes.body.data.billNumber;

    const res = await request(app.getHttpServer())
      .get('/api/v1/ledger/profit')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    const row = res.body.data.data.find(
      (r: any) => r.billNumber === directBillNumber,
    );
    expect(row).toBeDefined();
    expect(row.costRateSource).toBe('UNKNOWN');
    expect(row.costRatePerGram).toBeNull();
    expect(row.metalCostNpr).toBeNull();
    expect(row.metalProfitNpr).toBeNull();
    // Revenue is still recorded even when cost is unknown
    expect(row.metalRevenueNpr).toBe((SELL_RATE * WEIGHT_GRAM).toFixed(2));

    // Summary should count both known + unknown lines
    expect(res.body.data.summary.linesWithKnownCost).toBeGreaterThanOrEqual(1);
    expect(res.body.data.summary.linesWithUnknownCost).toBeGreaterThanOrEqual(1);
  });

  it('should filter by metalTypeId', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/ledger/profit')
      .query({ metalTypeId: goldMetalTypeId })
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    // Every returned row must be the requested metal type
    for (const r of res.body.data.data) {
      if (r.metalType) expect(r.metalType.id).toBe(goldMetalTypeId);
    }
    const hasOurRow = res.body.data.data.some(
      (r: any) => r.billNumber === purchasedBillNumber,
    );
    expect(hasOurRow).toBe(true);
  });
});
