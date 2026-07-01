import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';

describe('Sales Integration Tests (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authToken: string;

  // Module-level variables to chain flows
  let goldMetalTypeId: string;
  let categoryId: string;
  let stockItemId: string;
  let customerId: string;
  let transactionId: string;
  let billNumber: string;

  /** Helper: create a fresh IN_STOCK item for each test that needs to sell */
  async function createFreshStockItem(): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/stock')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        origin: { type: 'PURCHASED' },
        categoryId,
        metalTypeId: goldMetalTypeId,
        grossWeight: { value: 10, unit: 'gram' },
        jyalaBreakdown: {
          makingChargeNpr: 2000,
          stoneChargeNpr: 500,
          motiChargeNpr: 0,
          malaChargeNpr: 0,
          otherChargeNpr: 0,
        },
        applyLuxuryTax: false,
        applyVat: false,
      });

    return res.body.data.id;
  }

  beforeAll(async () => {
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

    // Get auth token
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'owner@jewelryflow.test', password: 'password123' });

    authToken = loginRes.body.data.accessToken;

    // Setup: Get metal type and set rate
    const metalsRes = await request(app.getHttpServer())
      .get('/api/v1/rates/metal-types')
      .set('Authorization', `Bearer ${authToken}`);

    goldMetalTypeId = metalsRes.body.data.find(
      (m: any) => m.name.toLowerCase().includes('gold'),
    )?.id;

    await request(app.getHttpServer())
      .post('/api/v1/rates')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        metalTypeId: goldMetalTypeId,
        sellRatePerGram: 9500,
        buyRatePerGram: 9400,
      });

    // Get category
    const catRes = await request(app.getHttpServer())
      .get('/api/v1/stock/categories')
      .set('Authorization', `Bearer ${authToken}`);

    categoryId = catRes.body.data[0].id;

    // Create initial stock item (used by the first SELL test)
    stockItemId = await createFreshStockItem();
  });

  afterAll(async () => {
    // Clean up in child→parent order
    await prisma.paymentRecord.deleteMany({
      where: { transaction: { billNumber: { startsWith: 'BILL-' } } },
    });
    await prisma.transactionLine.deleteMany({
      where: { transaction: { billNumber: { startsWith: 'BILL-' } } },
    });
    await prisma.transaction.deleteMany({
      where: { billNumber: { startsWith: 'BILL-' } },
    });
    await prisma.stockItem.deleteMany({
      where: { sku: { startsWith: 'PUR-' } },
    });
    await prisma.customer.deleteMany({
      where: { name: { contains: 'Test Customer' } },
    });
    await app.close();
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // FLOW 3: SALES — Create bill, verify structure, payments, returns
  // ══════════════════════════════════════════════════════════════════════════════

  describe('Flow 3: Sales', () => {
    it('POST /api/v1/customers → should create test customer', async () => {
      const testName = `Test Customer ${Date.now()}`;
      const res = await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: testName,
          phone: `984${Math.floor(Math.random() * 10000000)
            .toString()
            .padStart(7, '0')}`,
          address: 'Test Address',
        })
        .expect(201);

      expect(res.body).toMatchObject({ success: true });
      expect(res.body.data).toMatchObject({
        id: expect.any(String),
        name: testName,
        isActive: true,
      });

      customerId = res.body.data.id;
    });

    it('POST /api/v1/sales/sell → should create SELL transaction with bill', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/sales/sell')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          customerId,
          items: [
            {
              stockItemId,
              jertyOverride: null,
              jyalaOverride: null,
            },
          ],
          payment: {
            amountNpr: 100000,
            method: 'CASH',
          },
          notes: 'Test sale',
        })
        .expect(201);

      expect(res.body).toMatchObject({ success: true });
      expect(res.body.data).toMatchObject({
        id: expect.any(String),
        billNumber: expect.stringMatching(/^BILL-\d{6}$/),
        type: 'SELL',
      });

      transactionId = res.body.data.id;
      billNumber = res.body.data.billNumber;
    });

    it('POST /api/v1/sales/sell → should verify bill structure for owner view', async () => {
      // Create a fresh stock item so we can sell it
      const freshItemId = await createFreshStockItem();

      const res = await request(app.getHttpServer())
        .post('/api/v1/sales/sell')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          customerId,
          items: [
            {
              stockItemId: freshItemId,
              jertyOverride: null,
              jyalaOverride: null,
            },
          ],
          payment: {
            amountNpr: 50000,
            method: 'CASH',
          },
        })
        .expect(201);

      expect(res.body.data.ownerBill).toBeDefined();
      expect(res.body.data.ownerBill).toMatchObject({
        billNumber: expect.stringMatching(/^BILL-\d{6}$/),
        customer: expect.objectContaining({
          name: expect.any(String),
        }),
        lines: expect.arrayContaining([
          expect.objectContaining({
            weight: expect.objectContaining({
              primary: expect.stringMatching(/^\d+\.\d{4} g$/),
              secondary: expect.stringMatching(/tola.*lal/),
              raw: expect.objectContaining({
                gram: expect.any(Number),
                tola: expect.any(Number),
                lal: expect.any(Number),
              }),
            }),
            jyalaOwnerView: expect.objectContaining({
              makingCharge: expect.any(String),
              stoneCharge: expect.any(String),
              total: expect.any(String),
            }),
          }),
        ]),
        grandTotal: expect.any(String),
        paid: expect.any(String),
        balance: expect.any(String),
      });
    });

    it('POST /api/v1/sales/sell → should verify customer bill structure (no jyala breakdown)', async () => {
      const freshItemId = await createFreshStockItem();

      const res = await request(app.getHttpServer())
        .post('/api/v1/sales/sell')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          customerId,
          items: [
            {
              stockItemId: freshItemId,
              jertyOverride: null,
              jyalaOverride: null,
            },
          ],
          payment: {
            amountNpr: 50000,
            method: 'CASH',
          },
        })
        .expect(201);

      expect(res.body.data.customerBill).toBeDefined();
      expect(res.body.data.customerBill).toMatchObject({
        billNumber: expect.stringMatching(/^BILL-\d{6}$/),
        lines: expect.arrayContaining([
          expect.objectContaining({
            jyala: expect.any(String), // single total
            lineTotal: expect.any(String),
          }),
        ]),
      });

      // Customer bill should NOT have jyalaOwnerView
      expect(res.body.data.customerBill.lines[0].jyalaOwnerView).toBeUndefined();
    });

    it('POST /api/v1/sales/sell → should mark stock item as SOLD', async () => {
      // stockItemId was sold in the first SELL test
      const getRes = await request(app.getHttpServer())
        .get(`/api/v1/stock/${stockItemId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(getRes.body.data.status).toBe('SOLD');
    });

    it('POST /api/v1/sales/sell → should calculate balance = grandTotal - paidAmount', async () => {
      const freshItemId = await createFreshStockItem();

      const res = await request(app.getHttpServer())
        .post('/api/v1/sales/sell')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          customerId,
          items: [
            {
              stockItemId: freshItemId,
              jertyOverride: null,
              jyalaOverride: null,
            },
          ],
          payment: {
            amountNpr: 50000,
            method: 'CASH',
          },
        })
        .expect(201);

      const grandTotal = Number(res.body.data.ownerBill.grandTotal);
      const paid = Number(res.body.data.ownerBill.paid);
      const balance = Number(res.body.data.ownerBill.balance);

      expect(balance).toBeCloseTo(grandTotal - paid, 0);
    });

    it('POST /api/v1/sales/sell → should reject if stock item is already SOLD', async () => {
      // Try to sell the same item again (stockItemId is already SOLD)
      const res = await request(app.getHttpServer())
        .post('/api/v1/sales/sell')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          customerId,
          items: [
            {
              stockItemId,
              jertyOverride: null,
              jyalaOverride: null,
            },
          ],
          payment: {
            amountNpr: 50000,
            method: 'CASH',
          },
        })
        .expect(409); // Conflict — item already sold

      expect(res.body.success).toBe(false);
    });

    it('GET /api/v1/sales/:id → should get transaction details', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/sales/${transactionId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body).toMatchObject({ success: true });
      expect(res.body.data).toMatchObject({
        id: transactionId,
        billNumber,
        type: 'SELL',
        customerId,
        grandTotalNpr: expect.any(String),
        balanceNpr: expect.any(String),
      });
    });

    it('GET /api/v1/sales?customerId=xxx → should list customer transactions', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/sales')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ customerId, page: 1, limit: 10 })
        .expect(200);

      expect(res.body.data).toMatchObject({
        data: expect.any(Array),
        meta: expect.any(Object),
      });

      // Should include our transaction
      const ourTx = res.body.data.data.find((t: any) => t.id === transactionId);
      expect(ourTx).toBeDefined();
    });

    it('POST /api/v1/sales/payment/:txId → should add partial payment', async () => {
      // Create a fresh stock item and sell it with partial payment
      const freshItemId = await createFreshStockItem();
      const createRes = await request(app.getHttpServer())
        .post('/api/v1/sales/sell')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          customerId,
          items: [
            {
              stockItemId: freshItemId,
              jertyOverride: null,
              jyalaOverride: null,
            },
          ],
          payment: {
            amountNpr: 30000,
            method: 'CASH',
          },
        });

      const txId = createRes.body.data.id;
      const initialBalance = Number(createRes.body.data.ownerBill.balance);

      // Add payment
      const payRes = await request(app.getHttpServer())
        .post(`/api/v1/sales/${txId}/payment`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          payment: {
            amountNpr: 10000,
            method: 'CASH',
          },
        })
        .expect(200);

      expect(payRes.body.data).toMatchObject({
        id: txId,
        balanceNpr: expect.any(String),
      });

      // Balance should be reduced by 10000
      const newBalance = Number(payRes.body.data.balanceNpr);
      expect(newBalance).toBeCloseTo(initialBalance - 10000, 0);
    });

    it('POST /api/v1/sales/payment/:txId → should create new paymentRecord', async () => {
      // Create a fresh stock item and sell it
      const freshItemId = await createFreshStockItem();
      const createRes = await request(app.getHttpServer())
        .post('/api/v1/sales/sell')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          customerId,
          items: [
            {
              stockItemId: freshItemId,
              jertyOverride: null,
              jyalaOverride: null,
            },
          ],
          payment: {
            amountNpr: 30000,
            method: 'CASH',
          },
        });

      const txId = createRes.body.data.id;

      // Get initial payment count
      const beforePayments = await prisma.paymentRecord.count({
        where: { transactionId: txId },
      });

      // Add payment
      await request(app.getHttpServer())
        .post(`/api/v1/sales/${txId}/payment`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          payment: {
            amountNpr: 5000,
            method: 'ONLINE',
            reference: 'eSewa-123456',
          },
        });

      // Payment count should increase
      const afterPayments = await prisma.paymentRecord.count({
        where: { transactionId: txId },
      });

      expect(afterPayments).toBe(beforePayments + 1);
    });

    it('POST /api/v1/sales/return → should return item within 7-day window', async () => {
      // Create a fresh stock item and sell it
      const freshItemId = await createFreshStockItem();
      const createRes = await request(app.getHttpServer())
        .post('/api/v1/sales/sell')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          customerId,
          items: [
            {
              stockItemId: freshItemId,
              jertyOverride: null,
              jyalaOverride: null,
            },
          ],
          payment: {
            amountNpr: 50000,
            method: 'CASH',
          },
        });

      const originalTxId = createRes.body.data.id;
      const lineId = createRes.body.data.lines[0].id;

      // Return the item
      const returnRes = await request(app.getHttpServer())
        .post('/api/v1/sales/return')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          originalTxId,
          items: [{ stockItemId: freshItemId, reason: 'Test return' }],
          refund: {
            amountNpr: 50000,
            method: 'CASH',
          },
          notes: 'Test return',
        })
        .expect(201);

      expect(returnRes.body.data).toMatchObject({
        billNumber: expect.stringMatching(/^BILL-\d{6}$/),
        type: 'RETURN',
      });

      // Stock item should be back to IN_STOCK
      const getStockRes = await request(app.getHttpServer())
        .get(`/api/v1/stock/${freshItemId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(getStockRes.body.data.status).toBe('IN_STOCK');
    });

    it('should validate payment amounts are positive', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/sales/sell')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          customerId,
          items: [{ stockItemId }],
          payment: {
            amountNpr: -1000, // Invalid: negative
            method: 'CASH',
          },
        })
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it('should validate required payment fields', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/sales/sell')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          customerId,
          items: [{ stockItemId }],
          payment: {
            // Missing amountNpr
            method: 'CASH',
          },
        })
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it('POST /api/v1/sales/sell → should auto-register a new customer if customerId is omitted but newCustomerName is provided', async () => {
      const freshItemId = await createFreshStockItem();
      const uniquePhone = `985${Math.floor(1000000 + Math.random() * 9000000)}`;

      const res = await request(app.getHttpServer())
        .post('/api/v1/sales/sell')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          newCustomerName: 'Auto Created Customer',
          newCustomerPhone: uniquePhone,
          newCustomerAddress: 'POS Street 12',
          items: [
            {
              stockItemId: freshItemId,
              jertyOverride: null,
              jyalaOverride: null,
            },
          ],
          payment: {
            amountNpr: 50000,
            method: 'CASH',
          },
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBeDefined();

      // Verify customer was created in DB and is linked to the transaction
      const txn = await prisma.transaction.findUnique({
        where: { id: res.body.data.id },
        include: { customer: true },
      });

      expect(txn?.customerId).toBeDefined();
      expect(txn?.customer?.name).toBe('Auto Created Customer');
      expect(txn?.customer?.address).toBe('POS Street 12');
    });
  });
});
