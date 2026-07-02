import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { assertIntegrationTestDatabase } from '../test-setup/assert-test-database';

describe('Sales Bill Rounding (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authToken: string;

  let goldMetalTypeId: string;
  let silverMetalTypeId: string;
  let categoryId: string;
  let customerId: string;

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

    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'owner@jewelryflow.test', password: 'password123' });
    authToken = loginRes.body.data.accessToken;

    const metalsRes = await request(app.getHttpServer())
      .get('/api/v1/rates/metal-types')
      .set('Authorization', `Bearer ${authToken}`);

    goldMetalTypeId = metalsRes.body.data.find((m: { name: string }) =>
      m.name.toLowerCase().includes('gold'),
    )?.id;
    silverMetalTypeId = metalsRes.body.data.find((m: { name: string }) =>
      m.name.toLowerCase().includes('silver'),
    )?.id;

    await request(app.getHttpServer())
      .post('/api/v1/rates')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        metalTypeId: goldMetalTypeId,
        sellRatePerGram: 9500,
        buyRatePerGram: 9400,
      });

    await request(app.getHttpServer())
      .post('/api/v1/rates')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        metalTypeId: silverMetalTypeId,
        sellRatePerGram: 150,
        buyRatePerGram: 140,
      });

    const catRes = await request(app.getHttpServer())
      .get('/api/v1/stock/categories')
      .set('Authorization', `Bearer ${authToken}`);
    categoryId = catRes.body.data[0].id;

    const custRes = await request(app.getHttpServer())
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: `Rounding Test Customer ${Date.now()}`,
        phone: `984${Math.floor(Math.random() * 10000000).toString().padStart(7, '0')}`,
      });
    customerId = custRes.body.data.id;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: { billNumber: { startsWith: 'BILL-' } },
    });
    await prisma.paymentRecord.deleteMany({
      where: { transaction: { notes: { startsWith: 'rounding-test' } } },
    });
    await prisma.transactionLine.deleteMany({
      where: { transaction: { notes: { startsWith: 'rounding-test' } } },
    });
    await prisma.transaction.deleteMany({
      where: { notes: { startsWith: 'rounding-test' } },
    });
    await prisma.stockItem.deleteMany({
      where: { sku: { startsWith: 'PUR-ROUND-' } },
    });
    await app.close();
  });

  async function createStockItem(payload: Record<string, unknown>): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/stock')
      .set('Authorization', `Bearer ${authToken}`)
      .send(payload)
      .expect(201);
    return res.body.data.id;
  }

  async function sellItems(stockItemIds: string[]) {
    return request(app.getHttpServer())
      .post('/api/v1/sales/sell')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        customerId,
        items: stockItemIds.map((stockItemId) => ({ stockItemId })),
        payment: { amountNpr: 1, method: 'CASH' },
        notes: 'rounding-test',
      })
      .expect(201);
  }

  it('gold non-round total → grandTotalNpr = 97500, roundingNpr = 53', async () => {
    const stockItemId = await createStockItem({
      origin: { type: 'PURCHASED' },
      categoryId,
      metalTypeId: goldMetalTypeId,
      grossWeight: { value: 10, unit: 'gram' },
      jyalaBreakdown: {
        makingChargeNpr: 2447,
        stoneChargeNpr: 0,
        motiChargeNpr: 0,
        malaChargeNpr: 0,
        otherChargeNpr: 0,
      },
      applyLuxuryTax: false,
      applyVat: false,
    });

    const res = await sellItems([stockItemId]);

    expect(Number(res.body.data.subTotalNpr)).toBe(97447);
    expect(Number(res.body.data.roundingNpr)).toBe(53);
    expect(Number(res.body.data.grandTotalNpr)).toBe(97500);
    expect(Number(res.body.data.customerBill.rounding)).toBe(53);

    const row = await prisma.transaction.findUnique({
      where: { id: res.body.data.id },
    });
    expect(Number(row!.subTotalNpr)).toBe(97447);
    expect(Number(row!.roundingNpr)).toBe(53);
    expect(Number(row!.grandTotalNpr)).toBe(97500);
  });

  it('silver-only total 3583 → grandTotalNpr = 3585, roundingNpr = 2', async () => {
    const stockItemId = await createStockItem({
      origin: { type: 'PURCHASED' },
      categoryId,
      metalTypeId: silverMetalTypeId,
      grossWeight: { value: 10, unit: 'gram' },
      jyalaBreakdown: {
        makingChargeNpr: 2083,
        stoneChargeNpr: 0,
        motiChargeNpr: 0,
        malaChargeNpr: 0,
        otherChargeNpr: 0,
      },
      applyLuxuryTax: false,
      applyVat: false,
    });

    const res = await sellItems([stockItemId]);
    expect(Number(res.body.data.subTotalNpr)).toBe(3583);
    expect(Number(res.body.data.roundingNpr)).toBe(2);
    expect(Number(res.body.data.grandTotalNpr)).toBe(3585);
  });

  it('already-round gold total → roundingNpr = 0, no ROUNDING_APPLIED audit', async () => {
    const stockItemId = await createStockItem({
      origin: { type: 'PURCHASED' },
      categoryId,
      metalTypeId: goldMetalTypeId,
      grossWeight: { value: 10, unit: 'gram' },
      jyalaBreakdown: {
        makingChargeNpr: 2500,
        stoneChargeNpr: 0,
        motiChargeNpr: 0,
        malaChargeNpr: 0,
        otherChargeNpr: 0,
      },
      applyLuxuryTax: false,
      applyVat: false,
    });

    const res = await sellItems([stockItemId]);
    expect(Number(res.body.data.subTotalNpr)).toBe(97500);
    expect(Number(res.body.data.roundingNpr)).toBe(0);
    expect(Number(res.body.data.grandTotalNpr)).toBe(97500);

    const roundingAudits = await prisma.auditLog.findMany({
      where: { entityId: res.body.data.id, action: 'ROUNDING_APPLIED' },
    });
    expect(roundingAudits).toHaveLength(0);
  });

  it('mixed gold+silver bill → gold unit (100) applied to combined total', async () => {
    const goldItemId = await createStockItem({
      origin: { type: 'PURCHASED' },
      categoryId,
      metalTypeId: goldMetalTypeId,
      grossWeight: { value: 10, unit: 'gram' },
      jyalaBreakdown: {
        makingChargeNpr: 2447,
        stoneChargeNpr: 0,
        motiChargeNpr: 0,
        malaChargeNpr: 0,
        otherChargeNpr: 0,
      },
      applyLuxuryTax: false,
      applyVat: false,
    });

    const silverItemId = await createStockItem({
      origin: { type: 'PURCHASED' },
      categoryId,
      metalTypeId: silverMetalTypeId,
      grossWeight: { value: 10, unit: 'gram' },
      jyalaBreakdown: {
        makingChargeNpr: 2083,
        stoneChargeNpr: 0,
        motiChargeNpr: 0,
        malaChargeNpr: 0,
        otherChargeNpr: 0,
      },
      applyLuxuryTax: false,
      applyVat: false,
    });

    const res = await sellItems([goldItemId, silverItemId]);
    const subTotal = Number(res.body.data.subTotalNpr);
    expect(subTotal).toBe(97447 + 3583);
    expect(Number(res.body.data.grandTotalNpr)).toBe(101100);
    expect(Number(res.body.data.roundingNpr)).toBe(70);

    const roundingAudits = await prisma.auditLog.findMany({
      where: { entityId: res.body.data.id, action: 'ROUNDING_APPLIED' },
    });
    expect(roundingAudits).toHaveLength(1);
    expect(roundingAudits[0].after).toMatchObject({
      unit: 100,
      roundingNpr: expect.any(String),
    });
  });
});
