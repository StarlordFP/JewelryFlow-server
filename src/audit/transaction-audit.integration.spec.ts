import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { assertIntegrationTestDatabase } from '../test-setup/assert-test-database';
import * as auditWrite from './write-transaction-audit';

const realWriteTransactionAudit = auditWrite.writeTransactionAudit;

describe('Transaction Audit Log (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authToken: string;
  let ownerUserId: string;

  let goldMetalTypeId: string;
  let categoryId: string;
  let customerId: string;
  let soldStockItemId: string;
  let sellTxId: string;
  let sellBillNumber: string;

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
    ownerUserId = loginRes.body.data.user.id;

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

    const customerRes = await request(app.getHttpServer())
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: `Audit Test Customer ${Date.now()}`,
        phone: `984${Math.floor(Math.random() * 10000000)
          .toString()
          .padStart(7, '0')}`,
      });

    customerId = customerRes.body.data.id;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: { billNumber: { startsWith: 'BILL-' } },
    });
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
      where: { name: { contains: 'Audit Test Customer' } },
    });
    await app.close();
  });

  it('createSell writes AuditLog with CREATED action', async () => {
    soldStockItemId = await createFreshStockItem();

    const sellRes = await request(app.getHttpServer())
      .post('/api/v1/sales/sell')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        customerId,
        items: [{ stockItemId: soldStockItemId }],
        payment: { amountNpr: 100000, method: 'CASH' },
      })
      .expect(201);

    sellTxId = sellRes.body.data.id;
    sellBillNumber = sellRes.body.data.billNumber;

    const auditRow = await prisma.auditLog.findFirst({
      where: { entityId: sellTxId, action: 'CREATED' },
    });

    expect(auditRow).not.toBeNull();
    expect(auditRow!.billNumber).toBe(sellBillNumber);
    expect(auditRow!.entityType).toBe('Transaction');
    expect(auditRow!.actorId).toBe(ownerUserId);
    expect(auditRow!.after).toMatchObject({
      txType: 'SELL',
      itemCount: 1,
      grandTotalNpr: expect.any(String),
    });
  });

  it('createReturn writes RETURNED with metadata.relatedBillNumber', async () => {
    const returnRes = await request(app.getHttpServer())
      .post('/api/v1/sales/return')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        originalTxId: sellTxId,
        items: [{ stockItemId: soldStockItemId }],
        refund: { amountNpr: 94000, method: 'CASH' },
      })
      .expect(201);

    const auditRow = await prisma.auditLog.findFirst({
      where: { entityId: returnRes.body.data.id, action: 'RETURNED' },
    });

    expect(auditRow).not.toBeNull();
    expect(auditRow!.metadata).toMatchObject({
      relatedBillNumber: sellBillNumber,
    });
  });

  it('audit write failure does not roll back the sale transaction', async () => {
    const stockItemId = await createFreshStockItem();
    const spy = jest
      .spyOn(auditWrite, 'writeTransactionAudit')
      .mockImplementation((tx, logger, entry) =>
        realWriteTransactionAudit(
          {
            auditLog: {
              create: jest.fn().mockRejectedValue(new Error('simulated audit failure')),
            },
          } as any,
          logger,
          entry,
        ),
      );

    const sellRes = await request(app.getHttpServer())
      .post('/api/v1/sales/sell')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        customerId,
        items: [{ stockItemId }],
        payment: { amountNpr: 50000, method: 'CASH' },
      })
      .expect(201);

    spy.mockRestore();

    const tx = await prisma.transaction.findUnique({
      where: { id: sellRes.body.data.id },
    });
    expect(tx).not.toBeNull();

    const auditCount = await prisma.auditLog.count({
      where: { entityId: sellRes.body.data.id },
    });
    expect(auditCount).toBe(0);
  });

  it('GET /audit/transactions/:billNumber returns events in createdAt ASC order', async () => {
    const itemId = await createFreshStockItem();
    const sellRes = await request(app.getHttpServer())
      .post('/api/v1/sales/sell')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        customerId,
        items: [{ stockItemId: itemId }],
        payment: { amountNpr: 30000, method: 'CASH' },
      })
      .expect(201);

    const bill = sellRes.body.data.billNumber;
    const txId = sellRes.body.data.id;

    await request(app.getHttpServer())
      .post(`/api/v1/sales/${txId}/payment`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ payment: { amountNpr: 10000, method: 'CASH' } })
      .expect(200);

    const res = await request(app.getHttpServer())
      .get(`/api/v1/audit/transactions/${bill}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    const events = res.body.data.data;
    expect(events).toHaveLength(2);
    expect(events[0].action).toBe('CREATED');
    expect(events[1].action).toBe('PAYMENT_ADDED');

    for (let i = 1; i < events.length; i++) {
      expect(new Date(events[i].createdAt).getTime()).toBeGreaterThanOrEqual(
        new Date(events[i - 1].createdAt).getTime(),
      );
    }
  });

  it('GET /audit/transactions?from=&to= filters by date range', async () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    const past = new Date();
    past.setFullYear(past.getFullYear() - 1);

    const emptyRes = await request(app.getHttpServer())
      .get('/api/v1/audit/transactions')
      .query({
        from: future.toISOString(),
        to: new Date(future.getTime() + 86400000).toISOString(),
        limit: 50,
      })
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(emptyRes.body.data.data).toEqual([]);

    const inRangeRes = await request(app.getHttpServer())
      .get('/api/v1/audit/transactions')
      .query({
        from: past.toISOString(),
        to: future.toISOString(),
        billNumber: sellBillNumber,
        limit: 50,
      })
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(inRangeRes.body.data.data.length).toBeGreaterThanOrEqual(1);
    expect(
      inRangeRes.body.data.data.every((e: any) => e.billNumber === sellBillNumber),
    ).toBe(true);
  });
});
