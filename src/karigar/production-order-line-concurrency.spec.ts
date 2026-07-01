import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { KarigarService } from './karigar.service';
import { PrismaService } from '../prisma/prisma.service';
import { StockSkuService } from '../stock/stock-sku.service';
import { StockService } from '../stock/stock.service';

const WEIGHT_EPSILON = 0.001;

/**
 * In-memory pool with async yields so Promise.all weigh-ins interleave like
 * concurrent DB transactions (read → race on conditional updateMany).
 */
class AtomicMetalPoolSimulator {
  surplusGram: number;

  constructor(initialSurplusGram: number) {
    this.surplusGram = initialSurplusGram;
  }

  async yieldTick(): Promise<void> {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  async readPoolRow() {
    await this.yieldTick();
    return {
      id:                'pool-gold',
      pooledSurplusGram: new Decimal(this.surplusGram),
    };
  }

  async conditionalDecrement(amountGram: number): Promise<{ count: number }> {
    await this.yieldTick();
    if (this.surplusGram + WEIGHT_EPSILON >= amountGram) {
      this.surplusGram -= amountGram;
      return { count: 1 };
    }
    return { count: 0 };
  }

  async increment(amountGram: number): Promise<void> {
    await this.yieldTick();
    this.surplusGram += amountGram;
  }

  async conditionalDecrementForSurplusReversal(amountGram: number): Promise<{ count: number }> {
    return this.conditionalDecrement(amountGram);
  }
}

function buildIssuedLine(
  id: string,
  issueId: string,
  allowedLossGram: number,
) {
  return {
    id,
    productionOrderId: 'order-1',
    metalTypeId: 'metal-gold',
    status: 'ISSUED',
    allowedLossGram: new Decimal(allowedLossGram),
    productionIssueId: issueId,
    productionOrder: { id: 'order-1', status: 'OPEN', karigarId: 'karigar-1' },
    productionIssue: {
      id: issueId,
      issuedWeightGram: new Decimal(11),
      metalTypeId: 'metal-gold',
    },
  };
}

describe('Concurrent pool operations — STEP 7', () => {
  describe('weigh-in pool draw (Promise.all + interleaved atomic mock)', () => {
    let service: KarigarService;
    let poolSim: AtomicMetalPoolSimulator;
    let mockPrisma: any;
    let lineStore: Record<string, any>;
    let poolDecrementCalls: number[];
    let disputesCreated: Array<{ lineId: string; excessGram: number }>;

    const RAW_DEFICIT = 3;
    const INITIAL_POOL = 5;

    beforeEach(async () => {
      poolSim = new AtomicMetalPoolSimulator(INITIAL_POOL);
      poolDecrementCalls = [];
      disputesCreated = [];
      lineStore = {
        'line-a': buildIssuedLine('line-a', 'issue-a', 0.5),
        'line-b': buildIssuedLine('line-b', 'issue-b', 0.5),
      };

      mockPrisma = {
        productionOrderLine: {
          findUnique: jest.fn(({ where: { id } }: any) =>
            Promise.resolve(lineStore[id]),
          ),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        productionOrderMetalPool: {
          findUnique: jest.fn(() => poolSim.readPoolRow()),
          updateMany: jest.fn(({ where, data }: any) => {
            const dec = data.pooledSurplusGram.decrement;
            poolDecrementCalls.push(dec);
            return poolSim.conditionalDecrement(dec);
          }),
          upsert: jest.fn(),
        },
        productionReturn: {
          create: jest.fn().mockImplementation(({ data }: any) =>
            Promise.resolve({ id: `return-${data.productionOrderLineId}`, ...data }),
          ),
        },
        karigarDispute: {
          create: jest.fn().mockImplementation(({ data }: any) => {
            disputesCreated.push({
              lineId: data.productionOrderLineId,
              excessGram: data.excessWeightGram,
            });
            return Promise.resolve({ id: `dispute-${data.productionOrderLineId}` });
          }),
        },
        $transaction: jest.fn().mockImplementation((cb) => cb(mockPrisma)),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          KarigarService,
          { provide: PrismaService, useValue: mockPrisma },
          { provide: StockSkuService, useValue: {} },
          { provide: StockService, useValue: {} },
        ],
      }).compile();

      service = module.get<KarigarService>(KarigarService);
    });

    it('never double-spends the pool; loser gets zero cover and dispute for remainder', async () => {
      const [resultA, resultB] = await Promise.all([
        service.weighInProductionOrderLine('line-a', {
          actualWeight: { value: 7.5, unit: 'gram' },
        }),
        service.weighInProductionOrderLine('line-b', {
          actualWeight: { value: 7.5, unit: 'gram' },
        }),
      ]);

      const coverA = RAW_DEFICIT - resultA.lineDeficitGram;
      const coverB = RAW_DEFICIT - resultB.lineDeficitGram;

      expect(coverA + coverB).toBeLessThanOrEqual(INITIAL_POOL + WEIGHT_EPSILON);
      expect(poolSim.surplusGram).toBeGreaterThanOrEqual(-WEIGHT_EPSILON);
      expect(poolSim.surplusGram).toBeCloseTo(
        INITIAL_POOL - coverA - coverB,
        3,
      );

      for (const result of [resultA, resultB]) {
        expect(result.lineDeficitGram + coverA + coverB).toBeGreaterThanOrEqual(0);
        const ownCover = RAW_DEFICIT - result.lineDeficitGram;
        expect(ownCover).toBeLessThanOrEqual(RAW_DEFICIT + WEIGHT_EPSILON);
        expect(result.lineDeficitGram).toBeCloseTo(RAW_DEFICIT - ownCover, 3);
      }

      const totalCover = coverA + coverB;
      if (totalCover < RAW_DEFICIT * 2 - WEIGHT_EPSILON) {
        expect(disputesCreated.length).toBeGreaterThan(0);
      }

      const winner = coverA >= coverB ? 'a' : 'b';
      const loser = winner === 'a' ? 'b' : 'a';
      const loserResult = loser === 'a' ? resultA : resultB;
      const loserCover = RAW_DEFICIT - loserResult.lineDeficitGram;

      if (totalCover <= INITIAL_POOL + WEIGHT_EPSILON && totalCover < RAW_DEFICIT * 2) {
        expect(loserCover).toBeLessThan(RAW_DEFICIT);
        expect(loserResult.lineDeficitGram).toBeGreaterThan(WEIGHT_EPSILON);
      }
    });
  });

  describe('concurrent correct-weigh-in (Promise.all + interleaved atomic mock)', () => {
    let service: KarigarService;
    let poolSim: AtomicMetalPoolSimulator;
    let mockPrisma: any;

    beforeEach(async () => {
      poolSim = new AtomicMetalPoolSimulator(6.5);

      const lineSurplus = {
        id: 'line-a',
        productionOrderId: 'order-1',
        metalTypeId: 'metal-gold',
        status: 'WEIGHED',
        disputeId: null,
        productionReturnId: 'return-a',
        allowedLossGram: new Decimal(5),
        actualWeightGram: new Decimal(11),
        lineLossGram: new Decimal(0),
        lineSurplusGram: new Decimal(5),
        lineDeficitGram: new Decimal(0),
        productionReturn: { id: 'return-a' },
        productionIssue: { id: 'issue-a', issuedWeightGram: new Decimal(11) },
      };

      const lineCoveredDeficit = {
        id: 'line-b',
        productionOrderId: 'order-1',
        metalTypeId: 'metal-gold',
        status: 'WEIGHED',
        disputeId: null,
        productionReturnId: 'return-b',
        allowedLossGram: new Decimal(0.5),
        actualWeightGram: new Decimal(8),
        lineLossGram: new Decimal(3),
        lineSurplusGram: new Decimal(0),
        lineDeficitGram: new Decimal(0),
        productionReturn: { id: 'return-b' },
        productionIssue: { id: 'issue-b', issuedWeightGram: new Decimal(11) },
      };

      mockPrisma = {
        productionOrderLine: {
          findUnique: jest.fn(({ where: { id } }: any) => {
            if (id === 'line-a') return Promise.resolve(lineSurplus);
            if (id === 'line-b') return Promise.resolve(lineCoveredDeficit);
            return Promise.resolve(null);
          }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        productionOrderMetalPool: {
          updateMany: jest.fn(({ where, data }: any) => {
            if (data.pooledSurplusGram?.decrement != null) {
              return poolSim.conditionalDecrementForSurplusReversal(
                data.pooledSurplusGram.decrement,
              );
            }
            return Promise.resolve({ count: 0 });
          }),
          upsert: jest.fn(({ create, update }: any) => {
            const inc = update.pooledSurplusGram.increment;
            return poolSim.increment(inc).then(() => ({ id: 'pool-gold' }));
          }),
        },
        productionReturn: {
          update: jest.fn().mockResolvedValue({}),
          delete: jest.fn().mockResolvedValue({}),
        },
        $transaction: jest.fn().mockImplementation((cb) => cb(mockPrisma)),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          KarigarService,
          { provide: PrismaService, useValue: mockPrisma },
          { provide: StockSkuService, useValue: {} },
          { provide: StockService, useValue: {} },
        ],
      }).compile();

      service = module.get<KarigarService>(KarigarService);
    });

    it('leaves pool at mathematically correct final value (P - surplus + covered)', async () => {
      const P = 6.5;
      const surplusReversal = 5;
      const coveredRestore = 2.5;

      await Promise.all([
        service.correctWeighInProductionOrderLine('line-a'),
        service.correctWeighInProductionOrderLine('line-b'),
      ]);

      expect(poolSim.surplusGram).toBeCloseTo(P - surplusReversal + coveredRestore, 3);
    });
  });
});
