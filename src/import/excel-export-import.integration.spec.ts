import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { assertIntegrationTestDatabase } from '../test-setup/assert-test-database';
import { Workbook } from 'exceljs';

describe('Excel Export/Import Integration Tests (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authToken: string;
  let goldMetalTypeId: string;
  let categoryId: string;

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

    // Get OWNER auth token
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'owner@jewelryflow.test', password: 'password123' });

    authToken = loginRes.body.data.accessToken;

    // Get gold metal type
    const metalsRes = await request(app.getHttpServer())
      .get('/api/v1/rates/metal-types')
      .set('Authorization', `Bearer ${authToken}`);

    const gold = metalsRes.body.data.find(
      (m: any) => m.name.toLowerCase().includes('gold') || m.name.toLowerCase() === 'gold',
    );
    goldMetalTypeId = gold.id;

    // Get or create category
    const catRes = await request(app.getHttpServer())
      .get('/api/v1/stock/categories')
      .set('Authorization', `Bearer ${authToken}`);

    if (catRes.body.data.length > 0) {
      categoryId = catRes.body.data[0].id;
    } else {
      const newCatRes = await request(app.getHttpServer())
        .post('/api/v1/stock/categories')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'Ring', shortCode: 'RNG' });
      categoryId = newCatRes.body.data.id;
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/export/stock should return the correct file headers and content type', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/export/stock')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200)
      .expect('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .expect('Content-Disposition', /attachment; filename=stock-export-/);
  });

  it('POST /api/v1/import/stock with real buffer should successfully create stock items', async () => {
    // 1. Fetch category and metal names from DB for template matching
    const cat = await prisma.itemCategory.findUnique({ where: { id: categoryId } });
    const metal = await prisma.metalType.findUnique({ where: { id: goldMetalTypeId } });

    // 2. Build in-memory xlsx file
    const wb = new Workbook();
    const ws = wb.addWorksheet('Stock');
    ws.columns = [
      { header: 'Name', key: 'name' },
      { header: 'Category', key: 'category' },
      { header: 'Metal', key: 'metal' },
      { header: 'Karat', key: 'karat' },
      { header: 'Gross Weight (g)', key: 'grossWeightGram' },
      { header: 'Gross Weight (tola)', key: 'grossWeightTola' },
      { header: 'Jerty (g)', key: 'jertyGram' },
      { header: 'Total Jyala (NPR)', key: 'totalJyalaNpr' },
      { header: 'Notes', key: 'notes' },
    ];
    // Add data row matching exact DB names
    ws.addRow({
      name: 'Integration Test Ring',
      category: cat?.name || 'Ring',
      metal: metal?.name || 'Gold',
      karat: 22,
      grossWeightGram: 7.25,
      grossWeightTola: '',
      jertyGram: 0.15,
      totalJyalaNpr: 1800,
      notes: 'Created by e2e integration test',
    });

    const buffer = await wb.xlsx.writeBuffer();

    // 3. POST upload
    const res = await request(app.getHttpServer())
      .post('/api/v1/import/stock')
      .set('Authorization', `Bearer ${authToken}`)
      .attach('file', Buffer.from(buffer), 'test-import.xlsx')
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.imported).toBe(1);
    expect(res.body.data.errors).toHaveLength(0);
    expect(res.body.data.skus).toHaveLength(1);

    // 4. Verify stock item exists in database
    const createdSku = res.body.data.skus[0];
    const item = await prisma.stockItem.findUnique({
      where: { sku: createdSku },
    });
    expect(item).toBeDefined();
    expect(item?.name).toBe('Integration Test Ring');
    expect(Number(item?.grossWeightGram)).toBe(7.25);
  });
});
