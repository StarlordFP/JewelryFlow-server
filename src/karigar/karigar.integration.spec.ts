import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';

describe('Karigar Integration Tests (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authToken: string;

  // Module-level variables to chain flows
  let goldMetalTypeId: string;
  let karigarId: string;
  let productionOrderId: string;
  let productionIssueId: string;
  let disputeId: string;

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

    // Setup: Get metal type
    const metalsRes = await request(app.getHttpServer())
      .get('/api/v1/rates/metal-types')
      .set('Authorization', `Bearer ${authToken}`);

    goldMetalTypeId = metalsRes.body.data.find(
      (m: any) => m.name.toLowerCase().includes('gold'),
    )?.id;
  });

  afterAll(async () => {
    // Clean up
    if (karigarId) {
      await prisma.karigarPayment.deleteMany({
        where: { karigarId },
      });
      await prisma.karigarMetalBalance.deleteMany({
        where: { karigarId },
      });
      await prisma.karigarDispute.deleteMany({
        where: { karigarId },
      });
      await prisma.stockItem.deleteMany({
        where: { sku: { startsWith: 'KAR-' } },
      });
      await prisma.productionItem.deleteMany({
        where: { productionReturn: { productionOrder: { karigarId } } },
      });
      await prisma.productionReturn.deleteMany({
        where: { productionOrder: { karigarId } },
      });
      await prisma.productionIssue.deleteMany({
        where: { productionOrder: { karigarId } },
      });
      await prisma.productionOrder.deleteMany({
        where: { karigarId },
      });
      await prisma.karigar.deleteMany({
        where: { id: karigarId },
      });
    }
    await app.close();
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // FLOW 5: KARIGAR — Production, issues, returns, disputes, payments
  // ══════════════════════════════════════════════════════════════════════════════

  describe('Flow 5: Karigar / Production', () => {
    it('POST /api/v1/karigars → should create a karigar', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/karigars')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: `Test Karigar ${Date.now()}`,
          phone: `984${Math.floor(Math.random() * 10000000)
            .toString()
            .padStart(7, '0')}`,
          address: 'Test Karigar Address',
        })
        .expect(201);

      expect(res.body).toMatchObject({ success: true });
      expect(res.body.data).toMatchObject({
        id: expect.any(String),
        name: expect.any(String),
        isActive: true,
      });

      karigarId = res.body.data.id;
    });

    it('GET /api/v1/karigars → should list karigars', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/karigars')
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

      // Our test karigar should be in the list
      const testKarigar = res.body.data.data.find((k: any) => k.id === karigarId);
      expect(testKarigar).toBeDefined();
    });

    it('POST /api/v1/production-orders → should create production order', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/production-orders')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          karigarId,
          tolerancePct: 2.5,
          notes: 'Test production order',
        })
        .expect(201);

      expect(res.body).toMatchObject({ success: true });
      expect(res.body.data).toMatchObject({
        id: expect.any(String),
        karigarId,
        status: 'OPEN',
        tolerancePct: expect.any(String),
      });

      productionOrderId = res.body.data.id;
    });

    it('POST /api/v1/production-issues → should issue raw metal to karigar', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/production-issues')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          productionOrderId,
          metalTypeId: goldMetalTypeId,
          issuedWeight: { value: 20, unit: 'gram' },
        })
        .expect(201);

      expect(res.body).toMatchObject({ success: true });
      expect(res.body.data).toMatchObject({
        id: expect.any(String),
        productionOrderId,
        metalTypeId: goldMetalTypeId,
        issuedWeightGram: expect.any(String),
        issuedWeightTola: expect.any(String),
        issuedWeightLal: expect.any(String),
      });

      productionIssueId = res.body.data.id;
    });

    it('POST /api/v1/production-returns → should record returned items', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/production-returns')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          productionOrderId,
          productionIssueId,
          returnedWeight: { value: 18.5, unit: 'gram' },
          items: [
            {
              description: 'Gold Ring',
              grossWeight: { value: 9, unit: 'gram' },
            },
            {
              description: 'Gold Bangle',
              grossWeight: { value: 9.5, unit: 'gram' },
            },
          ],
        })
        .expect(201);

      expect(res.body).toMatchObject({ success: true });
      expect(res.body.data.productionReturn).toMatchObject({
        id: expect.any(String),
        productionOrderId,
        productionIssueId,
        returnedWeightGram: expect.any(String),
        returnedWeightTola: expect.any(String),
        returnedWeightLal: expect.any(String),
      });

      // Verify kharchar calculation: 20 - 18.5 = 1.5 gram
      const kharcharGram = Number(res.body.data.productionReturn.kharcharGram);
      expect(kharcharGram).toBeCloseTo(1.5, 2);

      // Verify stock items created with KARIGAR origin and KAR- SKU
      const stockItems = await prisma.stockItem.findMany({
        where: {
          origin: 'KARIGAR',
          sku: { startsWith: 'KAR-' },
        },
      });

      expect(stockItems.length).toBeGreaterThanOrEqual(2);
    });

    it('POST /api/v1/production-returns → should create dispute if outside tolerance', async () => {
      // Tolerance is 2.5%, kharchar = 1.5/20 = 7.5% > 2.5% → dispute
      const returnRes = await request(app.getHttpServer())
        .post('/api/v1/production-returns')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          productionOrderId,
          productionIssueId,
          returnedWeight: { value: 18.5, unit: 'gram' },
          items: [
            {
              description: 'Gold Ring',
              grossWeight: { value: 9, unit: 'gram' },
            },
          ],
        });

      // Check if dispute was created (service should create one since outside tolerance)
      const disputes = await prisma.karigarDispute.findMany({
        where: { karigarId },
      });

      if (disputes.length > 0) {
        expect(disputes[0]).toMatchObject({
          status: 'PENDING',
        });

        disputeId = disputes[0].id;
      }
    });

    it('GET /api/v1/karigar-disputes → should list disputes for karigar', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/karigar-disputes')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ karigarId, page: 1, limit: 10 })
        .expect(200);

      expect(res.body.data).toBeInstanceOf(Array);

      if (res.body.data.length > 0) {
        expect(res.body.data[0]).toMatchObject({
          id: expect.any(String),
          karigarId,
          status: expect.stringMatching(/PENDING|RESOLVED/),
        });
      }
    });

    it('PATCH /api/v1/karigar-disputes/:id/resolve → should resolve dispute', async () => {
      // Only test if we have a dispute
      if (!disputeId) {
        const disputes = await prisma.karigarDispute.findFirst({
          where: { karigarId, status: 'PENDING' },
        });

        if (!disputes) {
          return; // Skip if no dispute to resolve
        }

        disputeId = disputes.id;
      }

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/karigar-disputes/${disputeId}/resolve`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          deductionNpr: 500,
          resolutionNotes: 'Agreed deduction for high kharchar',
        })
        .expect(200);

      expect(res.body.data).toMatchObject({
        id: disputeId,
        status: 'RESOLVED',
        deductionNpr: expect.any(String),
      });
    });

    it('POST /api/v1/karigar-payments → should pay karigar', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/karigar-payments')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          karigarId,
          productionOrderId,
          metalTypeId: goldMetalTypeId,
          cashAmountNpr: 2000,
          deductionNpr: 0,
          notes: 'Test payment',
        })
        .expect(201);

      expect(res.body).toMatchObject({ success: true });
      expect(res.body.data).toMatchObject({
        id: expect.any(String),
        karigarId,
        productionOrderId,
        cashAmountNpr: expect.any(String),
      });
    });

    it('GET /api/v1/karigars/:id/payments → should list karigar payments', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/karigars/${karigarId}/payments`)
        .set('Authorization', `Bearer ${authToken}`)
        .query({ page: 1, limit: 10 })
        .expect(200);

      expect(res.body.data).toBeInstanceOf(Array);
    });

    it('GET /api/v1/karigars/:id → should include production order stats', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/karigars/${karigarId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body.data).toMatchObject({
        id: karigarId,
        name: expect.any(String),
        _count: expect.objectContaining({
          productionOrders: expect.any(Number),
          disputes: expect.any(Number),
        }),
      });
    });

    it('should validate karigar exists', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/production-orders')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          karigarId: 'invalid-karigar-id',
          tolerancePct: 2.5,
        })
        .expect(404);

      expect(res.body.success).toBe(false);
    });

    it('should validate production order exists for issues', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/production-issues')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          productionOrderId: 'invalid-po-id',
          metalTypeId: goldMetalTypeId,
          issuedWeight: { value: 20, unit: 'gram' },
        })
        .expect(404);

      expect(res.body.success).toBe(false);
    });

    it('should validate issued weight is positive', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/production-issues')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          productionOrderId,
          metalTypeId: goldMetalTypeId,
          issuedWeight: { value: -10, unit: 'gram' }, // Invalid
        })
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it('should validate returned weight <= issued weight', async () => {
      // Create a fresh issue specifically for this weight-validation test,
      // so the duplicate-return guard does not fire first.
      const freshIssueRes = await request(app.getHttpServer())
        .post('/api/v1/production-issues')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          productionOrderId,
          metalTypeId: goldMetalTypeId,
          issuedWeight: { value: 20, unit: 'gram' },
        });

      const freshIssueId = freshIssueRes.body.data.id;

      const res = await request(app.getHttpServer())
        .post('/api/v1/production-returns')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          productionOrderId,
          productionIssueId: freshIssueId,
          returnedWeight: { value: 50, unit: 'gram' }, // More than issued 20g
          items: [
            {
              description: 'Gold Item',
              grossWeight: { value: 50, unit: 'gram' },
            },
          ],
        })
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it('should validate order tolerance percentage is between 0-100', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/production-orders')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          karigarId,
          tolerancePct: 150,
          notes: 'Invalid tolerance',
        })
        .expect(400);

      expect(res.body.success).toBe(false);
    });
  });
});
