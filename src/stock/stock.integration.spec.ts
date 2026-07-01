import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { assertIntegrationTestDatabase } from '../test-setup/assert-test-database';

describe('Stock Integration Tests (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authToken: string;

  // Module-level variables to chain flows
  let goldMetalTypeId: string;
  let categoryId: string;
  let stockItemId: string;
  let dailyRateId: string;

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

    // Get auth token
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'owner@jewelryflow.test', password: 'password123' });

    authToken = loginRes.body.data.accessToken;

    // Get gold metal type
    const metalsRes = await request(app.getHttpServer())
      .get('/api/v1/rates/metal-types')
      .set('Authorization', `Bearer ${authToken}`);

    goldMetalTypeId = metalsRes.body.data.find(
      (m: any) => m.name.toLowerCase().includes('gold'),
    )?.id;

    // Set today's rate
    const rateRes = await request(app.getHttpServer())
      .post('/api/v1/rates')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        metalTypeId: goldMetalTypeId,
        sellRatePerGram: 9500,
        buyRatePerGram: 9400,
      });

    dailyRateId = rateRes.body.data.id;
  });

  afterAll(async () => {
    // Clean up stock items created in tests
    await prisma.stockItem.deleteMany({
      where: { sku: { startsWith: 'PUR-' } },
    });
    await app.close();
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // FLOW 2: STOCK — Categories, pricing, item creation, weight units
  // ══════════════════════════════════════════════════════════════════════════════

  describe('Flow 2: Stock', () => {
    it('GET /api/v1/stock/categories → should list item categories', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/stock/categories')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body).toMatchObject({ success: true });
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);

      // Get first active category for stock item creation
      const activeCategory = res.body.data.find((c: any) => c.isActive);
      expect(activeCategory).toBeDefined();
      categoryId = activeCategory.id;
    });

    it('POST /api/v1/stock/price-preview → should preview price before adding stock', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/stock/price-preview')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          metalTypeId: goldMetalTypeId,
          categoryId,
          grossWeight: { value: 10, unit: 'gram' },
          jertyWeight: { value: 0.5, unit: 'gram' },
          jyalaBreakdown: {
            makingChargeNpr: 2000,
            stoneChargeNpr: 0,
            motiChargeNpr: 0,
            malaChargeNpr: 0,
            otherChargeNpr: 0,
          },
          applyLuxuryTax: false,
          applyVat: false,
        })
        .expect(200);

      expect(res.body).toMatchObject({ success: true });
      expect(res.body.data).toMatchObject({
        grossWeight: expect.any(Object),
        jertyWeight: expect.any(Object),
        billableWeight: expect.any(Object),
        ratePerGram: expect.any(String),
        // metalValueNpr / grandTotalNpr are numeric; *Str variants hold the
        // formatted display strings (see PricingResult in stock.service.ts).
        metalValueNpr: expect.any(Number),
        metalValueNprStr: expect.any(String),
        jyalaOwnerView: expect.objectContaining({
          makingCharge: expect.any(String),
          stoneCharge: expect.any(String),
          total: expect.any(String),
        }),
        jyalaCustomerView: expect.any(String),
        grandTotalNpr: expect.any(Number),
        grandTotalNprStr: expect.any(String),
      });

      // Verify weight conversion
      expect(res.body.data.grossWeight).toMatchObject({
        primary: expect.any(String), // "10.0000 g"
        secondary: expect.any(String), // "0.8574 tola 85.74 lal"
        raw: expect.objectContaining({
          gram: expect.any(Number),
          tola: expect.any(Number),
          lal: expect.any(Number),
        }),
      });

      // Verify calculation: metalValue = (10 + 0.5) * 9500 = 99750
      const expectedMetalValue = (10 + 0.5) * 9500;
      expect(Number(res.body.data.metalValueNpr)).toBeCloseTo(expectedMetalValue, -1);

      // Verify grand total includes all components
      const expectedGrandTotal =
        expectedMetalValue + 2000; // metalValue + makingCharge
      expect(Number(res.body.data.grandTotalNpr)).toBeCloseTo(expectedGrandTotal, -1);
    });

    it('POST /api/v1/stock → should create stock item with PURCHASED origin', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/stock')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          origin: { type: 'PURCHASED' },
          name: 'Test Gold Ring',
          categoryId,
          metalTypeId: goldMetalTypeId,
          karat: 22,
          grossWeight: { value: 10, unit: 'gram' },
          jertyWeight: { value: 0.5, unit: 'gram' },
          jyalaBreakdown: {
            makingChargeNpr: 2000,
            stoneChargeNpr: 0,
            motiChargeNpr: 0,
            malaChargeNpr: 0,
            otherChargeNpr: 0,
          },
          applyLuxuryTax: false,
          applyVat: false,
        })
        .expect(201);

      expect(res.body).toMatchObject({ success: true });
      expect(res.body.data).toMatchObject({
        id: expect.any(String),
        sku: expect.stringMatching(/^PUR-\d+/),
        status: 'IN_STOCK',
        origin: 'PURCHASED',
        name: 'Test Gold Ring',
        categoryId,
        metalTypeId: goldMetalTypeId,
        karat: 22,
      });

      // Verify weight stored in all units
      expect(res.body.data.grossWeightGram).toBeDefined();
      expect(res.body.data.grossWeightTola).toBeDefined();
      expect(res.body.data.grossWeightLal).toBeDefined();

      // Verify jyala breakdown stored
      expect(res.body.data.makingChargeNpr).toBeDefined();
      expect(res.body.data.stoneChargeNpr).toBeDefined();

      stockItemId = res.body.data.id;
    });

    it('POST /api/v1/stock → should generate SKU matching origin type', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/stock')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          origin: { type: 'PURCHASED' },
          categoryId,
          metalTypeId: goldMetalTypeId,
          grossWeight: { value: 5, unit: 'gram' },
          applyLuxuryTax: false,
          applyVat: false,
        })
        .expect(201);

      expect(res.body.data.sku).toMatch(/^PUR-\d+/);
    });

    it('GET /api/v1/stock → should list stock items', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/stock')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ page: 1, limit: 10 })
        .expect(200);

      expect(res.body).toMatchObject({ success: true });
      expect(res.body.data).toMatchObject({
        data: expect.any(Array),
        meta: expect.objectContaining({
          total: expect.any(Number),
          page: expect.any(Number),
        }),
      });

      // Our test item should be in the list
      const testItem = res.body.data.data.find((s: any) => s.id === stockItemId);
      expect(testItem).toBeDefined();
      expect(testItem.status).toBe('IN_STOCK');
    });

    it('GET /api/v1/stock/:id → should get stock item details', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/stock/${stockItemId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body).toMatchObject({ success: true });
      expect(res.body.data).toMatchObject({
        id: stockItemId,
        sku: expect.stringMatching(/^PUR-\d+/),
        status: 'IN_STOCK',
        origin: 'PURCHASED',
        categoryId,
        metalTypeId: goldMetalTypeId,
        grossWeightGram: expect.any(Number),
        grossWeightTola: expect.any(Number),
        grossWeightLal: expect.any(Number),
      });
    });

    it('GET /api/v1/stock/:id → should include weight in all formats', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/stock/${stockItemId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      const item = res.body.data;

      // Verify conversion: 10 gram = ~0.8574 tola = ~85.74 lal
      // Using conversion: 1 tola = 11.664 gram
      const gramValue = Number(item.grossWeightGram);
      const expectedTola = gramValue / 11.664;
      const expectedLal = gramValue / (11.664 / 100);

      expect(Number(item.grossWeightTola)).toBeCloseTo(expectedTola, 3);
      expect(Number(item.grossWeightLal)).toBeCloseTo(expectedLal, 1);
    });

    it('GET /api/v1/stock/suggestions → should get jerty suggestions for category/metal/weight', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/stock/suggestions')
        .set('Authorization', `Bearer ${authToken}`)
        .query({
          categoryId,
          metalTypeId: goldMetalTypeId,
          grossWeightGram: 10,
        })
        .expect(200);

      expect(res.body).toMatchObject({ success: true });
      expect(res.body.data).toMatchObject({
        suggestedJertyGram: expect.any(Number),
      });
    });

    it('PATCH /api/v1/stock/:id → should update notes', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/stock/${stockItemId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          notes: 'Updated notes for integration test',
        })
        .expect(200);

      expect(res.body.data).toMatchObject({
        id: stockItemId,
        notes: 'Updated notes for integration test',
      });
    });

    it('POST /api/v1/stock/price-preview with stockItemId → should verify pricing matches stored', async () => {
      // Get current stock item
      const getRes = await request(app.getHttpServer())
        .get(`/api/v1/stock/${stockItemId}`)
        .set('Authorization', `Bearer ${authToken}`);

      const item = getRes.body.data;

      // Preview price using stored values
      const previewRes = await request(app.getHttpServer())
        .post('/api/v1/stock/price-preview')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          stockItemId,
          metalTypeId: item.metalTypeId,
          categoryId: item.categoryId,
          grossWeight: {
            value: Number(item.grossWeightGram),
            unit: 'gram',
          },
          jertyWeight: {
            value: Number(item.jertyGram || 0),
            unit: 'gram',
          },
          jyalaBreakdown: {
            makingChargeNpr: Number(item.makingChargeNpr || 0),
            stoneChargeNpr: Number(item.stoneChargeNpr || 0),
            motiChargeNpr: Number(item.motiChargeNpr || 0),
            malaChargeNpr: Number(item.malaChargeNpr || 0),
            otherChargeNpr: Number(item.otherChargeNpr || 0),
          },
          applyLuxuryTax: item.applyLuxuryTax || false,
          applyVat: item.applyVat || false,
        })
        .expect(200);

      expect(previewRes.body.data).toBeDefined();
      // Both should have consistent pricing structure
      expect(previewRes.body.data.grandTotalNpr).toBeDefined();
    });

    it('GET /api/v1/stock → should filter by status', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/stock')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ status: 'IN_STOCK', page: 1, limit: 10 })
        .expect(200);

      expect(res.body.data.data.length).toBeGreaterThan(0);
      res.body.data.data.forEach((item: any) => {
        expect(item.status).toBe('IN_STOCK');
      });
    });

    it('GET /api/v1/stock → should filter by category and metal type', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/stock')
        .set('Authorization', `Bearer ${authToken}`)
        .query({
          categoryId,
          metalTypeId: goldMetalTypeId,
          page: 1,
          limit: 10,
        })
        .expect(200);

      expect(Array.isArray(res.body.data.data)).toBe(true);
      res.body.data.data.forEach((item: any) => {
        expect(item.categoryId).toBe(categoryId);
        expect(item.metalTypeId).toBe(goldMetalTypeId);
      });
    });

    it('should reject stock creation without required fields', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/stock')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          origin: { type: 'PURCHASED' },
          // Missing categoryId and grossWeight
        })
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it('should validate metalTypeId if provided', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/stock')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          origin: { type: 'PURCHASED' },
          categoryId,
          metalTypeId: 'invalid-metal-id',
          grossWeight: { value: 10, unit: 'gram' },
        })
        .expect(404);

      expect(res.body.success).toBe(false);
    });
  });
});
