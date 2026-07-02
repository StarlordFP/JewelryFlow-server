import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { assertIntegrationTestDatabase } from '../test-setup/assert-test-database';

describe('Stock SKU & bulk (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authToken: string;
  let chainCategoryId: string;
  let ringCategoryId: string;
  let gold22kId: string;
  let gold18kId: string;

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

    const cats = await request(app.getHttpServer())
      .get('/api/v1/stock/categories')
      .set('Authorization', `Bearer ${authToken}`);
    chainCategoryId = cats.body.data.find((c: any) => c.shortCode === 'CHN').id;
    ringCategoryId = cats.body.data.find((c: any) => c.shortCode === 'RNG').id;

    const metals = await request(app.getHttpServer())
      .get('/api/v1/rates/metal-types')
      .set('Authorization', `Bearer ${authToken}`);
    gold22kId = metals.body.data.find((m: any) => m.name === 'Gold 22K').id;
    gold18kId = metals.body.data.find((m: any) => m.name === 'Gold 18K').id;

    for (const metalTypeId of [gold22kId, gold18kId]) {
      await request(app.getHttpServer())
        .post('/api/v1/rates')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ metalTypeId, sellRatePerGram: 9500, buyRatePerGram: 9400 });
    }
  });

  afterAll(async () => {
    await prisma.stockItem.deleteMany({
      where: { origin: 'DIRECT', categoryId: { in: [chainCategoryId, ringCategoryId] } },
    });
    await prisma.categoryKaratSequence.deleteMany({
      where: { categoryId: { in: [chainCategoryId, ringCategoryId] } },
    });
    await prisma.itemCategory.deleteMany({
      where: { name: { startsWith: 'SKU Test Cat ' } },
    });
    await app.close();
  });

  it('POST /stock with PURCHASED still uses PUR- SKU', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/stock')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        origin: { type: 'PURCHASED' },
        categoryId: chainCategoryId,
        metalTypeId: gold22kId,
        grossWeight: { value: 1, unit: 'gram' },
      })
      .expect(201);
    expect(res.body.data.sku).toMatch(/^PUR-\d{8}-\d{4}$/);
    expect(res.body.data.origin).toBe('PURCHASED');
    await prisma.stockItem.delete({ where: { id: res.body.data.id } });
  });

  it('category+metal sequences are independent (CHN 22K, RNG 22K, CHN 18K)', async () => {
    await prisma.stockItem.deleteMany({
      where: { origin: 'DIRECT', categoryId: { in: [chainCategoryId, ringCategoryId] } },
    });
    await prisma.categoryKaratSequence.deleteMany({
      where: { categoryId: { in: [chainCategoryId, ringCategoryId] } },
    });

    for (let i = 0; i < 3; i++) {
      await request(app.getHttpServer())
        .post('/api/v1/stock/bulk')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          categoryId: chainCategoryId,
          metalTypeId: gold22kId,
          items: [{ grossWeight: { value: 10 + i, unit: 'gram' } }],
        })
        .expect(201);
    }

    for (let i = 0; i < 2; i++) {
      await request(app.getHttpServer())
        .post('/api/v1/stock/bulk')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          categoryId: ringCategoryId,
          metalTypeId: gold22kId,
          items: [{ grossWeight: { value: 5 + i, unit: 'gram' } }],
        })
        .expect(201);
    }

    await request(app.getHttpServer())
      .post('/api/v1/stock/bulk')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        categoryId: chainCategoryId,
        metalTypeId: gold22kId,
        items: [{ grossWeight: { value: 20, unit: 'gram' } }],
      })
      .expect(201);

    const chain18 = await request(app.getHttpServer())
      .post('/api/v1/stock/bulk')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        categoryId: chainCategoryId,
        metalTypeId: gold18kId,
        items: [{ grossWeight: { value: 8, unit: 'gram' } }],
      })
      .expect(201);

    expect(chain18.body.data.items[0].sku).toMatch(/^CHN-\d{4}-18K$/);

    const seqs = await prisma.categoryKaratSequence.findMany({
      where: {
        OR: [
          { categoryId: chainCategoryId, metalTypeId: gold22kId },
          { categoryId: ringCategoryId, metalTypeId: gold22kId },
          { categoryId: chainCategoryId, metalTypeId: gold18kId },
        ],
      },
    });

    const byKey = (catId: string, metalId: string) =>
      seqs.find((s) => s.categoryId === catId && s.metalTypeId === metalId)?.lastSeq;

    expect(byKey(chainCategoryId, gold22kId)).toBe(4);
    expect(byKey(ringCategoryId, gold22kId)).toBe(2);
    expect(byKey(chainCategoryId, gold18kId)).toBe(1);

    const preview = await request(app.getHttpServer())
      .get('/api/v1/stock/sku-preview')
      .set('Authorization', `Bearer ${authToken}`)
      .query({ categoryId: chainCategoryId, metalTypeId: gold22kId })
      .expect(200);

    expect(preview.body.data).toMatchObject({
      nextSku: 'CHN-0005-22K',
      currentLastSeq: 4,
    });
  });

  it('POST /stock/bulk creates N items atomically with sequential SKUs', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/stock/bulk')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        categoryId: chainCategoryId,
        metalTypeId: gold22kId,
        items: [
          { grossWeight: { value: 1, unit: 'gram' }, name: 'A' },
          { grossWeight: { value: 2, unit: 'gram' }, name: 'B' },
          { grossWeight: { value: 3, unit: 'gram' }, name: 'C' },
        ],
      })
      .expect(201);

    expect(res.body.data.items).toHaveLength(3);
    const skus = res.body.data.items.map((i: any) => i.sku);
    const nums = skus.map((s: string) => parseInt(s.split('-')[1], 10));
    expect(nums[1]).toBe(nums[0] + 1);
    expect(nums[2]).toBe(nums[1] + 1);
    res.body.data.items.forEach((item: any) => {
      expect(item.origin).toBe('DIRECT');
      expect(item.entryRateId).toBeTruthy();
    });
  });

  it('rejects bulk with >100 items', async () => {
    const items = Array.from({ length: 101 }, () => ({
      grossWeight: { value: 1, unit: 'gram' },
    }));
    await request(app.getHttpServer())
      .post('/api/v1/stock/bulk')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ categoryId: chainCategoryId, metalTypeId: gold22kId, items })
      .expect(400);
  });

  it('PATCH category shortCode blocked after sequences used', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/stock/categories/${chainCategoryId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ shortCode: 'CHX' })
      .expect(409);
  });

  it('DELETE protected category rejected', async () => {
    await request(app.getHttpServer())
      .delete(`/api/v1/stock/categories/${chainCategoryId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(409);
  });

  it('DELETE owner category succeeds when empty', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/stock/categories')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: `SKU Test Cat ${Date.now()}`, shortCode: 'ZZZ' })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/api/v1/stock/categories/${created.body.data.id}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
  });
});
