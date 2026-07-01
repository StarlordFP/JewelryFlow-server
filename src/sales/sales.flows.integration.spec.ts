import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { assertIntegrationTestDatabase } from '../test-setup/assert-test-database';

describe('Sales flows (return, exchange, buyback, old gold)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authToken: string;
  let goldMetalTypeId: string;
  let categoryId: string;
  let customerId: string;

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
    return res.body.data?.id ?? (() => { throw new Error(JSON.stringify(res.body)); })();
  }

  async function sellItem(stockItemId: string) {
    return request(app.getHttpServer())
      .post('/api/v1/sales/sell')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        customerId,
        items: [{ stockItemId }],
        payment: { amountNpr: 50000, method: 'CASH' },
      });
  }

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
    prisma = moduleRef.get(PrismaService);

    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'owner@jewelryflow.test', password: 'password123' });
    authToken = loginRes.body.data.accessToken;

    const metalsRes = await request(app.getHttpServer())
      .get('/api/v1/rates/metal-types')
      .set('Authorization', `Bearer ${authToken}`);
    goldMetalTypeId = metalsRes.body.data.find((m: any) =>
      m.name.toLowerCase().includes('gold'),
    )?.id;

    await request(app.getHttpServer())
      .post('/api/v1/rates')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        metalTypeId: goldMetalTypeId,
        sellRatePerGram: 9500,
        buyRatePerGram: 9400,
      });

    const catRes = await request(app.getHttpServer())
      .get('/api/v1/stock/categories')
      .set('Authorization', `Bearer ${authToken}`);
    categoryId = catRes.body.data[0].id;

    const custRes = await request(app.getHttpServer())
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: `Flow Test Customer ${Date.now()}`,
        phone: `984${Math.floor(Math.random() * 10000000).toString().padStart(7, '0')}`,
      });
    customerId = custRes.body.data.id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Return', () => {
    it('within 7 days: stock SOLD → IN_STOCK, relatedTxId and line stockItemId set', async () => {
      const itemId = await createFreshStockItem();
      const sellRes = await sellItem(itemId);
      const originalTxId = sellRes.body.data.id;

      const returnRes = await request(app.getHttpServer())
        .post('/api/v1/sales/return')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          originalTxId,
          items: [{ stockItemId: itemId }],
          refund: { amountNpr: 1000, method: 'CASH' },
        })
        .expect(201);

      expect(returnRes.body.data.relatedTxId).toBe(originalTxId);
      expect(returnRes.body.data.lines[0].stockItemId).toBe(itemId);

      const stock = await prisma.stockItem.findUnique({ where: { id: itemId } });
      expect(stock?.status).toBe('IN_STOCK');
    });

    it('after 7 days: rejected, no return transaction, stock unchanged', async () => {
      const itemId = await createFreshStockItem();
      const sellRes = await sellItem(itemId);
      const originalTxId = sellRes.body.data.id;

      await prisma.transaction.update({
        where: { id: originalTxId },
        data: {
          returnDeadline: new Date(Date.now() - 86400000),
          createdAt: new Date(Date.now() - 10 * 86400000),
        },
      });

      const beforeCount = await prisma.transaction.count({ where: { txType: 'RETURN' } });

      await request(app.getHttpServer())
        .post('/api/v1/sales/return')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          originalTxId,
          items: [{ stockItemId: itemId }],
          refund: { amountNpr: 1000, method: 'CASH' },
        })
        .expect(400);

      const afterCount = await prisma.transaction.count({ where: { txType: 'RETURN' } });
      expect(afterCount).toBe(beforeCount);

      const stock = await prisma.stockItem.findUnique({ where: { id: itemId } });
      expect(stock?.status).toBe('SOLD');
    });

    it('legacy SELL (null returnDeadline): uses createdAt + 7 days', async () => {
      const itemId = await createFreshStockItem();
      const sellRes = await sellItem(itemId);
      const originalTxId = sellRes.body.data.id;

      await prisma.transaction.update({
        where: { id: originalTxId },
        data: {
          returnDeadline: null,
          createdAt: new Date(Date.now() - 3 * 86400000),
        },
      });

      await request(app.getHttpServer())
        .post('/api/v1/sales/return')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          originalTxId,
          items: [{ stockItemId: itemId }],
          refund: { amountNpr: 1000, method: 'CASH' },
        })
        .expect(201);
    });

    it('legacy SELL expired via createdAt fallback: rejected', async () => {
      const itemId = await createFreshStockItem();
      const sellRes = await sellItem(itemId);
      const originalTxId = sellRes.body.data.id;

      await prisma.transaction.update({
        where: { id: originalTxId },
        data: {
          returnDeadline: null,
          createdAt: new Date(Date.now() - 8 * 86400000),
        },
      });

      await request(app.getHttpServer())
        .post('/api/v1/sales/return')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          originalTxId,
          items: [{ stockItemId: itemId }],
          refund: { amountNpr: 1000, method: 'CASH' },
        })
        .expect(400);
    });

    it('item not SOLD: ConflictException, no return created', async () => {
      const itemId = await createFreshStockItem();
      const sellRes = await sellItem(itemId);
      const originalTxId = sellRes.body.data.id;

      await prisma.stockItem.update({
        where: { id: itemId },
        data: { status: 'IN_STOCK' },
      });

      const beforeCount = await prisma.transaction.count({
        where: { txType: 'RETURN', relatedTxId: originalTxId },
      });

      await request(app.getHttpServer())
        .post('/api/v1/sales/return')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          originalTxId,
          items: [{ stockItemId: itemId }],
          refund: { amountNpr: 1000, method: 'CASH' },
        })
        .expect(409);

      const afterCount = await prisma.transaction.count({
        where: { txType: 'RETURN', relatedTxId: originalTxId },
      });
      expect(afterCount).toBe(beforeCount);
    });
  });

  describe('Exchange', () => {
    it('atomic: itemsIn SOLD→IN_STOCK, itemsOut IN_STOCK→SOLD, relatedTxId when provided', async () => {
      const soldItemId = await createFreshStockItem();
      const outItemId = await createFreshStockItem();
      const sellRes = await sellItem(soldItemId);
      const originalTxId = sellRes.body.data.id;

      const res = await request(app.getHttpServer())
        .post('/api/v1/sales/exchange')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          customerId,
          relatedTxId: originalTxId,
          itemsIn: [{ stockItemId: soldItemId }],
          itemsOut: [{ stockItemId: outItemId }],
          payment: { amountNpr: 1000, method: 'CASH' },
        })
        .expect(201);

      expect(res.body.data.relatedTxId).toBe(originalTxId);
      expect(res.body.data.type).toBe('EXCHANGE');

      const soldBack = await prisma.stockItem.findUnique({ where: { id: soldItemId } });
      const takenOut = await prisma.stockItem.findUnique({ where: { id: outItemId } });
      expect(soldBack?.status).toBe('IN_STOCK');
      expect(takenOut?.status).toBe('SOLD');

      const lines = await prisma.transactionLine.findMany({
        where: { transactionId: res.body.data.id },
      });
      expect(lines.filter((l) => l.stockItemId).length).toBeGreaterThan(0);
    });

    it('rolls back incoming flip when outgoing item unavailable', async () => {
      const soldItemId = await createFreshStockItem();
      const badOutId = await createFreshStockItem();
      const sellRes = await sellItem(soldItemId);
      const originalTxId = sellRes.body.data.id;

      await prisma.stockItem.update({
        where: { id: badOutId },
        data: { status: 'SOLD' },
      });

      await request(app.getHttpServer())
        .post('/api/v1/sales/exchange')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          customerId,
          relatedTxId: originalTxId,
          itemsIn: [{ stockItemId: soldItemId }],
          itemsOut: [{ stockItemId: badOutId }],
          payment: { amountNpr: 0.01, method: 'CASH' },
        })
        .expect(409);

      const incoming = await prisma.stockItem.findUnique({ where: { id: soldItemId } });
      expect(incoming?.status).toBe('SOLD');
    });
  });

  describe('Buyback & Old Gold', () => {
    it('buyback creates stock, line, and BuybackRecord.stockItemId', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/sales/buyback')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          customerId,
          metalTypeId: goldMetalTypeId,
          buyRatePerGram: 9400,
          weight: { value: 5, unit: 'gram' },
          payment: { amountNpr: 47000, method: 'CASH' },
        })
        .expect(201);

      expect(res.body.data.createdStockItem?.sku).toMatch(/^PUR-/);
      expect(res.body.data.lines[0].stockItemId).toBeTruthy();

      const record = await prisma.buybackRecord.findUnique({
        where: { transactionId: res.body.data.id },
      });
      expect(record?.stockItemId).toBeTruthy();
      expect(record?.metalTypeId).toBe(goldMetalTypeId);

      const cat = await prisma.itemCategory.findFirst({ where: { name: 'Old Gold' } });
      expect(cat).toBeTruthy();

      const stock = await prisma.stockItem.findUnique({
        where: { id: record!.stockItemId! },
      });
      expect(stock?.origin).toBe('PURCHASED');
      expect(stock?.status).toBe('IN_STOCK');
    });

    it('old gold creates stock same as buyback', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/sales/old-gold')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          customerId,
          metalTypeId: goldMetalTypeId,
          buyRatePerGram: 9400,
          weight: { value: 3, unit: 'gram' },
          payment: { amountNpr: 28200, method: 'CASH' },
        })
        .expect(201);

      expect(res.body.data.createdStockItem?.sku).toMatch(/^PUR-/);
      const record = await prisma.buybackRecord.findUnique({
        where: { transactionId: res.body.data.id },
      });
      expect(record?.stockItemId).toBeTruthy();
    });
  });
});
