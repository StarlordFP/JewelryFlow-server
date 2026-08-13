import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { assertIntegrationTestDatabase } from '../test-setup/assert-test-database';

describe('Sales Bill Discount (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authToken: string;

  let goldMetalTypeId: string;
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
        name: `Discount Test Customer ${Date.now()}`,
        phone: `984${Math.floor(Math.random() * 10000000).toString().padStart(7, '0')}`,
      });
    customerId = custRes.body.data.id;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: { billNumber: { startsWith: 'BILL-' } },
    });
    await prisma.paymentRecord.deleteMany({
      where: { transaction: { notes: { startsWith: 'discount-test' } } },
    });
    await prisma.transactionLine.deleteMany({
      where: { transaction: { notes: { startsWith: 'discount-test' } } },
    });
    await prisma.transaction.deleteMany({
      where: { notes: { startsWith: 'discount-test' } },
    });
    await app.close();
  });

  async function createGoldStock(jyalaMaking: number): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/stock')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        origin: { type: 'PURCHASED' },
        categoryId,
        metalTypeId: goldMetalTypeId,
        grossWeight: { value: 10, unit: 'gram' },
        jyalaBreakdown: {
          makingChargeNpr: jyalaMaking,
          stoneChargeNpr: 0,
          motiChargeNpr: 0,
          malaChargeNpr: 0,
          otherChargeNpr: 0,
        },
        applyLuxuryTax: false,
        applyVat: false,
      })
      .expect(201);
    return res.body.data.id;
  }

  function sell(stockItemId: string, body: Record<string, unknown> = {}) {
    return request(app.getHttpServer())
      .post('/api/v1/sales/sell')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        customerId,
        items: [{ stockItemId }],
        payment: { amountNpr: 1, method: 'CASH' },
        notes: 'discount-test',
        ...body,
      });
  }

  it('discountNpr: 500 on 97,500 gold → grandTotalNpr = 97,000, discount stored', async () => {
    // 10g @ 9500 + jyala 2500 = 97,500 (already multiple of 100)
    const stockItemId = await createGoldStock(2500);

    const res = await sell(stockItemId, {
      discountNpr: 500,
      payment: { amountNpr: 97000, method: 'CASH' },
    }).expect(201);

    expect(Number(res.body.data.subTotalNpr)).toBe(97500);
    expect(Number(res.body.data.discountNpr)).toBe(500);
    expect(Number(res.body.data.roundingNpr)).toBe(0);
    expect(Number(res.body.data.grandTotalNpr)).toBe(97000);
    expect(Number(res.body.data.paidAmountNpr)).toBe(97000);
    expect(Number(res.body.data.balanceNpr)).toBe(0);
    expect(Number(res.body.data.customerBill.discount)).toBe(500);
    expect(Number(res.body.data.customerBill.grandTotal)).toBe(97000);

    const row = await prisma.transaction.findUnique({
      where: { id: res.body.data.id },
    });
    expect(Number(row!.subTotalNpr)).toBe(97500);
    expect(Number(row!.discountNpr)).toBe(500);
    expect(Number(row!.roundingNpr)).toBe(0);
    expect(Number(row!.grandTotalNpr)).toBe(97000);
    // grandTotal = ceil((subTotal - discount) / 100) * 100
    expect(Number(row!.grandTotalNpr)).toBe(
      Math.ceil((Number(row!.subTotalNpr) - Number(row!.discountNpr)) / 100) * 100,
    );
  });

  it('omitted discountNpr → same as today (0), no DISCOUNT_APPLIED audit', async () => {
    const stockItemId = await createGoldStock(2500);

    const res = await sell(stockItemId, {
      payment: { amountNpr: 97500, method: 'CASH' },
    }).expect(201);

    expect(Number(res.body.data.discountNpr)).toBe(0);
    expect(Number(res.body.data.grandTotalNpr)).toBe(97500);

    const discountAudits = await prisma.auditLog.findMany({
      where: { entityId: res.body.data.id, action: 'DISCOUNT_APPLIED' },
    });
    expect(discountAudits).toHaveLength(0);
  });

  it('discountNpr > subTotalNpr → 400 Bad Request', async () => {
    const stockItemId = await createGoldStock(2500);

    const res = await sell(stockItemId, { discountNpr: 100000 }).expect(400);
    expect(res.body.success).toBe(false);
    expect(String(res.body.message)).toMatch(/cannot exceed subTotalNpr/i);
  });

  it('discountNpr negative → 400 Bad Request', async () => {
    const stockItemId = await createGoldStock(2500);

    const res = await sell(stockItemId, { discountNpr: -10 }).expect(400);
    expect(res.body.success).toBe(false);
  });

  it('discountNpr > 0 → DISCOUNT_APPLIED audit with correct after values', async () => {
    const stockItemId = await createGoldStock(2500);

    const res = await sell(stockItemId, {
      discountNpr: 500,
      payment: { amountNpr: 97000, method: 'CASH' },
    }).expect(201);

    const audits = await prisma.auditLog.findMany({
      where: { entityId: res.body.data.id, action: 'DISCOUNT_APPLIED' },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0].after).toMatchObject({
      discountNpr: 500,
      subTotalNpr: 97500,
      preRoundingPayable: 97000,
      grandTotalNpr: 97000,
    });
  });
});
