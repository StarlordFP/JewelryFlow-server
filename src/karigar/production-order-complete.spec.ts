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

describe('completeProductionOrder — pool surplus sweep', () => {
  let service: KarigarService;
  let mockPrisma: any;

  const openOrder = {
    id: 'order-1',
    karigarId: 'karigar-1',
    status: 'OPEN',
  };

  beforeEach(async () => {
    mockPrisma = {
      productionOrder: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      productionOrderLine: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      productionOrderMetalPool: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      },
      karigarMetalBalance: {
        upsert: jest.fn(),
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

  it('completes legacy order with no lines exactly as before (no transaction)', async () => {
    mockPrisma.productionOrder.findUnique.mockResolvedValue(openOrder);
    mockPrisma.productionOrderLine.findMany.mockResolvedValue([]);
    mockPrisma.productionOrder.update.mockResolvedValue({
      ...openOrder,
      status: 'COMPLETED',
    });

    const result = await service.completeProductionOrder('order-1');

    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockPrisma.productionOrder.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data:  { status: 'COMPLETED' },
    });
    expect(result.status).toBe('COMPLETED');
    expect((result as any).sweptMetalBalance).toBeUndefined();
  });

  it('rejects when any line is not APPROVED and leaves pool untouched', async () => {
    mockPrisma.productionOrder.findUnique.mockResolvedValue(openOrder);
    mockPrisma.productionOrderLine.findMany.mockResolvedValue([
      { id: 'line-1', status: 'APPROVED' },
      { id: 'line-2', status: 'ISSUED' },
    ]);

    await expect(service.completeProductionOrder('order-1')).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.completeProductionOrder('order-1')).rejects.toThrow(
      'Cannot complete: 1 line(s) are not yet APPROVED.',
    );

    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockPrisma.productionOrder.update).not.toHaveBeenCalled();
    expect(mockPrisma.productionOrderMetalPool.findMany).not.toHaveBeenCalled();
  });

  it('sweeps leftover pool surplus into KarigarMetalBalance and returns breakdown', async () => {
    mockPrisma.productionOrder.findUnique.mockResolvedValue(openOrder);
    mockPrisma.productionOrderLine.findMany.mockResolvedValue([
      { id: 'line-1', status: 'APPROVED' },
    ]);
    mockPrisma.productionOrderMetalPool.findMany.mockResolvedValue([
      {
        id: 'pool-1',
        productionOrderId: 'order-1',
        metalTypeId: 'metal-gold',
        pooledSurplusGram: new Decimal(0.5),
        metalType: { id: 'metal-gold', name: 'Gold 22K' },
      },
    ]);
    mockPrisma.productionOrder.update.mockResolvedValue({
      ...openOrder,
      status: 'COMPLETED',
    });

    const result = await service.completeProductionOrder('order-1');

    expect(mockPrisma.karigarMetalBalance.upsert).toHaveBeenCalledWith({
      where: {
        karigarId_metalTypeId: {
          karigarId:   'karigar-1',
          metalTypeId: 'metal-gold',
        },
      },
      create: {
        karigarId:   'karigar-1',
        metalTypeId: 'metal-gold',
        balanceGram: 0.5,
      },
      update: {
        balanceGram: { increment: 0.5 },
      },
    });
    expect(mockPrisma.productionOrderMetalPool.update).toHaveBeenCalledWith({
      where: { id: 'pool-1' },
      data:  { pooledSurplusGram: 0 },
    });
    expect((result as any).sweptMetalBalance).toEqual([
      {
        metalTypeId:   'metal-gold',
        metalTypeName: 'Gold 22K',
        amountGram:    0.5,
      },
    ]);
    expect(result.status).toBe('COMPLETED');
  });

  it('sweeps two metal types independently', async () => {
    mockPrisma.productionOrder.findUnique.mockResolvedValue(openOrder);
    mockPrisma.productionOrderLine.findMany.mockResolvedValue([
      { id: 'line-1', status: 'APPROVED' },
      { id: 'line-2', status: 'APPROVED' },
    ]);
    mockPrisma.productionOrderMetalPool.findMany.mockResolvedValue([
      {
        id: 'pool-gold',
        metalTypeId: 'metal-gold',
        pooledSurplusGram: new Decimal(0.3),
        metalType: { id: 'metal-gold', name: 'Gold 22K' },
      },
      {
        id: 'pool-silver',
        metalTypeId: 'metal-silver',
        pooledSurplusGram: new Decimal(1.2),
        metalType: { id: 'metal-silver', name: 'Silver' },
      },
    ]);
    mockPrisma.productionOrder.update.mockResolvedValue({
      ...openOrder,
      status: 'COMPLETED',
    });

    const result = await service.completeProductionOrder('order-1');

    expect(mockPrisma.karigarMetalBalance.upsert).toHaveBeenCalledTimes(2);
    expect(mockPrisma.productionOrderMetalPool.update).toHaveBeenCalledTimes(2);
    expect((result as any).sweptMetalBalance).toHaveLength(2);
    expect((result as any).sweptMetalBalance).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ metalTypeId: 'metal-gold', amountGram: 0.3 }),
        expect.objectContaining({ metalTypeId: 'metal-silver', amountGram: 1.2 }),
      ]),
    );
  });

  it('increments existing KarigarMetalBalance instead of overwriting', async () => {
    mockPrisma.productionOrder.findUnique.mockResolvedValue(openOrder);
    mockPrisma.productionOrderLine.findMany.mockResolvedValue([
      { id: 'line-1', status: 'APPROVED' },
    ]);
    mockPrisma.productionOrderMetalPool.findMany.mockResolvedValue([
      {
        id: 'pool-1',
        metalTypeId: 'metal-gold',
        pooledSurplusGram: new Decimal(0.4),
        metalType: { id: 'metal-gold', name: 'Gold 22K' },
      },
    ]);
    mockPrisma.productionOrder.update.mockResolvedValue({
      ...openOrder,
      status: 'COMPLETED',
    });

    await service.completeProductionOrder('order-1');

    expect(mockPrisma.karigarMetalBalance.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { balanceGram: { increment: 0.4 } },
      }),
    );
  });

  it('rejects when order is not OPEN', async () => {
    mockPrisma.productionOrder.findUnique.mockResolvedValue({
      ...openOrder,
      status: 'COMPLETED',
    });

    await expect(service.completeProductionOrder('order-1')).rejects.toThrow(
      ConflictException,
    );
  });

  it('throws NotFoundException when order missing', async () => {
    mockPrisma.productionOrder.findUnique.mockResolvedValue(null);

    await expect(service.completeProductionOrder('missing')).rejects.toThrow(
      NotFoundException,
    );
  });
});
