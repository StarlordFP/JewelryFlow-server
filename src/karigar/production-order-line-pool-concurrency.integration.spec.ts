import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { KarigarService } from './karigar.service';
import { assertIntegrationTestDatabase } from '../test-setup/assert-test-database';

const WEIGHT_EPSILON = 0.001;

/**
 * Real PostgreSQL concurrency: two KarigarService.weighInProductionOrderLine calls
 * fired via Promise.all against the same ProductionOrderMetalPool row.
 */
describe('Production order line pool concurrency (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let service: KarigarService;

  let karigarId: string;
  let metalTypeId: string;
  let categoryId: string;
  let userId: string;
  let orderId: string;
  let lineAId: string;
  let lineBId: string;

  const INITIAL_POOL = 5;
  const RAW_DEFICIT = 3;

  beforeAll(async () => {
    assertIntegrationTestDatabase();
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
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
    service = moduleRef.get(KarigarService);

    const user = await prisma.user.findFirst({
      where: { email: 'owner@jewelryflow.test' },
    });
    if (!user) throw new Error('Seed user not found — run prisma db seed');
    userId = user.id;

    const metal = await prisma.metalType.findFirst({
      where: { name: { contains: 'Gold', mode: 'insensitive' }, isActive: true },
    });
    if (!metal) throw new Error('Gold metal type not found');
    metalTypeId = metal.id;

    const category = await prisma.itemCategory.findFirst({
      where: { name: 'Ring', isActive: true },
    });
    if (!category) throw new Error('Ring category not found');
    categoryId = category.id;

    const karigar = await prisma.karigar.create({
      data: {
        name: `Pool Concurrency Karigar ${Date.now()}`,
      },
    });
    karigarId = karigar.id;

    const order = await service.createProductionOrder(userId, {
      karigarId,
      lines: [
        {
          description: 'Concurrent Line A',
          categoryId,
          metalTypeId,
          expectedWeightGram: 10.5,
          plannedIssuedWeightGram: 11,
        },
        {
          description: 'Concurrent Line B',
          categoryId,
          metalTypeId,
          expectedWeightGram: 10.5,
          plannedIssuedWeightGram: 11,
        },
      ],
    });
    orderId = order.id;
    lineAId = (order as any).lines[0].id;
    lineBId = (order as any).lines[1].id;

    await service.issueProductionOrderLinesBatch(orderId, {
      lines: [
        { productionOrderLineId: lineAId },
        { productionOrderLineId: lineBId },
      ],
    });

    await prisma.productionOrderMetalPool.upsert({
      where: {
        productionOrderId_metalTypeId: {
          productionOrderId: orderId,
          metalTypeId,
        },
      },
      create: {
        productionOrderId: orderId,
        metalTypeId,
        pooledSurplusGram: INITIAL_POOL,
      },
      update: { pooledSurplusGram: INITIAL_POOL },
    });
  });

  afterAll(async () => {
    if (orderId) {
      await prisma.karigarDispute.deleteMany({ where: { productionOrderId: orderId } });
      await prisma.productionReturn.deleteMany({ where: { productionOrderId: orderId } });
      await prisma.productionOrderLine.deleteMany({ where: { productionOrderId: orderId } });
      await prisma.productionOrderMetalPool.deleteMany({ where: { productionOrderId: orderId } });
      await prisma.productionIssue.deleteMany({ where: { productionOrderId: orderId } });
      await prisma.productionOrder.delete({ where: { id: orderId } });
    }
    if (karigarId) {
      await prisma.karigar.delete({ where: { id: karigarId } });
    }
    await app.close();
  });

  it('parallel weigh-ins never double-spend the real pool row', async () => {
    const [resultA, resultB] = await Promise.all([
      service.weighInProductionOrderLine(lineAId, {
        actualWeight: { value: 7.5, unit: 'gram' },
      }),
      service.weighInProductionOrderLine(lineBId, {
        actualWeight: { value: 7.5, unit: 'gram' },
      }),
    ]);

    const pool = await prisma.productionOrderMetalPool.findUnique({
      where: {
        productionOrderId_metalTypeId: {
          productionOrderId: orderId,
          metalTypeId,
        },
      },
    });

    const coverA = RAW_DEFICIT - resultA.lineDeficitGram;
    const coverB = RAW_DEFICIT - resultB.lineDeficitGram;

    expect(Number(pool!.pooledSurplusGram)).toBeGreaterThanOrEqual(-WEIGHT_EPSILON);
    expect(coverA + coverB).toBeLessThanOrEqual(INITIAL_POOL + WEIGHT_EPSILON);
    expect(Number(pool!.pooledSurplusGram)).toBeCloseTo(
      INITIAL_POOL - coverA - coverB,
      3,
    );

    for (const result of [resultA, resultB]) {
      const ownCover = RAW_DEFICIT - result.lineDeficitGram;
      expect(ownCover).toBeLessThanOrEqual(RAW_DEFICIT + WEIGHT_EPSILON);
      expect(result.lineDeficitGram).toBeCloseTo(RAW_DEFICIT - ownCover, 3);
    }
  });
});
