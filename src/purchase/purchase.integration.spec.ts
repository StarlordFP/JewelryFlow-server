import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';

describe('Purchase Orders Integration Tests (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authToken: string;

  // Module-level variables to chain flows
  let goldMetalTypeId: string;
  let categoryId: string;
  let supplierId: string;
  let purchaseOrderId: string;
  let purchaseOrderLineId: string;

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
    // Clean up purchase orders and related stock items
    if (supplierId) {
      await prisma.purchaseOrderLine.deleteMany({
        where: { purchaseOrder: { supplierId } },
      });
      await prisma.purchaseOrder.deleteMany({
        where: { supplierId },
      });
    }
    await prisma.stockItem.deleteMany({
      where: { sku: { startsWith: 'PUR-' } },
    });
    if (supplierId) {
      await prisma.supplier.deleteMany({
        where: { id: supplierId },
      });
    }
    await app.close();
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // FLOW 4: PURCHASE — Orders, suppliers, receive, cancel
  // ══════════════════════════════════════════════════════════════════════════════

  describe('Flow 4: Purchase Orders', () => {
    it('POST /api/v1/suppliers → should create a DIRECT supplier', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/suppliers')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: `Test Supplier ${Date.now()}`,
          phone: `984${Math.floor(Math.random() * 10000000)
            .toString()
            .padStart(7, '0')}`,
          address: 'Test Supplier Address',
          supplierType: 'DIRECT',
        })
        .expect(201);

      expect(res.body).toMatchObject({ success: true });
      expect(res.body.data).toMatchObject({
        id: expect.any(String),
        name: expect.any(String),
        supplierType: 'DIRECT',
        isActive: true,
      });

      supplierId = res.body.data.id;
    });

    it('GET /api/v1/suppliers → should list suppliers', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/suppliers')
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

      // Our test supplier should be in the list
      const testSupplier = res.body.data.data.find((s: any) => s.id === supplierId);
      expect(testSupplier).toBeDefined();
    });

    it('POST /api/v1/purchase-orders → should create a purchase order', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/purchase-orders')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          supplierId,
          lines: [
            {
              description: 'Necklace from Sharma batch',
              itemName: 'Gold Necklace',
              categoryId,
              metalTypeId: goldMetalTypeId,
              grossWeight: { value: 15, unit: 'gram' },
              jertyWeight: { value: 0.5, unit: 'gram' },
              priceNpr: 142500,
            },
          ],
          notes: 'Test purchase order',
        })
        .expect(201);

      expect(res.body).toMatchObject({ success: true });
      expect(res.body.data).toMatchObject({
        id: expect.any(String),
        supplierId,
        status: 'PENDING',
        totalNpr: expect.any(String),
      });

      purchaseOrderId = res.body.data.id;
      purchaseOrderLineId = res.body.data.lines[0].id;
    });

    it('GET /api/v1/purchase-orders/:id → should verify PO details', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/purchase-orders/${purchaseOrderId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body).toMatchObject({ success: true });
      expect(res.body.data).toMatchObject({
        id: purchaseOrderId,
        supplierId,
        status: 'PENDING',
        lines: expect.any(Array),
      });

      // Verify line details
      expect(res.body.data.lines[0]).toMatchObject({
        description: expect.any(String),
        categoryId,
        metalTypeId: goldMetalTypeId,
        grossWeightGram: expect.any(String),
        grossWeightTola: expect.any(String),
        grossWeightLal: expect.any(String),
      });
    });

    it('PATCH /api/v1/purchase-orders/:id/receive → should receive PO and create stock item', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/purchase-orders/${purchaseOrderId}/receive`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          lineUpdates: [
            {
              lineId: purchaseOrderLineId,
              grossWeight: { value: 15, unit: 'gram' },
              jertyWeight: { value: 0.5, unit: 'gram' },
            },
          ],
        })
        .expect(200);

      expect(res.body.data).toMatchObject({
        id: purchaseOrderId,
        status: 'RECEIVED',
      });

      // Verify stock item linked to this PO line
      const poLine = await prisma.purchaseOrderLine.findUnique({
        where: { id: purchaseOrderLineId },
        include: { stockItem: true },
      });
      expect(poLine?.stockItem?.sku).toMatch(/^PUR-\d+/);
      expect(poLine?.stockItem?.name).toBe('Gold Necklace');
    });

    it('PATCH /api/v1/purchase-orders/:id/receive → created stock item should have IN_STOCK status', async () => {
      // Create another PO
      const createRes = await request(app.getHttpServer())
        .post('/api/v1/purchase-orders')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          supplierId,
          lines: [
            {
              description: 'Ring order line',
              itemName: 'Gold Ring',
              categoryId,
              metalTypeId: goldMetalTypeId,
              grossWeight: { value: 10, unit: 'gram' },
              jertyWeight: { value: 0.3, unit: 'gram' },
              priceNpr: 95000,
            },
          ],
        });

      const poId = createRes.body.data.id;
      const poLineId = createRes.body.data.lines[0].id;

      // Receive it
      await request(app.getHttpServer())
        .patch(`/api/v1/purchase-orders/${poId}/receive`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          lineUpdates: [
            {
              lineId: poLineId,
              grossWeight: { value: 10, unit: 'gram' },
              jertyWeight: { value: 0.3, unit: 'gram' },
            },
          ],
        });

      // Find the created stock item
      const stockItems = await prisma.stockItem.findMany({
        where: { origin: 'PURCHASED', sku: { startsWith: 'PUR-' } },
      });

      const createdItem = stockItems[stockItems.length - 1];
      expect(createdItem.status).toBe('IN_STOCK');
      expect(createdItem.name).toBe('Gold Ring');
    });

    it('PATCH /api/v1/purchase-orders/:id/cancel → should not allow cancel if already received', async () => {
      // Try to cancel the already-received PO
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/purchase-orders/${purchaseOrderId}/cancel`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(409); // Conflict — can't cancel received PO

      expect(res.body.success).toBe(false);
    });

    it('PATCH /api/v1/purchase-orders/:id/cancel → should cancel PENDING PO', async () => {
      // Create a new PO
      const createRes = await request(app.getHttpServer())
        .post('/api/v1/purchase-orders')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          supplierId,
          lines: [
            {
              description: 'Bangle PO line',
              itemName: 'Gold Bangle',
              categoryId,
              metalTypeId: goldMetalTypeId,
              grossWeight: { value: 20, unit: 'gram' },
              jertyWeight: { value: 1, unit: 'gram' },
              priceNpr: 190000,
            },
          ],
        });

      const poId = createRes.body.data.id;

      // Cancel it
      const cancelRes = await request(app.getHttpServer())
        .patch(`/api/v1/purchase-orders/${poId}/cancel`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(cancelRes.body.data).toMatchObject({
        id: poId,
        status: 'CANCELLED',
      });
    });

    it('GET /api/v1/purchase-orders?supplierId=xxx → should list supplier POs', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/purchase-orders')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ supplierId, page: 1, limit: 10 })
        .expect(200);

      expect(res.body.data).toMatchObject({
        data: expect.any(Array),
        meta: expect.any(Object),
      });

      // Should include our PO
      const poInList = res.body.data.data.find((po: any) => po.id === purchaseOrderId);
      expect(poInList).toBeDefined();
    });

    it('GET /api/v1/purchase-orders → should filter by status', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/purchase-orders')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ status: 'RECEIVED', page: 1, limit: 10 })
        .expect(200);

      res.body.data.data.forEach((po: any) => {
        expect(po.status).toBe('RECEIVED');
      });
    });

    it('should validate supplier exists', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/purchase-orders')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          supplierId: 'invalid-supplier-id',
          lines: [
            {
              description: 'Test item',
              itemName: 'Gold Item',
              categoryId,
              metalTypeId: goldMetalTypeId,
              grossWeight: { value: 10, unit: 'gram' },
              priceNpr: 95000,
            },
          ],
        })
        .expect(404);

      expect(res.body.success).toBe(false);
    });

    it('should validate required PO fields', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/purchase-orders')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          supplierId,
          // Missing lines and totalNpr
        })
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it('should validate line weights are positive', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/purchase-orders')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          supplierId,
          lines: [
            {
              description: 'Bad weight test',
              itemName: 'Invalid Item',
              categoryId,
              metalTypeId: goldMetalTypeId,
              grossWeight: { value: -10, unit: 'gram' }, // Invalid
              priceNpr: 95000,
            },
          ],
        })
        .expect(400);

      expect(res.body.success).toBe(false);
    });
  });
});
