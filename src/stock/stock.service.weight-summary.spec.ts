/**
 * Unit tests for StockService.getStockWeightSummary()
 *
 * Tests:
 *  1. Correct grouping of mixed gold karats + silver
 *  2. Correct tola conversion (divide by GRAMS_PER_TOLA = 11.664)
 *  3. Correct totals (goldTotalGram, goldTotalTola, silverTotalGram, silverTotalTola)
 *  4. Gold rows sorted by karat descending (24 -> 22 -> 18 -> 14)
 *  5. SOLD items excluded -- confirmed via WHERE clause on the groupBy mock
 *  6. Empty stock returns zero-value shape
 *  7. metalTypeName set correctly from lookup
 *  8. Only one metalType.findMany call (no N+1)
 *  9. Route placement: weight-summary precedes :id in controller source
 */

import { Test, TestingModule } from '@nestjs/testing';
import { StockService } from './stock.service';
import { PrismaService } from '../prisma/prisma.service';
import { StockSkuService } from './stock-sku.service';
import { GRAMS_PER_TOLA } from '../common/constants/weight.constants';

// --- Prisma mock factory -------------------------------------------------------

const makePrismaMock = () => ({
  stockItem: {
    groupBy:    jest.fn(),
    findMany:   jest.fn(),
    findUnique: jest.fn(),
    findFirst:  jest.fn(),
    create:     jest.fn(),
    update:     jest.fn(),
    count:      jest.fn(),
  },
  metalType: {
    findMany:   jest.fn(),
    findUnique: jest.fn(),
  },
  dailyRate:     { findFirst: jest.fn() },
  luxuryTaxRule: { findFirst: jest.fn() },
  vatRule:       { findFirst: jest.fn() },
  itemCategory:  { findUnique: jest.fn() },
  jertyBracket:  { findFirst: jest.fn() },
  jyalaRule:     { findFirst: jest.fn() },
  $transaction:  jest.fn(),
});

// --- Test data ----------------------------------------------------------------

const METAL_GOLD_24K = { id: 'mt-g24', name: 'Gold 24K' };
const METAL_GOLD_22K = { id: 'mt-g22', name: 'Gold 22K' };
const METAL_GOLD_18K = { id: 'mt-g18', name: 'Gold 18K' };
const METAL_SILVER   = { id: 'mt-sil', name: 'Silver' };

const makeGroup = (metalTypeId: string, karat: number | null, grams: number) => ({
  metalTypeId,
  karat,
  _sum: { grossWeightGram: grams },
});

// --- Suite -------------------------------------------------------------------

describe('StockService.getStockWeightSummary()', () => {
  let service: StockService;
  let prismaMock: ReturnType<typeof makePrismaMock>;

  beforeEach(async () => {
    prismaMock = makePrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StockService,
        { provide: PrismaService,   useValue: prismaMock },
        {
          provide: StockSkuService,
          useValue: {
            generateSku:               jest.fn(),
            generateCategoryKaratSku:  jest.fn(),
            previewCategoryKaratSku:   jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<StockService>(StockService);
  });

  // 1 & 2. Gold + silver grouping and tola conversion
  it('groups gold by karat and silver separately, converts grams to tola correctly', async () => {
    prismaMock.stockItem.groupBy.mockResolvedValue([
      makeGroup(METAL_GOLD_24K.id, 24, 116.64),  // exactly 10 tola
      makeGroup(METAL_GOLD_22K.id, 22, 58.32),   // exactly 5 tola
      makeGroup(METAL_SILVER.id,   null, 233.28), // exactly 20 tola
    ]);
    prismaMock.metalType.findMany.mockResolvedValue([
      METAL_GOLD_24K, METAL_GOLD_22K, METAL_SILVER,
    ]);

    const result = await service.getStockWeightSummary();

    expect(result.gold).toHaveLength(2);

    const g24 = result.gold.find((r: any) => r.karat === 24)!;
    expect(g24.totalGram).toBe(116.64);
    expect(g24.totalTola).toBeCloseTo(10.0, 3);

    const g22 = result.gold.find((r: any) => r.karat === 22)!;
    expect(g22.totalGram).toBe(58.32);
    expect(g22.totalTola).toBeCloseTo(5.0, 3);

    expect(result.silver).toHaveLength(1);
    expect(result.silver[0].totalGram).toBe(233.28);
    expect(result.silver[0].totalTola).toBeCloseTo(20.0, 3);
  });

  // 3. Totals
  it('computes goldTotalGram, goldTotalTola, silverTotalGram, silverTotalTola correctly', async () => {
    const gold22Grams = 116.64;
    const gold18Grams = 58.32;
    const silverGrams = 116.64;

    prismaMock.stockItem.groupBy.mockResolvedValue([
      makeGroup(METAL_GOLD_22K.id, 22, gold22Grams),
      makeGroup(METAL_GOLD_18K.id, 18, gold18Grams),
      makeGroup(METAL_SILVER.id,   null, silverGrams),
    ]);
    prismaMock.metalType.findMany.mockResolvedValue([
      METAL_GOLD_22K, METAL_GOLD_18K, METAL_SILVER,
    ]);

    const result = await service.getStockWeightSummary();

    const expectedGoldGram = gold22Grams + gold18Grams;
    expect(result.goldTotalGram).toBeCloseTo(expectedGoldGram, 3);
    expect(result.goldTotalTola).toBeCloseTo(expectedGoldGram / GRAMS_PER_TOLA, 3);
    expect(result.silverTotalGram).toBeCloseTo(silverGrams, 3);
    expect(result.silverTotalTola).toBeCloseTo(silverGrams / GRAMS_PER_TOLA, 3);
  });

  // 4. Gold sort order
  it('sorts gold rows by karat descending (24 -> 22 -> 18)', async () => {
    prismaMock.stockItem.groupBy.mockResolvedValue([
      makeGroup(METAL_GOLD_18K.id, 18, 20),
      makeGroup(METAL_GOLD_22K.id, 22, 30),
      makeGroup(METAL_GOLD_24K.id, 24, 40),
    ]);
    prismaMock.metalType.findMany.mockResolvedValue([
      METAL_GOLD_18K, METAL_GOLD_22K, METAL_GOLD_24K,
    ]);

    const result = await service.getStockWeightSummary();

    expect(result.gold.map((r: any) => r.karat)).toEqual([24, 22, 18]);
  });

  // 5. SOLD items excluded via WHERE clause
  it('passes status: IN_STOCK in the WHERE clause so SOLD items are excluded', async () => {
    prismaMock.stockItem.groupBy.mockResolvedValue([]);

    await service.getStockWeightSummary();

    expect(prismaMock.stockItem.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'IN_STOCK' }),
      }),
    );
  });

  it('SOLD item weight is not counted -- 10 tola IN_STOCK only, not 14.29 tola', async () => {
    // Correct: groupBy only returns IN_STOCK rows (50g SOLD row absent)
    prismaMock.stockItem.groupBy.mockResolvedValue([
      makeGroup(METAL_GOLD_24K.id, 24, 116.64), // 10 tola
    ]);
    prismaMock.metalType.findMany.mockResolvedValue([METAL_GOLD_24K]);

    const result = await service.getStockWeightSummary();

    expect(result.goldTotalTola).toBeCloseTo(10.0, 2);
  });

  // 6. Empty stock
  it('returns zero-value shape when no IN_STOCK items exist', async () => {
    prismaMock.stockItem.groupBy.mockResolvedValue([]);

    const result = await service.getStockWeightSummary();

    expect(result).toEqual({
      gold:            [],
      silver:          [],
      goldTotalGram:   0,
      goldTotalTola:   0,
      silverTotalGram: 0,
      silverTotalTola: 0,
    });
    // metalType.findMany must NOT be called when groupBy returns nothing
    expect(prismaMock.metalType.findMany).not.toHaveBeenCalled();
  });

  // 7. metalTypeName
  it('sets metalTypeName from the metalType lookup', async () => {
    prismaMock.stockItem.groupBy.mockResolvedValue([
      makeGroup(METAL_GOLD_24K.id, 24, 50),
      makeGroup(METAL_SILVER.id,   null, 30),
    ]);
    prismaMock.metalType.findMany.mockResolvedValue([METAL_GOLD_24K, METAL_SILVER]);

    const result = await service.getStockWeightSummary();

    expect(result.gold[0].metalTypeName).toBe('Gold 24K');
    expect(result.silver[0].metalTypeName).toBe('Silver');
  });

  // 8. No N+1 queries
  it('calls metalType.findMany exactly once regardless of how many groups exist', async () => {
    prismaMock.stockItem.groupBy.mockResolvedValue([
      makeGroup(METAL_GOLD_24K.id, 24, 50),
      makeGroup(METAL_GOLD_22K.id, 22, 30),
      makeGroup(METAL_GOLD_18K.id, 18, 20),
      makeGroup(METAL_SILVER.id,   null, 40),
    ]);
    prismaMock.metalType.findMany.mockResolvedValue([
      METAL_GOLD_24K, METAL_GOLD_22K, METAL_GOLD_18K, METAL_SILVER,
    ]);

    await service.getStockWeightSummary();

    expect(prismaMock.metalType.findMany).toHaveBeenCalledTimes(1);
  });
});

// --- Route placement test ----------------------------------------------------

describe('Controller route placement: weight-summary must precede :id', () => {
  it("@Get('weight-summary') decorator appears before @Get(':id') decorator in controller source", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs   = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('path');
    const src  = fs.readFileSync(
      path.join(__dirname, 'stock.controller.ts'),
      'utf8',
    );

    // Search for the actual @Get decorator calls, not bare strings in JSDoc
    const weightSummaryIdx = src.indexOf("@Get('weight-summary')");
    const colonIdIdx       = src.indexOf("@Get(':id')");

    expect(weightSummaryIdx).toBeGreaterThan(-1);
    expect(colonIdIdx).toBeGreaterThan(-1);
    expect(weightSummaryIdx).toBeLessThan(colonIdIdx);
  });
});

