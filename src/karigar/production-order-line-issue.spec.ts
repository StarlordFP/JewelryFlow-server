import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { KarigarService } from './karigar.service';
import { PrismaService } from '../prisma/prisma.service';
import { StockSkuService } from '../stock/stock-sku.service';
import { StockService } from '../stock/stock.service';

describe('Production order line issue — STEP 3', () => {
  let service: KarigarService;
  let mockPrisma: any;

  const openOrder = {
    id: 'order-1',
    status: 'OPEN',
    karigarId: 'karigar-1',
    karigar: { id: 'karigar-1' },
  };

  const pendingLine = {
    id: 'line-1',
    productionOrderId: 'order-1',
    metalTypeId: 'metal-gold',
    status: 'PENDING',
    expectedWeightGram: new Decimal(10),
    plannedIssuedWeightGram: new Decimal(10.5),
  };

  const activeMetal = {
    id: 'metal-gold',
    name: 'Gold 22K',
    isActive: true,
  };

  beforeEach(async () => {
    mockPrisma = {
      productionOrder: { findUnique: jest.fn().mockResolvedValue(openOrder) },
      productionOrderLine: {
        findUnique: jest.fn().mockResolvedValue(pendingLine),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      metalType: { findUnique: jest.fn().mockResolvedValue(activeMetal) },
      stockItem: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn() },
      dailyRate: {
        findFirst: jest.fn().mockResolvedValue({ sellRatePerGram: new Decimal(8500) }),
      },
      karigarMetalBalance: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      productionIssue: {
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: 'issue-1',
            ...data,
            metalType: activeMetal,
            productionOrder: openOrder,
          }),
        ),
      },
      productionIssueSourceItem: { createMany: jest.fn() },
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

  it('defaults issuedWeight to plannedIssuedWeightGram when omitted', async () => {
    const result = await service.createProductionIssue({
      productionOrderId: 'order-1',
      metalTypeId: 'metal-gold',
      productionOrderLineId: 'line-1',
    });

    expect(mockPrisma.productionIssue.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ issuedWeightGram: 10.5 }),
      }),
    );
    expect(result.effectiveWeightGram).toBe(10.5);
  });

  it('sets allowedLossGram from effective issued weight, not planned', async () => {
    const result = await service.createProductionIssue({
      productionOrderId: 'order-1',
      metalTypeId: 'metal-gold',
      productionOrderLineId: 'line-1',
      issuedWeight: { value: 12, unit: 'gram' },
    });

    expect(mockPrisma.productionOrderLine.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'line-1',
        status: 'PENDING',
        productionOrderId: 'order-1',
      },
      data: {
        status: 'ISSUED',
        productionIssueId: 'issue-1',
        allowedLossGram: 2,
      },
    });
    expect(result.allowedLossGram).toBe(2);
  });

  it('sets allowedLossGram after applyBalanceGram on the real issued amount', async () => {
    await service.createProductionIssue({
      productionOrderId: 'order-1',
      metalTypeId: 'metal-gold',
      productionOrderLineId: 'line-1',
      issuedWeight: { value: 12, unit: 'gram' },
      applyBalanceGram: 1,
    });

    expect(mockPrisma.karigarMetalBalance.updateMany).toHaveBeenCalled();
    expect(mockPrisma.productionOrderLine.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ allowedLossGram: 1 }),
      }),
    );
  });

  it('sets allowedLossGram from sourceStockItemIds and applyBalanceGram combined', async () => {
    mockPrisma.stockItem.findMany.mockResolvedValue([
      {
        id: 'stock-1',
        sku: 'SKU-1',
        metalTypeId: 'metal-gold',
        grossWeightGram: new Decimal(3),
      },
    ]);
    mockPrisma.stockItem.updateMany.mockResolvedValue({ count: 1 });

    // combined = 10 + 3 = 13, effective = 13 - 2 = 11, allowedLoss = 11 - 10 = 1
    await service.createProductionIssue({
      productionOrderId: 'order-1',
      metalTypeId: 'metal-gold',
      productionOrderLineId: 'line-1',
      issuedWeight: { value: 10, unit: 'gram' },
      sourceStockItemIds: ['stock-1'],
      applyBalanceGram: 2,
    });

    expect(mockPrisma.productionIssue.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ issuedWeightGram: 11 }),
      }),
    );
    expect(mockPrisma.productionOrderLine.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ allowedLossGram: 1 }),
      }),
    );
  });

  it('rejects when line metalTypeId does not match issue metalTypeId', async () => {
    await expect(
      service.createProductionIssue({
        productionOrderId: 'order-1',
        metalTypeId: 'metal-silver',
        productionOrderLineId: 'line-1',
        issuedWeight: { value: 10.5, unit: 'gram' },
      }),
    ).rejects.toThrow(BadRequestException);

    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects when line does not belong to the production order', async () => {
    mockPrisma.productionOrderLine.findUnique.mockResolvedValue({
      ...pendingLine,
      productionOrderId: 'other-order',
    });

    await expect(
      service.createProductionIssue({
        productionOrderId: 'order-1',
        metalTypeId: 'metal-gold',
        productionOrderLineId: 'line-1',
        issuedWeight: { value: 10.5, unit: 'gram' },
      }),
    ).rejects.toThrow(/does not belong/);

    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects when line is not PENDING', async () => {
    mockPrisma.productionOrderLine.findUnique.mockResolvedValue({
      ...pendingLine,
      status: 'ISSUED',
    });

    await expect(
      service.createProductionIssue({
        productionOrderId: 'order-1',
        metalTypeId: 'metal-gold',
        productionOrderLineId: 'line-1',
        issuedWeight: { value: 10.5, unit: 'gram' },
      }),
    ).rejects.toThrow(ConflictException);

    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects inactive metal type on issue', async () => {
    mockPrisma.metalType.findUnique.mockResolvedValue({
      id: 'metal-gold',
      isActive: false,
    });

    await expect(
      service.createProductionIssue({
        productionOrderId: 'order-1',
        metalTypeId: 'metal-gold',
        productionOrderLineId: 'line-1',
        issuedWeight: { value: 10.5, unit: 'gram' },
      }),
    ).rejects.toThrow(NotFoundException);

    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('uses atomic updateMany for PENDING → ISSUED and fails when row count is not 1', async () => {
    mockPrisma.productionOrderLine.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.createProductionIssue({
        productionOrderId: 'order-1',
        metalTypeId: 'metal-gold',
        productionOrderLineId: 'line-1',
        issuedWeight: { value: 10.5, unit: 'gram' },
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('allows sourceStockItemIds on a line-based issue without special-casing', async () => {
    mockPrisma.stockItem.findMany.mockResolvedValue([
      {
        id: 'stock-1',
        sku: 'SKU-1',
        metalTypeId: 'metal-gold',
        grossWeightGram: new Decimal(3),
      },
    ]);
    mockPrisma.stockItem.updateMany.mockResolvedValue({ count: 1 });

    await service.createProductionIssue({
      productionOrderId: 'order-1',
      metalTypeId: 'metal-gold',
      productionOrderLineId: 'line-1',
      issuedWeight: { value: 7.5, unit: 'gram' },
      sourceStockItemIds: ['stock-1'],
    });

    expect(mockPrisma.stockItem.updateMany).toHaveBeenCalled();
    expect(mockPrisma.productionIssueSourceItem.createMany).toHaveBeenCalled();
    expect(mockPrisma.productionOrderLine.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ allowedLossGram: 0.5 }),
      }),
    );
  });

  describe('issueProductionOrderLinesBatch', () => {
    it('returns per-line results and does not block siblings on failure', async () => {
      const lineOk = { ...pendingLine, id: 'line-ok' };
      const lineBad = {
        ...pendingLine,
        id: 'line-bad',
        status: 'ISSUED',
      };

      mockPrisma.productionOrderLine.findUnique
        .mockResolvedValueOnce(lineOk)
        .mockResolvedValueOnce(lineBad);

      const createSpy = jest
        .spyOn(service, 'createProductionIssue')
        .mockResolvedValueOnce({ id: 'issue-ok' } as any)
        .mockRejectedValueOnce(
          new ConflictException('Production order line is already ISSUED — cannot issue again'),
        );

      const results = await service.issueProductionOrderLinesBatch('order-1', {
        lines: [
          { productionOrderLineId: 'line-ok' },
          { productionOrderLineId: 'line-bad' },
        ],
      });

      expect(createSpy).toHaveBeenCalledTimes(2);
      expect(results).toEqual([
        {
          productionOrderLineId: 'line-ok',
          success: true,
          issue: { id: 'issue-ok' },
        },
        {
          productionOrderLineId: 'line-bad',
          success: false,
          error: 'Production order line is already ISSUED — cannot issue again',
        },
      ]);

      createSpy.mockRestore();
    });
  });
});
