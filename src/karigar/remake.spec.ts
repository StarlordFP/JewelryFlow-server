import { Test, TestingModule } from '@nestjs/testing';
import { KarigarService } from './karigar.service';
import { PrismaService } from '../prisma/prisma.service';
import { StockSkuService } from '../stock/stock-sku.service';
import { StockService } from '../stock/stock.service';
import { BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';

describe('Remake Flow Unit Tests', () => {
  let service: KarigarService;
  let mockPrisma: any;
  let mockSkuService: any;
  let mockStockService: any;

  beforeEach(async () => {
    mockPrisma = {
      productionOrder: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      metalType: {
        findUnique: jest.fn(),
      },
      stockItem: {
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      dailyRate: {
        findFirst: jest.fn(),
      },
      productionIssue: {
        create: jest.fn(),
        findUnique: jest.fn(),
      },
      productionIssueSourceItem: {
        createMany: jest.fn(),
      },
      productionReturn: {
        create: jest.fn(),
        findFirst: jest.fn(),
      },
      productionItem: {
        create: jest.fn(),
      },
      karigarDispute: {
        create: jest.fn(),
      },
      itemCategory: {
        upsert: jest.fn().mockResolvedValue({ id: 'cat-1', name: 'Uncategorised' }),
      },
      $transaction: jest.fn().mockImplementation((cb) => cb(mockPrisma)),
    };

    mockSkuService = {
      generateSku: jest.fn().mockResolvedValue('RMK-20260623-0001'),
    };

    mockStockService = {
      updateStockStatus: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KarigarService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: StockSkuService, useValue: mockSkuService },
        { provide: StockService, useValue: mockStockService },
      ],
    }).compile();

    service = module.get<KarigarService>(KarigarService);
  });

  describe('createProductionIssue with Remake', () => {
    it('should reject if neither issuedWeight nor sourceStockItemIds is provided', async () => {
      // Mock production order
      mockPrisma.productionOrder.findUnique.mockResolvedValue({
        id: 'order-1',
        status: 'OPEN',
        karigarId: 'karigar-1',
        karigar: { id: 'karigar-1' },
      });
      // Mock metal type
      mockPrisma.metalType.findUnique.mockResolvedValue({
        id: 'metal-1',
        isActive: true,
      });

      await expect(
        service.createProductionIssue({
          productionOrderId: 'order-1',
          metalTypeId: 'metal-1',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject if a source item is not found', async () => {
      // Mock production order
      mockPrisma.productionOrder.findUnique.mockResolvedValue({
        id: 'order-1',
        status: 'OPEN',
        karigarId: 'karigar-1',
        karigar: { id: 'karigar-1' },
      });
      // Mock metal type
      mockPrisma.metalType.findUnique.mockResolvedValue({
        id: 'metal-1',
        isActive: true,
      });
      // Mock stockItem findMany to return only one item instead of two requested
      mockPrisma.stockItem.findMany.mockResolvedValue([
        { id: 'item-1', status: 'IN_STOCK', sku: 'SKU1', metalTypeId: 'metal-1', grossWeightGram: new Decimal(5.0) }
      ]);

      await expect(
        service.createProductionIssue({
          productionOrderId: 'order-1',
          metalTypeId: 'metal-1',
          sourceStockItemIds: ['item-1', 'item-2'],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw ConflictException if updateMany returns a count lower than requested IDs', async () => {
      // Mock production order
      mockPrisma.productionOrder.findUnique.mockResolvedValue({
        id: 'order-1',
        status: 'OPEN',
        karigarId: 'karigar-1',
        karigar: { id: 'karigar-1' },
      });
      // Mock metal type
      mockPrisma.metalType.findUnique.mockResolvedValue({
        id: 'metal-1',
        isActive: true,
      });
      // Mock source items
      mockPrisma.stockItem.findMany.mockResolvedValue([
        { id: 'item-1', status: 'IN_STOCK', sku: 'SKU1', metalTypeId: 'metal-1', grossWeightGram: new Decimal(5.0) }
      ]);
      // Mock updateMany to return count: 0 (race condition / not IN_STOCK)
      mockPrisma.stockItem.updateMany.mockResolvedValue({ count: 0 });

      // Mock daily rate
      mockPrisma.dailyRate.findFirst.mockResolvedValue({
        sellRatePerGram: new Decimal(100),
      });
      // Mock productionIssue create
      mockPrisma.productionIssue.create.mockResolvedValue({
        id: 'issue-1',
        issuedWeightGram: new Decimal(5.0),
      });

      await expect(
        service.createProductionIssue({
          productionOrderId: 'order-1',
          metalTypeId: 'metal-1',
          sourceStockItemIds: ['item-1'],
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should reject if any source item has a different metalTypeId than the issue', async () => {
      // Mock production order
      mockPrisma.productionOrder.findUnique.mockResolvedValue({
        id: 'order-1',
        status: 'OPEN',
        karigarId: 'karigar-1',
        karigar: { id: 'karigar-1' },
      });
      // Mock metal type
      mockPrisma.metalType.findUnique.mockResolvedValue({
        id: 'metal-1',
        isActive: true,
      });
      // Mock source items with different metalTypeId
      mockPrisma.stockItem.findMany.mockResolvedValue([
        { id: 'item-1', status: 'IN_STOCK', sku: 'SKU1', metalTypeId: 'metal-2', grossWeightGram: new Decimal(5.0) }
      ]);

      await expect(
        service.createProductionIssue({
          productionOrderId: 'order-1',
          metalTypeId: 'metal-1',
          sourceStockItemIds: ['item-1'],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should calculate combined weight correctly and create source item snapshots', async () => {
      // Mock production order
      mockPrisma.productionOrder.findUnique.mockResolvedValue({
        id: 'order-1',
        status: 'OPEN',
        tolerancePct: new Decimal(5),
        karigarId: 'karigar-1',
        karigar: { id: 'karigar-1' },
      });
      // Mock metal type
      mockPrisma.metalType.findUnique.mockResolvedValue({
        id: 'metal-1',
        name: 'Gold 24K',
        isActive: true,
      });
      // Mock two source items
      mockPrisma.stockItem.findMany.mockResolvedValue([
        { id: 'item-1', status: 'IN_STOCK', sku: 'SKU1', metalTypeId: 'metal-1', grossWeightGram: new Decimal(3.0) },
        { id: 'item-2', status: 'IN_STOCK', sku: 'SKU2', metalTypeId: 'metal-1', grossWeightGram: new Decimal(4.0) },
      ]);
      // Mock daily rate
      mockPrisma.dailyRate.findFirst.mockResolvedValue({
        sellRatePerGram: new Decimal(100),
      });
      // Mock productionIssue create
      mockPrisma.productionIssue.create.mockResolvedValue({
        id: 'issue-1',
        issuedWeightGram: new Decimal(12.0),
      });
      // Mock updateMany to succeed
      mockPrisma.stockItem.updateMany.mockResolvedValue({ count: 2 });

      const result = await service.createProductionIssue({
        productionOrderId: 'order-1',
        metalTypeId: 'metal-1',
        issuedWeight: { value: 5, unit: 'gram' }, // raw gold
        sourceStockItemIds: ['item-1', 'item-2'], // 3g + 4g
      });

      // Total weight should be 5 (raw) + 3 + 4 = 12g
      expect(mockPrisma.productionIssue.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            issuedWeightGram: 12.0, // total combined weight
          }),
        }),
      );

      // Verify that source items are snapshotted
      expect(mockPrisma.productionIssueSourceItem.createMany).toHaveBeenCalledWith({
        data: [
          { productionIssueId: 'issue-1', stockItemId: 'item-1', weightAtIssueGram: 3.0 },
          { productionIssueId: 'issue-1', stockItemId: 'item-2', weightAtIssueGram: 4.0 },
        ],
      });

      // Verify atomic updateMany was called
      expect(mockPrisma.stockItem.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['item-1', 'item-2'] }, status: 'IN_STOCK' },
        data: { status: 'IN_REMAKE' },
      });
    });
  });

  describe('createProductionReturn with Remake source items', () => {
    it('should transition source items to REMADE and set remadeIntoStockItemId on return', async () => {
      // Mock production order
      mockPrisma.productionOrder.findUnique.mockResolvedValue({
        id: 'order-1',
        status: 'OPEN',
        tolerancePct: new Decimal(5.0),
        toleranceGram: null,
        karigarId: 'karigar-1',
        karigar: { tolerancePct: new Decimal(5.0) },
      });
      // Mock production issue with source items (total weight 10g)
      mockPrisma.productionIssue.findUnique.mockResolvedValue({
        id: 'issue-1',
        productionOrderId: 'order-1',
        metalTypeId: 'metal-1',
        issuedWeightGram: new Decimal(10.0),
        sourceItems: [
          { id: 'src-1', stockItemId: 'item-1' },
        ],
      });
      // Mock return checks (no existing return)
      mockPrisma.productionReturn.findFirst.mockResolvedValue(null);
      // Mock generated SKU
      mockSkuService.generateSku.mockResolvedValue('RMK-20260623-0001');
      // Mock productionReturn creation
      mockPrisma.productionReturn.create.mockResolvedValue({
        id: 'return-1',
      });
      // Mock productionItem creation
      mockPrisma.productionItem.create.mockResolvedValue({
        id: 'prod-item-1',
      });
      // Mock new StockItem creation
      mockPrisma.stockItem.create.mockResolvedValue({
        id: 'new-item-1',
      });
      // Mock daily rate lookup in return
      mockPrisma.dailyRate.findFirst.mockResolvedValue({
        id: 'rate-1',
      });

      // Let's call return with 9.8g returned (within 5% tolerance of 10g issued weight)
      const result = await service.createProductionReturn({
        productionOrderId: 'order-1',
        productionIssueId: 'issue-1',
        returnedWeight: { value: 9.8, unit: 'gram' },
        items: [
          {
            description: 'Remade gold necklace',
            grossWeight: { value: 9.8, unit: 'gram' },
          },
        ],
      });

      // Verify SKU is generated with REMAKE origin
      expect(mockSkuService.generateSku).toHaveBeenCalledWith('REMAKE', expect.any(Object));

      // Verify new StockItem is created with REMAKE origin and IN_STOCK status
      expect(mockPrisma.stockItem.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            origin: 'REMAKE',
            status: 'IN_STOCK',
          }),
        }),
      );

      // Verify that source item is updated to REMADE and links to the new item
      expect(mockPrisma.stockItem.update).toHaveBeenCalledWith({
        where: { id: 'item-1' },
        data: {
          status: 'REMADE',
          remadeIntoStockItemId: 'new-item-1',
        },
      });
    });
  });
});
