import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';

describe('Trade Integration Tests (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authToken: string;

  // Module-level variables to chain flows
  let goldMetalTypeId: string;
  let categoryId: string;
  let tradeSupplierId: string;
  let tradeId: string;

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
  });

  afterAll(async () => {
    // Clean up
    await prisma.tradeItem.deleteMany({});
    await prisma.trade.deleteMany({});
    await prisma.stockItem.deleteMany({
      where: { sku: { startsWith: 'TRD-' } },
    });
    if (tradeSupplierId) {
      await prisma.supplier.deleteMany({
        where: { id: tradeSupplierId },
      });
    }
    await prisma.supplier.deleteMany({
      where: { name: { contains: 'Direct Supplier' } },
    });
    await app.close();
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // FLOW 6: TRADE — Create trade supplier, issue/receive items, complete trade
  // ══════════════════════════════════════════════════════════════════════════════

  describe('Flow 6: Trade', () => {
    it('POST /api/v1/trade-parties → should create a TRADE supplier', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/trade-parties')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: `Trade Supplier ${Date.now()}`,
          phone: `984${Math.floor(Math.random() * 10000000)
            .toString()
            .padStart(7, '0')}`,
          address: 'Test Trade Supplier',
        })
        .expect(201);

      expect(res.body).toMatchObject({ success: true });
      expect(res.body.data).toMatchObject({
        id: expect.any(String),
        name: expect.any(String),
        supplierType: 'TRADE',
        isActive: true,
      });

      tradeSupplierId = res.body.data.id;
    });

    it('POST /api/v1/trades → should create a trade (give raw metal, receive finished items)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/trades')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          tradePartyId: tradeSupplierId,
          givenMetalTypeId: goldMetalTypeId,
          givenWeight: { value: 50, unit: 'gram' },
          rateAtTradePerGram: '9500',
          tradeItems: [
            {
              description: 'Gold Chain',
              categoryId,
              grossWeight: { value: 48, unit: 'gram' },
            },
          ],
          notes: 'Test trade',
        })
        .expect(201);

      expect(res.body).toMatchObject({ success: true });
      expect(res.body.data).toMatchObject({
        id: expect.any(String),
        supplierId: tradeSupplierId,
        status: 'PENDING',
        givenMetalTypeId: goldMetalTypeId,
        givenWeightGram: expect.any(String),
      });

      tradeId = res.body.data.id;
    });

    it('GET /api/v1/trades/:id → should verify trade details', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/trades/${tradeId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body).toMatchObject({ success: true });
      expect(res.body.data).toMatchObject({
        id: tradeId,
        supplierId: tradeSupplierId,
        status: 'PENDING',
        givenWeightGram: expect.any(String),
        givenWeightTola: expect.any(String),
        givenWeightLal: expect.any(String),
        tradeItems: expect.any(Array),
      });

      // Verify trade items in response
      expect(res.body.data.tradeItems.length).toBeGreaterThan(0);
      expect(res.body.data.tradeItems[0]).toMatchObject({
        description: expect.any(String),
        grossWeightGram: expect.any(String),
      });
    });

    it('PATCH /api/v1/trades/:id/status → should complete the trade', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/trades/${tradeId}/status`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ status: 'COMPLETED' })
        .expect(200);

      expect(res.body.data).toMatchObject({
        id: tradeId,
        status: 'COMPLETED',
      });
    });

    it('PATCH /api/v1/trades/:id/status → should create stock items with TRADE origin and TRD- SKU', async () => {
      // Verify stock items were created after trade completion
      const stockItems = await prisma.stockItem.findMany({
        where: {
          origin: 'TRADE',
          sku: { startsWith: 'TRD-' },
        },
      });

      expect(stockItems.length).toBeGreaterThan(0);

      // Verify all created items have TRD- prefix
      stockItems.forEach((item) => {
        expect(item.sku).toMatch(/^TRD-\d+/);
        expect(item.status).toBe('IN_STOCK');
      });
    });

    it('GET /api/v1/trade-parties/:id/summary → should show trade stats', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/trade-parties/${tradeSupplierId}/summary`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body.data).toMatchObject({
        totalTrades: expect.any(Number),
        totalGivenWeight: expect.any(Object),
        totalCashAdjustmentNpr: expect.any(String),
        byStatus: expect.any(Object),
        totalItemsReceived: expect.any(Number),
      });
    });

    it('GET /api/v1/trades → should list trades', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/trades')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ page: 1, limit: 10 })
        .expect(200);

      expect(res.body.data).toMatchObject({
        data: expect.any(Array),
        meta: expect.objectContaining({
          total: expect.any(Number),
          page: expect.any(Number),
        }),
      });

      // Our test trade should be in the list
      const testTrade = res.body.data.data.find((t: any) => t.id === tradeId);
      expect(testTrade).toBeDefined();
    });

    it('GET /api/v1/trades → should filter by status', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/trades')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ status: 'COMPLETED', page: 1, limit: 10 })
        .expect(200);

      res.body.data.data.forEach((trade: any) => {
        expect(trade.status).toBe('COMPLETED');
      });
    });

    it('GET /api/v1/trades → should filter by supplier', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/trades')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ tradePartyId: tradeSupplierId, page: 1, limit: 10 })
        .expect(200);

      res.body.data.data.forEach((trade: any) => {
        expect(trade.supplierId).toBe(tradeSupplierId);
      });
    });

    it('POST /api/v1/trades → should reject if supplier is not TRADE type', async () => {
      // Create a DIRECT supplier (not TRADE)
      const directSupplierRes = await request(app.getHttpServer())
        .post('/api/v1/suppliers')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'Direct Supplier',
          supplierType: 'DIRECT',
        })
        .expect(201);

      const directSupplierId = directSupplierRes.body.data.id;

      // Try to create trade with DIRECT supplier (should fail)
      const res = await request(app.getHttpServer())
        .post('/api/v1/trades')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          tradePartyId: directSupplierId,
          givenMetalTypeId: goldMetalTypeId,
          givenWeight: { value: 50, unit: 'gram' },
          rateAtTradePerGram: '9500',
          tradeItems: [
            {
              description: 'Gold Item',
              categoryId,
              grossWeight: { value: 48, unit: 'gram' },
            },
          ],
        })
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it('PATCH /api/v1/trades/:id/status → should cancel PENDING trade', async () => {
      // Create a new trade
      const createRes = await request(app.getHttpServer())
        .post('/api/v1/trades')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          tradePartyId: tradeSupplierId,
          givenMetalTypeId: goldMetalTypeId,
          givenWeight: { value: 30, unit: 'gram' },
          rateAtTradePerGram: '9500',
          tradeItems: [
            {
              description: 'Gold Item',
              categoryId,
              grossWeight: { value: 28, unit: 'gram' },
            },
          ],
        })
        .expect(201);

      const tradeIdToCancel = createRes.body.data.id;

      // Cancel it
      const cancelRes = await request(app.getHttpServer())
        .patch(`/api/v1/trades/${tradeIdToCancel}/status`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ status: 'CANCELLED' })
        .expect(200);

      expect(cancelRes.body.data.status).toBe('CANCELLED');
    });

    it('PATCH /api/v1/trades/:id/status → should not allow cancel if already completed', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/trades/${tradeId}/status`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ status: 'CANCELLED' })
        .expect(409); // Conflict — can't cancel completed trade

      expect(res.body.success).toBe(false);
    });

    it('should validate supplier exists', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/trades')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          tradePartyId: 'invalid-supplier-id',
          givenMetalTypeId: goldMetalTypeId,
          givenWeight: { value: 50, unit: 'gram' },
          rateAtTradePerGram: '9500',
          tradeItems: [
            {
              description: 'Gold Item',
              categoryId,
              grossWeight: { value: 48, unit: 'gram' },
            },
          ],
        })
        .expect(404);

      expect(res.body.success).toBe(false);
    });

    it('should validate metal type exists', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/trades')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          tradePartyId: tradeSupplierId,
          givenMetalTypeId: 'invalid-metal-id',
          givenWeight: { value: 50, unit: 'gram' },
          rateAtTradePerGram: '9500',
          tradeItems: [
            {
              description: 'Gold Item',
              categoryId,
              grossWeight: { value: 48, unit: 'gram' },
            },
          ],
        })
        .expect(404);

      expect(res.body.success).toBe(false);
    });

    it('should validate weight is positive', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/trades')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          tradePartyId: tradeSupplierId,
          givenMetalTypeId: goldMetalTypeId,
          givenWeight: { value: -50, unit: 'gram' },
          rateAtTradePerGram: '9500',
          tradeItems: [
            {
              description: 'Gold Item',
              categoryId,
              grossWeight: { value: 48, unit: 'gram' },
            },
          ],
        })
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it('should validate rate is positive', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/trades')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          tradePartyId: tradeSupplierId,
          givenMetalTypeId: goldMetalTypeId,
          givenWeight: { value: 50, unit: 'gram' },
          rateAtTradePerGram: '-9500',
          tradeItems: [
            {
              description: 'Gold Item',
              categoryId,
              grossWeight: { value: 48, unit: 'gram' },
            },
          ],
        })
        .expect(400);

      expect(res.body.success).toBe(false);
    });
  });
});
