import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { KarigarService } from './karigar.service';
import { PrismaService } from '../prisma/prisma.service';
import { StockSkuService } from '../stock/stock-sku.service';
import { StockService } from '../stock/stock.service';

describe('Production order line weigh-in — STEP 4', () => {
  let service: KarigarService;
  let mockPrisma: any;

  const openOrder = {
    id: 'order-1',
    status: 'OPEN',
    karigarId: 'karigar-1',
  };

  const issuedLineBase = {
    id: 'line-1',
    productionOrderId: 'order-1',
    metalTypeId: 'metal-gold',
    status: 'ISSUED',
    allowedLossGram: new Decimal(1),
    productionIssueId: 'issue-1',
    productionOrder: openOrder,
    productionIssue: {
      id: 'issue-1',
      issuedWeightGram: new Decimal(11),
      metalTypeId: 'metal-gold',
    },
  };

  beforeEach(async () => {
    mockPrisma = {
      productionOrderLine: {
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      productionOrderMetalPool: {
        findUnique: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        upsert: jest.fn().mockResolvedValue({ id: 'pool-1' }),
      },
      productionReturn: {
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({ id: 'return-1', ...data }),
        ),
        update: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue({}),
      },
      karigarDispute: { create: jest.fn() },
      productionItem: { create: jest.fn() },
      stockItem: { create: jest.fn() },
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

  it('surplus branch increments pool and creates no dispute', async () => {
    mockPrisma.productionOrderLine.findUnique.mockResolvedValue(issuedLineBase);

    const result = await service.weighInProductionOrderLine('line-1', {
      actualWeight: { value: 10.5, unit: 'gram' },
    });

    // actualLoss = 11 - 10.5 = 0.5, surplus = 1 - 0.5 = 0.5
    expect(mockPrisma.productionOrderMetalPool.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          productionOrderId_metalTypeId: {
            productionOrderId: 'order-1',
            metalTypeId: 'metal-gold',
          },
        },
        create: expect.objectContaining({ pooledSurplusGram: 0.5 }),
        update: { pooledSurplusGram: { increment: 0.5 } },
      }),
    );
    expect(mockPrisma.karigarDispute.create).not.toHaveBeenCalled();
    expect(mockPrisma.productionItem.create).not.toHaveBeenCalled();
    expect(mockPrisma.stockItem.create).not.toHaveBeenCalled();
    expect(result.withinTolerance).toBe(true);
    expect(result.lineSurplusGram).toBe(0.5);
  });

  it('deficit fully covered by pool creates no dispute', async () => {
    mockPrisma.productionOrderLine.findUnique.mockResolvedValue({
      ...issuedLineBase,
      allowedLossGram: new Decimal(0.5),
    });
    mockPrisma.productionOrderMetalPool.findUnique.mockResolvedValue({
      id: 'pool-gold',
      pooledSurplusGram: new Decimal(2),
    });

    const result = await service.weighInProductionOrderLine('line-1', {
      actualWeight: { value: 10, unit: 'gram' },
    });

    // actualLoss = 1, rawDeficit = 0.5, coverable = 0.5
    expect(mockPrisma.productionOrderMetalPool.updateMany).toHaveBeenCalledWith({
      where: { id: 'pool-gold', pooledSurplusGram: { gte: 0.5 } },
      data: { pooledSurplusGram: { decrement: 0.5 } },
    });
    expect(mockPrisma.karigarDispute.create).not.toHaveBeenCalled();
    expect(result.lineDeficitGram).toBe(0);
  });

  it('deficit partially covered creates dispute for uncovered amount only', async () => {
    mockPrisma.productionOrderLine.findUnique.mockResolvedValue({
      ...issuedLineBase,
      allowedLossGram: new Decimal(0.5),
    });
    mockPrisma.productionOrderMetalPool.findUnique.mockResolvedValue({
      id: 'pool-gold',
      pooledSurplusGram: new Decimal(0.2),
    });
    mockPrisma.karigarDispute.create.mockResolvedValue({ id: 'dispute-1' });

    await service.weighInProductionOrderLine('line-1', {
      actualWeight: { value: 10, unit: 'gram' },
    });

    // rawDeficit = 0.5, cover = 0.2, uncovered = 0.3
    expect(mockPrisma.karigarDispute.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          excessWeightGram: 0.3,
          productionIssueId: 'issue-1',
          metalTypeId: 'metal-gold',
          productionOrderLineId: 'line-1',
          status: 'PENDING',
        }),
      }),
    );
  });

  it('two different metals on one order — silver deficit does not draw gold pool', async () => {
    const goldLine = { ...issuedLineBase, id: 'line-gold', metalTypeId: 'metal-gold' };
    const silverLine = {
      ...issuedLineBase,
      id: 'line-silver',
      metalTypeId: 'metal-silver',
      productionIssueId: 'issue-silver',
      allowedLossGram: new Decimal(0.5),
      productionIssue: {
        id: 'issue-silver',
        issuedWeightGram: new Decimal(11),
        metalTypeId: 'metal-silver',
      },
    };

    mockPrisma.productionOrderLine.findUnique
      .mockResolvedValueOnce(goldLine)
      .mockResolvedValueOnce(silverLine);

    await service.weighInProductionOrderLine('line-gold', {
      actualWeight: { value: 10.5, unit: 'gram' },
    });

    mockPrisma.productionOrderMetalPool.findUnique.mockResolvedValue(null);
    mockPrisma.karigarDispute.create.mockResolvedValue({ id: 'dispute-silver' });

    await service.weighInProductionOrderLine('line-silver', {
      actualWeight: { value: 10, unit: 'gram' },
    });

    expect(mockPrisma.productionOrderMetalPool.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          productionOrderId_metalTypeId: {
            productionOrderId: 'order-1',
            metalTypeId: 'metal-gold',
          },
        },
      }),
    );
    expect(mockPrisma.productionOrderMetalPool.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.karigarDispute.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metalTypeId: 'metal-silver',
          excessWeightGram: 0.5,
        }),
      }),
    );
  });

  it('correct-weigh-in nulls productionReturnId and allows fresh weigh-in (surplus branch)', async () => {
    const weighedLine = {
      id: 'line-1',
      productionOrderId: 'order-1',
      metalTypeId: 'metal-gold',
      status: 'WEIGHED',
      disputeId: null,
      productionReturnId: 'return-1',
      allowedLossGram: new Decimal(1),
      actualWeightGram: new Decimal(10.5),
      lineLossGram: new Decimal(0.5),
      lineSurplusGram: new Decimal(0.5),
      lineDeficitGram: new Decimal(0),
      productionReturn: { id: 'return-1' },
      productionIssue: {
        id: 'issue-1',
        issuedWeightGram: new Decimal(11),
      },
    };

    mockPrisma.productionOrderLine.findUnique
      .mockResolvedValueOnce(weighedLine)
      .mockResolvedValueOnce({
        ...issuedLineBase,
        id: 'line-1',
      });

    const corrected = await service.correctWeighInProductionOrderLine('line-1');

    expect(mockPrisma.productionOrderMetalPool.updateMany).toHaveBeenCalledWith({
      where: {
        productionOrderId: 'order-1',
        metalTypeId: 'metal-gold',
        pooledSurplusGram: { gte: 0.5 },
      },
      data: { pooledSurplusGram: { decrement: 0.5 } },
    });
    expect(corrected.productionReturnId).toBeNull();

    mockPrisma.productionReturn.create.mockImplementation(({ data }: any) =>
      Promise.resolve({ id: 'return-2', ...data }),
    );

    await service.weighInProductionOrderLine('line-1', {
      actualWeight: { value: 10.6, unit: 'gram' },
    });

    expect(mockPrisma.productionReturn.create).toHaveBeenCalled();
  });

  it('correct-weigh-in restores pool for fully-covered deficit using actualWeightGram, not lineDeficitGram', async () => {
    const weighedLine = {
      id: 'line-1',
      productionOrderId: 'order-1',
      metalTypeId: 'metal-gold',
      status: 'WEIGHED',
      disputeId: null,
      productionReturnId: 'return-1',
      allowedLossGram: new Decimal(0.5),
      actualWeightGram: new Decimal(10),
      lineLossGram: new Decimal(1),
      lineSurplusGram: new Decimal(0),
      lineDeficitGram: new Decimal(0),
      productionReturn: { id: 'return-1' },
      productionIssue: {
        id: 'issue-1',
        issuedWeightGram: new Decimal(11),
      },
    };

    mockPrisma.productionOrderLine.findUnique
      .mockResolvedValueOnce(weighedLine)
      .mockResolvedValueOnce({
        ...issuedLineBase,
        id: 'line-1',
        allowedLossGram: new Decimal(0.5),
      });

    await service.correctWeighInProductionOrderLine('line-1');

    // covered = (11 - 10) - 0.5 - 0 = 0.5 — must not rely on lineDeficitGram (which is 0)
    expect(mockPrisma.productionOrderMetalPool.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ pooledSurplusGram: 0.5 }),
        update: { pooledSurplusGram: { increment: 0.5 } },
      }),
    );
    expect(mockPrisma.productionOrderMetalPool.updateMany).not.toHaveBeenCalled();

    mockPrisma.productionReturn.create.mockImplementation(({ data }: any) =>
      Promise.resolve({ id: 'return-2', ...data }),
    );
    mockPrisma.productionOrderMetalPool.findUnique.mockResolvedValue({
      id: 'pool-gold',
      pooledSurplusGram: new Decimal(0.5),
    });

    await service.weighInProductionOrderLine('line-1', {
      actualWeight: { value: 10, unit: 'gram' },
    });

    expect(mockPrisma.productionReturn.create).toHaveBeenCalled();
  });

  it('correct-weigh-in surplus reversal fails when sibling line partially consumed the pool', async () => {
    const lineAWeighed = {
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

    mockPrisma.productionOrderLine.findUnique
      .mockResolvedValueOnce({
        ...issuedLineBase,
        id: 'line-a',
        allowedLossGram: new Decimal(5),
      })
      .mockResolvedValueOnce({
        ...issuedLineBase,
        id: 'line-b',
        productionIssueId: 'issue-b',
        allowedLossGram: new Decimal(0.5),
        productionIssue: {
          id: 'issue-b',
          issuedWeightGram: new Decimal(11),
          metalTypeId: 'metal-gold',
        },
      });

    // Line A surplus +5g → pool at 5
    await service.weighInProductionOrderLine('line-a', {
      actualWeight: { value: 11, unit: 'gram' },
    });

    // Line B draws 3g from pool → pool left at 2g
    mockPrisma.productionOrderMetalPool.findUnique.mockResolvedValue({
      id: 'pool-gold',
      pooledSurplusGram: new Decimal(5),
    });

    await service.weighInProductionOrderLine('line-b', {
      actualWeight: { value: 7.5, unit: 'gram' },
    });

    expect(mockPrisma.productionOrderMetalPool.updateMany).toHaveBeenCalledWith({
      where: { id: 'pool-gold', pooledSurplusGram: { gte: 3 } },
      data: { pooledSurplusGram: { decrement: 3 } },
    });

    mockPrisma.productionOrderLine.findUnique.mockResolvedValueOnce(lineAWeighed);
    mockPrisma.productionOrderMetalPool.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      service.correctWeighInProductionOrderLine('line-a'),
    ).rejects.toThrow(
      /partially used by another line and can't be fully reversed/,
    );

    expect(mockPrisma.productionReturn.delete).not.toHaveBeenCalled();
  });

  it('correct-weigh-in blocked when dispute exists', async () => {
    mockPrisma.productionOrderLine.findUnique.mockResolvedValue({
      id: 'line-1',
      status: 'WEIGHED',
      disputeId: 'dispute-1',
      productionReturnId: 'return-1',
      productionReturn: { id: 'return-1' },
    });

    await expect(
      service.correctWeighInProductionOrderLine('line-1'),
    ).rejects.toThrow(ConflictException);

    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('batch weigh-in returns per-line results without blocking siblings', async () => {
    mockPrisma.productionOrderLine.findUnique
      .mockResolvedValueOnce(issuedLineBase)
      .mockResolvedValueOnce({ ...issuedLineBase, id: 'line-bad', status: 'PENDING' });

    const results = await service.weighInProductionOrderLinesBatch({
      lines: [
        { productionOrderLineId: 'line-1', actualWeight: { value: 10.5, unit: 'gram' } },
        { productionOrderLineId: 'line-bad', actualWeight: { value: 10, unit: 'gram' } },
      ],
    });

    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(false);
  });

  it('boundary at allowedLossGram + epsilon is within tolerance', async () => {
    mockPrisma.productionOrderLine.findUnique.mockResolvedValue({
      ...issuedLineBase,
      allowedLossGram: new Decimal(1),
      productionIssue: {
        id: 'issue-1',
        issuedWeightGram: new Decimal(10),
        metalTypeId: 'metal-gold',
      },
    });

    const result = await service.weighInProductionOrderLine('line-1', {
      actualWeight: { value: 9.0005, unit: 'gram' },
    });

    // actualLoss = 0.9995, allowed = 1 → within epsilon
    expect(mockPrisma.karigarDispute.create).not.toHaveBeenCalled();
    expect(result.withinTolerance).toBe(true);
  });
});
