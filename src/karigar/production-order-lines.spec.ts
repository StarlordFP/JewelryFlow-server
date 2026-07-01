import { Test, TestingModule } from '@nestjs/testing';
import { KarigarService } from './karigar.service';
import { PrismaService } from '../prisma/prisma.service';
import { StockSkuService } from '../stock/stock-sku.service';
import { StockService } from '../stock/stock.service';
import { BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';

describe('Production order lines — STEP 2 order creation', () => {
  let service: KarigarService;
  let mockPrisma: any;

  const karigar = {
    id: 'karigar-1',
    isActive: true,
  };

  const createdOrder = {
    id: 'order-1',
    karigarId: 'karigar-1',
    tolerancePct: new Decimal(2.5),
    status: 'OPEN',
    karigar,
  };

  beforeEach(async () => {
    mockPrisma = {
      karigar: { findUnique: jest.fn().mockResolvedValue(karigar) },
      productionOrder: { create: jest.fn().mockResolvedValue(createdOrder) },
      productionOrderLine: { create: jest.fn() },
      itemCategory: { findMany: jest.fn() },
      metalType: { findMany: jest.fn() },
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

  it('without lines — creates order exactly as before (no line records)', async () => {
    const result = await service.createProductionOrder('user-1', {
      karigarId: 'karigar-1',
      tolerancePct: 2.5,
      notes: 'Batch order',
    });

    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockPrisma.productionOrder.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        karigarId: 'karigar-1',
        notes: 'Batch order',
        status: 'OPEN',
        createdByUserId: 'user-1',
        tolerancePct: 2.5,
      }),
      include: { karigar: true },
    });
    expect(mockPrisma.productionOrderLine.create).not.toHaveBeenCalled();
    expect(result).toEqual(createdOrder);
  });

  it('with lines — creates order and PENDING lines in one transaction', async () => {
    mockPrisma.itemCategory.findMany.mockResolvedValue([{ id: 'cat-1' }]);
    mockPrisma.metalType.findMany.mockResolvedValue([{ id: 'metal-gold' }]);
    mockPrisma.productionOrderLine.create.mockImplementation(({ data }: any) =>
      Promise.resolve({
        id: `line-${data.description}`,
        ...data,
        category: { id: data.categoryId, name: 'Ring' },
        metalType: { id: data.metalTypeId, name: 'Gold 22K' },
      }),
    );

    const result = await service.createProductionOrder('user-1', {
      karigarId: 'karigar-1',
      lines: [
        {
          description: 'Gold Ring',
          categoryId: 'cat-1',
          metalTypeId: 'metal-gold',
          karat: 22,
          expectedWeightGram: 10,
          plannedIssuedWeightGram: 10.5,
        },
      ],
    });

    expect(mockPrisma.$transaction).toHaveBeenCalled();
    expect(mockPrisma.productionOrderLine.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          productionOrderId: 'order-1',
          description: 'Gold Ring',
          categoryId: 'cat-1',
          metalTypeId: 'metal-gold',
          karat: 22,
          expectedWeightGram: 10,
          plannedIssuedWeightGram: 10.5,
          status: 'PENDING',
        }),
      }),
    );
    expect((result as any).lines).toHaveLength(1);
    expect((result as any).lines[0].status).toBe('PENDING');
  });

  it('rejects simple order when no tolerance is provided', async () => {
    await expect(
      service.createProductionOrder('user-1', {
        karigarId: 'karigar-1',
        notes: 'Batch order',
      }),
    ).rejects.toThrow(BadRequestException);

    expect(mockPrisma.productionOrder.create).not.toHaveBeenCalled();
  });

  it('rejects whole request when plannedIssuedWeightGram < expectedWeightGram', async () => {
    await expect(
      service.createProductionOrder('user-1', {
        karigarId: 'karigar-1',
        lines: [
          {
            description: 'Gold Ring',
            categoryId: 'cat-1',
            metalTypeId: 'metal-gold',
            expectedWeightGram: 10,
            plannedIssuedWeightGram: 9.5,
          },
        ],
      }),
    ).rejects.toThrow(BadRequestException);

    expect(mockPrisma.productionOrder.create).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects whole request when category is inactive or missing', async () => {
    mockPrisma.itemCategory.findMany.mockResolvedValue([]);
    mockPrisma.metalType.findMany.mockResolvedValue([{ id: 'metal-gold' }]);

    await expect(
      service.createProductionOrder('user-1', {
        karigarId: 'karigar-1',
        lines: [
          {
            description: 'Gold Ring',
            categoryId: 'cat-inactive',
            metalTypeId: 'metal-gold',
            expectedWeightGram: 10,
            plannedIssuedWeightGram: 10.5,
          },
        ],
      }),
    ).rejects.toThrow(/Category not found or inactive: cat-inactive/);

    expect(mockPrisma.productionOrder.create).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects whole request when metalType is inactive or missing', async () => {
    mockPrisma.itemCategory.findMany.mockResolvedValue([{ id: 'cat-1' }]);
    mockPrisma.metalType.findMany.mockResolvedValue([]);

    await expect(
      service.createProductionOrder('user-1', {
        karigarId: 'karigar-1',
        lines: [
          {
            description: 'Gold Ring',
            categoryId: 'cat-1',
            metalTypeId: 'metal-inactive',
            expectedWeightGram: 10,
            plannedIssuedWeightGram: 10.5,
          },
        ],
      }),
    ).rejects.toThrow(/MetalType not found or inactive: metal-inactive/);

    expect(mockPrisma.productionOrder.create).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});
