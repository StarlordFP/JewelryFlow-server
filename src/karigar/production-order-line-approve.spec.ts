import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { KarigarService } from './karigar.service';
import { PrismaService } from '../prisma/prisma.service';
import { StockSkuService } from '../stock/stock-sku.service';
import { StockService } from '../stock/stock.service';

describe('Production order line approve — STEP 5', () => {
  let service: KarigarService;
  let mockPrisma: any;
  let mockSkuService: any;

  const pendingDispute = {
    id: 'dispute-1',
    karigarId: 'karigar-1',
    productionOrderId: 'order-1',
    productionIssueId: 'issue-1',
    metalTypeId: 'metal-gold',
    excessWeightGram: new Decimal(0.3),
    status: 'PENDING',
  };

  const weighedLine = {
    id: 'line-1',
    description: 'Gold Ring',
    categoryId: 'cat-ring',
    metalTypeId: 'metal-gold',
    karat: 22,
    status: 'WEIGHED',
    disputeId: null,
    actualWeightGram: new Decimal(10.5),
    productionReturnId: 'return-1',
    productionReturn: { id: 'return-1' },
    productionIssue: {
      id: 'issue-1',
      metalTypeId: 'metal-gold',
      sourceItems: [],
    },
  };

  beforeEach(async () => {
    mockPrisma = {
      productionOrderLine: {
        findUnique: jest.fn().mockResolvedValue(weighedLine),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      productionItem: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({ id: 'prod-item-1', ...data }),
        ),
      },
      stockItem: {
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({ id: 'stock-1', ...data }),
        ),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      dailyRate: {
        findFirst: jest.fn().mockResolvedValue({ id: 'rate-1' }),
      },
      karigarDispute: {
        findUnique: jest.fn(),
        update: jest.fn().mockImplementation(({ data }: any) =>
          Promise.resolve({ ...pendingDispute, ...data }),
        ),
      },
      karigarMetalBalance: { upsert: jest.fn() },
      $transaction: jest.fn().mockImplementation((cb) => cb(mockPrisma)),
    };

    mockSkuService = {
      generateSku: jest.fn().mockResolvedValue('KRG-20260627-0001'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KarigarService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: StockSkuService, useValue: mockSkuService },
        { provide: StockService, useValue: {} },
      ],
    }).compile();

    service = module.get<KarigarService>(KarigarService);
  });

  it('creates stock from line category/metal/karat and sets APPROVED', async () => {
    const result = await service.approveProductionOrderLine('line-1');

    expect(mockPrisma.productionItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          productionReturnId: 'return-1',
          description: 'Gold Ring',
          grossWeightGram: 10.5,
        }),
      }),
    );
    expect(mockPrisma.stockItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          origin: 'KARIGAR',
          name: 'Gold Ring',
          categoryId: 'cat-ring',
          metalTypeId: 'metal-gold',
          karat: 22,
          status: 'IN_STOCK',
          productionItemId: 'prod-item-1',
        }),
      }),
    );
    expect(mockPrisma.productionOrderLine.updateMany).toHaveBeenCalledWith({
      where: { id: 'line-1', status: 'WEIGHED' },
      data: { status: 'APPROVED', stockItemId: 'stock-1' },
    });
    expect(result.status).toBe('APPROVED');
    expect(result.stockItemId).toBe('stock-1');
  });

  it('sets UNDER_DISPUTE when linked dispute is still PENDING at approve time', async () => {
    mockPrisma.productionOrderLine.findUnique.mockResolvedValue({
      ...weighedLine,
      disputeId: 'dispute-1',
    });
    mockPrisma.karigarDispute.findUnique.mockResolvedValue(pendingDispute);

    await service.approveProductionOrderLine('line-1');

    expect(mockPrisma.karigarDispute.findUnique).toHaveBeenCalledWith({
      where: { id: 'dispute-1' },
    });
    expect(mockPrisma.stockItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'UNDER_DISPUTE' }),
      }),
    );
  });

  it('weigh-in → resolveDispute → approve creates IN_STOCK even though disputeId remains set', async () => {
    mockPrisma.karigarDispute.findUnique
      .mockResolvedValueOnce(pendingDispute)
      .mockResolvedValueOnce({ ...pendingDispute, status: 'RESOLVED' });

    await service.resolveDispute('dispute-1', { deductionNpr: 500 }, 'user-1');

    mockPrisma.productionOrderLine.findUnique.mockResolvedValue({
      ...weighedLine,
      disputeId: 'dispute-1',
    });

    await service.approveProductionOrderLine('line-1');

    expect(mockPrisma.stockItem.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'IN_STOCK' }),
      }),
    );
  });

  it('weigh-in → resolveDispute (METAL_CARRYFORWARD) → approve also creates IN_STOCK', async () => {
    mockPrisma.karigarDispute.findUnique
      .mockResolvedValueOnce(pendingDispute)
      .mockResolvedValueOnce({ ...pendingDispute, status: 'RESOLVED' });
    mockPrisma.karigarMetalBalance.upsert.mockResolvedValue({ balanceGram: new Decimal(0.3) });

    await service.resolveDispute(
      'dispute-1',
      { resolutionType: 'METAL_CARRYFORWARD' },
      'user-1',
    );

    mockPrisma.productionOrderLine.findUnique.mockResolvedValue({
      ...weighedLine,
      disputeId: 'dispute-1',
    });

    await service.approveProductionOrderLine('line-1');

    expect(mockPrisma.stockItem.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'IN_STOCK' }),
      }),
    );
  });

  it('uses REMAKE origin and flips source items when issue had remake inputs', async () => {
    mockPrisma.productionOrderLine.findUnique.mockResolvedValue({
      ...weighedLine,
      productionIssue: {
        id: 'issue-1',
        metalTypeId: 'metal-gold',
        sourceItems: [{ stockItemId: 'source-1' }],
      },
    });

    await service.approveProductionOrderLine('line-1');

    expect(mockPrisma.stockItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ origin: 'REMAKE' }),
      }),
    );
    expect(mockPrisma.stockItem.update).toHaveBeenCalledWith({
      where: { id: 'source-1' },
      data: {
        status: 'REMADE',
        remadeIntoStockItemId: 'stock-1',
      },
    });
  });

  it('rejects approve when line is not WEIGHED', async () => {
    mockPrisma.productionOrderLine.findUnique.mockResolvedValue({
      ...weighedLine,
      status: 'ISSUED',
    });

    await expect(service.approveProductionOrderLine('line-1')).rejects.toThrow(
      ConflictException,
    );
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('batch approve returns per-line results without blocking siblings', async () => {
    mockPrisma.productionOrderLine.findUnique
      .mockResolvedValueOnce(weighedLine)
      .mockResolvedValueOnce({ ...weighedLine, id: 'line-bad', status: 'ISSUED' });

    const results = await service.approveProductionOrderLinesBatch({
      lines: [
        { productionOrderLineId: 'line-1' },
        { productionOrderLineId: 'line-bad' },
      ],
    });

    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(false);
  });
});
