import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { KarigarService } from './karigar.service';
import { PrismaService } from '../prisma/prisma.service';
import { StockSkuService } from '../stock/stock-sku.service';
import { StockService } from '../stock/stock.service';

describe('Production order line read endpoints — STEP 6', () => {
  let service: KarigarService;
  let mockPrisma: any;

  const lineRecord = {
    id: 'line-1',
    productionOrderId: 'order-1',
    description: 'Gold Ring',
    categoryId: 'cat-ring',
    metalTypeId: 'metal-gold',
    karat: 22,
    expectedWeightGram: new Decimal(10),
    plannedIssuedWeightGram: new Decimal(10.5),
    status: 'ISSUED',
    allowedLossGram: new Decimal(0.5),
    actualWeightGram: null,
    lineLossGram: null,
    lineSurplusGram: null,
    lineDeficitGram: null,
    disputeId: null,
    stockItemId: null,
    productionIssueId: 'issue-1',
    productionReturnId: null,
    createdAt: new Date('2026-06-27T10:00:00Z'),
    category: { id: 'cat-ring', name: 'Ring' },
    metalType: { id: 'metal-gold', name: 'Gold 22K' },
    productionIssue: {
      id: 'issue-1',
      issuedWeightGram: new Decimal(10.5),
      rateAtIssuePerGram: new Decimal(8500),
      issuedAt: new Date('2026-06-27T09:00:00Z'),
    },
  };

  beforeEach(async () => {
    mockPrisma = {
      productionOrder: { findUnique: jest.fn() },
      productionOrderLine: { findUnique: jest.fn() },
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

  it('getProductionOrder includes formatted lines and metal pools', async () => {
    mockPrisma.productionOrder.findUnique.mockResolvedValue({
      id: 'order-1',
      status: 'OPEN',
      karigar: { id: 'karigar-1', name: 'Ram' },
      createdBy: { id: 'user-1', name: 'Owner' },
      productionIssues: [],
      productionReturns: [],
      payments: [],
      disputes: [],
      lines: [lineRecord],
      metalPools: [
        {
          id: 'pool-1',
          metalTypeId: 'metal-gold',
          pooledSurplusGram: new Decimal(1.2),
          metalType: { id: 'metal-gold', name: 'Gold 22K' },
        },
      ],
    });

    const result = await service.getProductionOrder('order-1');

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({
      id: 'line-1',
      description: 'Gold Ring',
      category: { id: 'cat-ring', name: 'Ring' },
      metalType: { id: 'metal-gold', name: 'Gold 22K' },
      karat: 22,
      expectedWeightGram: 10,
      plannedIssuedWeightGram: 10.5,
      status: 'ISSUED',
      allowedLossGram: 0.5,
      issue: {
        id: 'issue-1',
        issuedWeightGram: 10.5,
        rateAtIssuePerGram: 8500,
      },
    });
    expect(result.metalPools).toEqual([
      {
        id: 'pool-1',
        metalTypeId: 'metal-gold',
        metalType: { id: 'metal-gold', name: 'Gold 22K' },
        pooledSurplusGram: 1.2,
      },
    ]);
    expect(result.weightSummary).toBeDefined();
  });

  it('getProductionOrderLine returns a single formatted line', async () => {
    mockPrisma.productionOrderLine.findUnique.mockResolvedValue({
      ...lineRecord,
      productionOrder: { id: 'order-1', status: 'OPEN' },
    });

    const result = await service.getProductionOrderLine('line-1');

    expect(result).toMatchObject({
      id: 'line-1',
      description: 'Gold Ring',
      status: 'ISSUED',
      allowedLossGram: 0.5,
      productionOrder: { id: 'order-1', status: 'OPEN' },
      issue: {
        issuedWeightGram: 10.5,
        rateAtIssuePerGram: 8500,
      },
    });
  });

  it('getProductionOrderLine throws when line not found', async () => {
    mockPrisma.productionOrderLine.findUnique.mockResolvedValue(null);

    await expect(service.getProductionOrderLine('missing')).rejects.toThrow(
      NotFoundException,
    );
  });
});
