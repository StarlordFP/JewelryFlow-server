import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';

describe('Rates Integration Tests (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authToken: string;

  // Module-level variables to store IDs for chaining flows
  let goldMetalTypeId: string;
  let silverMetalTypeId: string;
  let dailyRateId: string;

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

    // ────────────────────────────────────────────────────────────────────────
    // Get auth token — login with seeded OWNER user
    // ────────────────────────────────────────────────────────────────────────
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'owner@jewelryflow.test', password: 'password123' });

    if (!loginRes.body.data?.accessToken) {
      throw new Error(
        'Failed to get auth token. Ensure seeded OWNER user exists with email: owner@jewelryflow.test',
      );
    }

    authToken = loginRes.body.data.accessToken;
  });

  afterAll(async () => {
    // Clean up — delete all test rates (optional, as they don't interfere)
    // In real scenarios, you'd want to clean more aggressively
    await app.close();
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // FLOW 1: RATES — Get metal types, set rate, verify today's rate
  // ══════════════════════════════════════════════════════════════════════════════

  describe('Flow 1: Rates', () => {
    it('GET /api/v1/rates/metal-types → should list metal types', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/rates/metal-types')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body).toMatchObject({ success: true });
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);

      // Store Gold metal type ID for later use
      const goldMetal = res.body.data.find(
        (m: any) => m.name.toLowerCase().includes('gold'),
      );
      if (goldMetal) {
        goldMetalTypeId = goldMetal.id;
      } else {
        // Fallback: use first metal type
        goldMetalTypeId = res.body.data[0].id;
      }

      // Store silver for later tests
      const silverMetal = res.body.data.find(
        (m: any) => m.name.toLowerCase().includes('silver'),
      );
      if (silverMetal) {
        silverMetalTypeId = silverMetal.id;
      }

      expect(goldMetalTypeId).toBeDefined();
    });

    it('POST /api/v1/rates → should set today\'s gold rate (expires previous rate)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/rates')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          metalTypeId: goldMetalTypeId,
          sellRatePerGram: 9500,
          buyRatePerGram: 9400,
        })
        .expect(201);

      expect(res.body).toMatchObject({ success: true });
      expect(res.body.data).toMatchObject({
        isCurrent: true,
        metalType: expect.any(Object),
        updatedBy: expect.any(Object),
      });

      // Verify sell rate > buy rate
      expect(Number(res.body.data.sellRatePerGram)).toBeGreaterThan(
        Number(res.body.data.buyRatePerGram),
      );

      // Verify per-tola and per-lal derived correctly (~11.664 grams per tola)
      const sellPerTola = Number(res.body.data.sellRatePerTola);
      const sellPerGram = Number(res.body.data.sellRatePerGram);
      const expectedPerTola = sellPerGram * 11.664;
      expect(sellPerTola).toBeCloseTo(expectedPerTola, 0);

      dailyRateId = res.body.data.id;
    });

    it('POST /api/v1/rates → setting a new rate should expire previous rate (isCurrent=false)', async () => {
      // Get previous rate
      const previousRate = await prisma.dailyRate.findUnique({
        where: { id: dailyRateId },
      });
      expect(previousRate?.isCurrent).toBe(true);

      // Set a new rate
      const res = await request(app.getHttpServer())
        .post('/api/v1/rates')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          metalTypeId: goldMetalTypeId,
          sellRatePerGram: 9600,
          buyRatePerGram: 9500,
        })
        .expect(201);

      expect(res.body.data.isCurrent).toBe(true);
      const newRateId = res.body.data.id;

      // Old rate should now be expired
      const oldRateAfterUpdate = await prisma.dailyRate.findUnique({
        where: { id: dailyRateId },
      });
      expect(oldRateAfterUpdate?.isCurrent).toBe(false);

      // Update for next tests
      dailyRateId = newRateId;
    });

    it('POST /api/v1/rates → should reject if buy rate >= sell rate', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/rates')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          metalTypeId: goldMetalTypeId,
          sellRatePerGram: 9500,
          buyRatePerGram: 9500, // Same as sell — invalid
        })
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it('GET /api/v1/rates/today → should return only current rates', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/rates/today')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body).toMatchObject({ success: true });
      expect(Array.isArray(res.body.data)).toBe(true);

      // All returned rates should be current
      res.body.data.forEach((rate: any) => {
        expect(rate.isCurrent).toBe(true);
      });

      // Should include our gold rate
      const goldRate = res.body.data.find((r: any) => r.metalType.id === goldMetalTypeId);
      expect(goldRate).toBeDefined();
      expect(goldRate.sellRatePerGram).toEqual('9600.00');
    });

    it('GET /api/v1/rates/today/:metalTypeId → should return rate for specific metal', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/rates/today/${goldMetalTypeId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body).toMatchObject({ success: true });
      expect(res.body.data).toMatchObject({
        isCurrent: true,
        metalType: expect.objectContaining({ id: goldMetalTypeId }),
        sellRatePerGram: expect.any(String),
        buyRatePerGram: expect.any(String),
        sellRatePerTola: expect.any(String),
        buyRatePerTola: expect.any(String),
      });
    });

    it('GET /api/v1/rates/history → should return rate history paginated', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/rates/history')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ metalTypeId: goldMetalTypeId, page: 1, limit: 10 })
        .expect(200);

      expect(res.body).toMatchObject({ success: true });
      expect(res.body.data).toMatchObject({
        data: expect.any(Array),
        meta: expect.objectContaining({
          total: expect.any(Number),
          page: expect.any(Number),
          limit: expect.any(Number),
        }),
      });

      // Should contain multiple rates (at least the ones we created)
      expect(res.body.data.data.length).toBeGreaterThan(0);

      // Verify rates include both current and old
      const hasExpired = res.body.data.data.some((r: any) => r.isCurrent === false);
      expect(hasExpired).toBe(true);
    });

    it('GET /api/v1/rates/history → should filter by date range', async () => {
      const today = new Date();
      const startDate = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 days ago

      const res = await request(app.getHttpServer())
        .get('/api/v1/rates/history')
        .set('Authorization', `Bearer ${authToken}`)
        .query({
          metalTypeId: goldMetalTypeId,
          from: startDate.toISOString(),
          to: today.toISOString(),
          page: 1,
          limit: 10,
        })
        .expect(200);

      expect(res.body.data.data).toBeDefined();
      expect(Array.isArray(res.body.data.data)).toBe(true);
    });

    it('should validate ≥ 1 current rate per metal type', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/rates/today')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Count current rates per metal type
      const ratesByMetal = new Map<string, number>();
      res.body.data.forEach((rate: any) => {
        const metalId = rate.metalType.id;
        ratesByMetal.set(metalId, (ratesByMetal.get(metalId) ?? 0) + 1);
      });

      // Each metal should have exactly 1 current rate
      ratesByMetal.forEach((count) => {
        expect(count).toBe(1);
      });
    });

    it('POST /api/v1/rates/gold → should set gold rates derived from 24K base', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/rates/gold')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          gold24kSellPerTola: 120000,
          gold24kBuyPerTola: 118000,
        })
        .expect(201);

      expect(res.body).toMatchObject({ success: true });
      expect(res.body.data).toMatchObject({
        message: 'All gold rates set successfully',
        base: '24K sell: NPR 120,000.00/tola',
        rates: expect.any(Array),
      });

      // Find Gold 24K, 22K in derived list
      const rates = res.body.data.rates;
      const g24k = rates.find((r: any) => r.metal.includes('24K'));
      const g22k = rates.find((r: any) => r.metal.includes('22K'));

      expect(g24k).toBeDefined();
      expect(g24k.sellPerTola).toBe('120000.00');
      expect(g22k).toBeDefined();
      expect(g22k.sellPerTola).toBe('110004.00'); // 120000 * 0.9167
    });

    it('POST /api/v1/rates (silver) → should set silver rate using tola inputs', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/rates')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          metalTypeId: silverMetalTypeId,
          sellRatePerTola: 1450,
          buyRatePerTola: 1400,
        })
        .expect(201);

      expect(res.body).toMatchObject({ success: true });
      expect(res.body.data.sellRatePerTola).toBe('1450.00');
      expect(res.body.data.buyRatePerTola).toBe('1400.00');
    });

    it('POST /api/v1/rates (silver) → should set silver rate automatically when metalTypeId is omitted', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/rates')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          sellRatePerTola: 1500,
          buyRatePerTola: 1450,
        })
        .expect(201);

      expect(res.body).toMatchObject({ success: true });
      expect(res.body.data.metalType.name).toBe('Silver');
      expect(res.body.data.sellRatePerTola).toBe('1500.00');
      expect(res.body.data.buyRatePerTola).toBe('1450.00');
    });
  });
});
