import { Test, TestingModule } from '@nestjs/testing';
import { KarigarService } from './karigar.service';
import { PrismaService } from '../prisma/prisma.service';
import { StockSkuService } from '../stock/stock-sku.service';
import { StockService } from '../stock/stock.service';
import {
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

describe('Karigar Metal Balance & Dispute Tracking', () => {
  let service: KarigarService;
  let mockPrisma: any;

  beforeEach(async () => {
    mockPrisma = {
      productionOrder: { findUnique: jest.fn() },
      metalType: { findUnique: jest.fn() },
      stockItem: {
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      dailyRate: { findFirst: jest.fn() },
      productionIssue: { create: jest.fn(), findUnique: jest.fn() },
      productionIssueSourceItem: { createMany: jest.fn() },
      productionReturn: { create: jest.fn(), findFirst: jest.fn() },
      productionItem: { findMany: jest.fn(), create: jest.fn() },
      karigarDispute: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      karigarMetalBalance: {
        upsert: jest.fn(),
        updateMany: jest.fn(),
      },
      itemCategory: {
        upsert: jest.fn().mockResolvedValue({ id: 'cat-1', name: 'Uncategorised' }),
      },
      $transaction: jest.fn().mockImplementation((cb) => cb(mockPrisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KarigarService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: StockSkuService, useValue: { generateSku: jest.fn().mockResolvedValue('KAR-001') } },
        { provide: StockService, useValue: {} },
      ],
    }).compile();

    service = module.get<KarigarService>(KarigarService);
  });

  // ── Dispute metal-type tracking ───────────────────────────────────────────

  describe('createProductionReturn dispute metal tracking', () => {
    const baseOrder = {
      id: 'order-1',
      status: 'OPEN',
      tolerancePct: new Decimal(2),
      toleranceGram: null,
      karigarId: 'karigar-1',
      karigar: { tolerancePct: new Decimal(2) },
    };

    function setupReturnMocks(issue: any) {
      mockPrisma.productionOrder.findUnique.mockResolvedValue(baseOrder);
      mockPrisma.productionIssue.findUnique.mockResolvedValue(issue);
      mockPrisma.productionReturn.findFirst.mockResolvedValue(null);
      mockPrisma.productionReturn.create.mockResolvedValue({ id: 'return-1' });
      mockPrisma.dailyRate.findFirst.mockResolvedValue({ id: 'rate-1' });
      mockPrisma.productionItem.create.mockResolvedValue({ id: 'pi-1' });
      mockPrisma.stockItem.create.mockResolvedValue({ id: 'stock-1' });
      mockPrisma.karigarDispute.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: `dispute-${data.metalTypeId}`, ...data }),
      );
    }

    it('should stamp productionIssueId and metalTypeId on auto-created disputes', async () => {
      setupReturnMocks({
        id: 'issue-gold',
        productionOrderId: 'order-1',
        metalTypeId: 'metal-gold',
        issuedWeightGram: new Decimal(20),
        sourceItems: [],
      });

      await service.createProductionReturn({
        productionOrderId: 'order-1',
        productionIssueId: 'issue-gold',
        returnedWeight: { value: 10, unit: 'gram' },
        items: [{ description: 'Ring', grossWeight: { value: 10, unit: 'gram' } }],
      });

      expect(mockPrisma.karigarDispute.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            productionIssueId: 'issue-gold',
            metalTypeId: 'metal-gold',
            status: 'PENDING',
          }),
        }),
      );
    });

    it('should assign correct metalTypeId per issue when two issues on one order go over tolerance', async () => {
      const disputes: any[] = [];

      mockPrisma.karigarDispute.create.mockImplementation(({ data }: any) => {
        disputes.push(data);
        return Promise.resolve({ id: `dispute-${disputes.length}`, ...data });
      });

      const setupIssueReturn = (issue: any) => {
        mockPrisma.productionOrder.findUnique.mockResolvedValue(baseOrder);
        mockPrisma.productionIssue.findUnique.mockResolvedValue(issue);
        mockPrisma.productionReturn.findFirst.mockResolvedValue(null);
        mockPrisma.productionReturn.create.mockResolvedValue({ id: 'return-1' });
        mockPrisma.dailyRate.findFirst.mockResolvedValue({ id: 'rate-1' });
        mockPrisma.productionItem.create.mockResolvedValue({ id: 'pi-1' });
        mockPrisma.stockItem.create.mockResolvedValue({ id: 'stock-1' });
      };

      // First issue — gold
      setupIssueReturn({
        id: 'issue-gold',
        productionOrderId: 'order-1',
        metalTypeId: 'metal-gold',
        issuedWeightGram: new Decimal(20),
        sourceItems: [],
      });
      await service.createProductionReturn({
        productionOrderId: 'order-1',
        productionIssueId: 'issue-gold',
        returnedWeight: { value: 10, unit: 'gram' },
        items: [{ description: 'Gold ring', grossWeight: { value: 10, unit: 'gram' } }],
      });

      // Second issue — silver
      setupIssueReturn({
        id: 'issue-silver',
        productionOrderId: 'order-1',
        metalTypeId: 'metal-silver',
        issuedWeightGram: new Decimal(20),
        sourceItems: [],
      });
      await service.createProductionReturn({
        productionOrderId: 'order-1',
        productionIssueId: 'issue-silver',
        returnedWeight: { value: 10, unit: 'gram' },
        items: [{ description: 'Silver bangle', grossWeight: { value: 10, unit: 'gram' } }],
      });

      expect(disputes).toHaveLength(2);
      expect(disputes[0]).toMatchObject({
        productionIssueId: 'issue-gold',
        metalTypeId: 'metal-gold',
      });
      expect(disputes[1]).toMatchObject({
        productionIssueId: 'issue-silver',
        metalTypeId: 'metal-silver',
      });
    });
  });

  // ── resolveDispute ────────────────────────────────────────────────────────

  describe('resolveDispute', () => {
    const pendingDispute = {
      id: 'dispute-1',
      karigarId: 'karigar-1',
      productionOrderId: 'order-1',
      productionIssueId: 'issue-1',
      metalTypeId: 'metal-gold',
      excessWeightGram: new Decimal(1.5),
      status: 'PENDING',
    };

    const legacyDispute = {
      ...pendingDispute,
      id: 'dispute-legacy',
      productionIssueId: null,
      metalTypeId: null,
    };

    beforeEach(() => {
      mockPrisma.productionItem.findMany.mockResolvedValue([]);
      mockPrisma.stockItem.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.karigarDispute.update.mockImplementation(({ data }: any) =>
        Promise.resolve({ ...pendingDispute, ...data }),
      );
    });

    it('CASH_DEDUCTION with resolutionType omitted behaves as before', async () => {
      mockPrisma.karigarDispute.findUnique.mockResolvedValue(pendingDispute);

      await service.resolveDispute('dispute-1', { deductionNpr: 500 }, 'user-1');

      expect(mockPrisma.karigarMetalBalance.upsert).not.toHaveBeenCalled();
      expect(mockPrisma.karigarDispute.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            resolutionType: 'CASH_DEDUCTION',
            deductionNpr: 500,
            status: 'RESOLVED',
          }),
        }),
      );
    });

    it('CASH_DEDUCTION explicit still sets deductionNpr and skips balance upsert', async () => {
      mockPrisma.karigarDispute.findUnique.mockResolvedValue(pendingDispute);

      await service.resolveDispute(
        'dispute-1',
        { resolutionType: 'CASH_DEDUCTION', deductionNpr: 750 },
        'user-1',
      );

      expect(mockPrisma.karigarMetalBalance.upsert).not.toHaveBeenCalled();
      expect(mockPrisma.karigarDispute.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ deductionNpr: 750 }),
        }),
      );
    });

    it('METAL_CARRYFORWARD upserts balance and does not require deductionNpr', async () => {
      mockPrisma.karigarDispute.findUnique.mockResolvedValue(pendingDispute);
      mockPrisma.karigarMetalBalance.upsert.mockResolvedValue({ balanceGram: new Decimal(1.5) });

      await service.resolveDispute(
        'dispute-1',
        { resolutionType: 'METAL_CARRYFORWARD', resolutionNotes: 'Carry forward' },
        'user-1',
      );

      expect(mockPrisma.karigarMetalBalance.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            karigarId_metalTypeId: {
              karigarId: 'karigar-1',
              metalTypeId: 'metal-gold',
            },
          },
          create: expect.objectContaining({ balanceGram: 1.5 }),
          update: { balanceGram: { increment: 1.5 } },
        }),
      );
      expect(mockPrisma.karigarDispute.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            resolutionType: 'METAL_CARRYFORWARD',
            deductionNpr: null,
            status: 'RESOLVED',
          }),
        }),
      );
    });

    it('METAL_CARRYFORWARD on legacy dispute (null metalTypeId) is rejected', async () => {
      mockPrisma.karigarDispute.findUnique.mockResolvedValue(legacyDispute);

      await expect(
        service.resolveDispute(
          'dispute-legacy',
          { resolutionType: 'METAL_CARRYFORWARD' },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);

      expect(mockPrisma.karigarMetalBalance.upsert).not.toHaveBeenCalled();
      expect(mockPrisma.karigarDispute.update).not.toHaveBeenCalled();
    });

    it('CASH_DEDUCTION still works on legacy dispute with null metalTypeId', async () => {
      mockPrisma.karigarDispute.findUnique.mockResolvedValue(legacyDispute);

      await service.resolveDispute(
        'dispute-legacy',
        { deductionNpr: 300 },
        'user-1',
      );

      expect(mockPrisma.karigarMetalBalance.upsert).not.toHaveBeenCalled();
      expect(mockPrisma.karigarDispute.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ deductionNpr: 300, status: 'RESOLVED' }),
        }),
      );
    });

    it('should scope stock release to productionIssueId, not the whole order', async () => {
      mockPrisma.karigarDispute.findUnique.mockResolvedValue({
        ...pendingDispute,
        id: 'dispute-gold',
        productionIssueId: 'issue-gold',
      });
      mockPrisma.productionItem.findMany.mockResolvedValue([{ id: 'pi-gold' }]);

      await service.resolveDispute('dispute-gold', { deductionNpr: 100 }, 'user-1');

      expect(mockPrisma.productionItem.findMany).toHaveBeenCalledWith({
        where: {
          productionReturn: { productionIssueId: 'issue-gold' },
        },
        select: { id: true },
      });
      expect(mockPrisma.stockItem.updateMany).toHaveBeenCalledWith({
        where: {
          productionItemId: { in: ['pi-gold'] },
          status: 'UNDER_DISPUTE',
        },
        data: { status: 'IN_STOCK' },
      });
    });

    it('resolving one dispute on a multi-issue order must not release sibling issue stock', async () => {
      const disputeGold = {
        id: 'dispute-gold',
        karigarId: 'karigar-1',
        productionOrderId: 'order-1',
        productionIssueId: 'issue-gold',
        metalTypeId: 'metal-gold',
        excessWeightGram: new Decimal(1),
        status: 'PENDING',
      };
      const disputeSilver = {
        id: 'dispute-silver',
        karigarId: 'karigar-1',
        productionOrderId: 'order-1',
        productionIssueId: 'issue-silver',
        metalTypeId: 'metal-silver',
        excessWeightGram: new Decimal(1),
        status: 'PENDING',
      };

      const updateManyCalls: any[] = [];
      mockPrisma.stockItem.updateMany.mockImplementation((args: any) => {
        updateManyCalls.push(args);
        return Promise.resolve({ count: 1 });
      });

      // Resolve gold dispute only
      mockPrisma.karigarDispute.findUnique.mockResolvedValue(disputeGold);
      mockPrisma.productionItem.findMany.mockResolvedValue([{ id: 'pi-gold' }]);
      await service.resolveDispute('dispute-gold', { deductionNpr: 100 }, 'user-1');

      expect(updateManyCalls).toHaveLength(1);
      expect(updateManyCalls[0].where.productionItemId.in).toEqual(['pi-gold']);

      // Resolve silver dispute — sibling gold items must not be touched again
      mockPrisma.karigarDispute.findUnique.mockResolvedValue(disputeSilver);
      mockPrisma.productionItem.findMany.mockResolvedValue([{ id: 'pi-silver' }]);
      await service.resolveDispute('dispute-silver', { deductionNpr: 200 }, 'user-1');

      expect(updateManyCalls).toHaveLength(2);
      expect(updateManyCalls[1].where.productionItemId.in).toEqual(['pi-silver']);
      expect(mockPrisma.productionItem.findMany).toHaveBeenLastCalledWith({
        where: {
          productionReturn: { productionIssueId: 'issue-silver' },
        },
        select: { id: true },
      });
    });

    it('legacy disputes without productionIssueId fall back to order-level stock release', async () => {
      mockPrisma.karigarDispute.findUnique.mockResolvedValue(legacyDispute);
      mockPrisma.productionItem.findMany.mockResolvedValue([{ id: 'pi-legacy' }]);

      await service.resolveDispute('dispute-legacy', { deductionNpr: 50 }, 'user-1');

      expect(mockPrisma.productionItem.findMany).toHaveBeenCalledWith({
        where: {
          productionReturn: { productionOrderId: 'order-1' },
        },
        select: { id: true },
      });
    });
  });

  // ── applyBalanceGram on issue creation ─────────────────────────────────────

  describe('createProductionIssue applyBalanceGram', () => {
    beforeEach(() => {
      mockPrisma.productionOrder.findUnique.mockResolvedValue({
        id: 'order-1',
        status: 'OPEN',
        karigarId: 'karigar-1',
        karigar: { id: 'karigar-1' },
      });
      mockPrisma.metalType.findUnique.mockResolvedValue({
        id: 'metal-gold',
        name: 'Gold 22K',
        isActive: true,
      });
      mockPrisma.dailyRate.findFirst.mockResolvedValue({
        sellRatePerGram: new Decimal(8000),
      });
      mockPrisma.productionIssue.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'issue-1', ...data, metalType: { name: 'Gold 22K' } }),
      );
    });

    it('should decrement balance and reduce issued weight when applyBalanceGram is provided', async () => {
      mockPrisma.karigarMetalBalance.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.createProductionIssue({
        productionOrderId: 'order-1',
        metalTypeId: 'metal-gold',
        issuedWeight: { value: 20, unit: 'gram' },
        applyBalanceGram: 5,
      });

      expect(mockPrisma.karigarMetalBalance.updateMany).toHaveBeenCalledWith({
        where: {
          karigarId: 'karigar-1',
          metalTypeId: 'metal-gold',
          balanceGram: { gte: 5 },
        },
        data: { balanceGram: { decrement: 5 } },
      });
      expect(mockPrisma.productionIssue.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            issuedWeightGram: 15,
            appliedFromBalanceGram: 5,
          }),
        }),
      );
      expect(result.effectiveWeightGram).toBe(15);
      expect(result.appliedFromBalanceGram).toBe(5);
    });

    it('should throw ConflictException when balance updateMany returns count 0', async () => {
      mockPrisma.karigarMetalBalance.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.createProductionIssue({
          productionOrderId: 'order-1',
          metalTypeId: 'metal-gold',
          issuedWeight: { value: 20, unit: 'gram' },
          applyBalanceGram: 5,
        }),
      ).rejects.toThrow(ConflictException);

      expect(mockPrisma.productionIssue.create).not.toHaveBeenCalled();
    });

    it('should behave identically when applyBalanceGram is absent', async () => {
      await service.createProductionIssue({
        productionOrderId: 'order-1',
        metalTypeId: 'metal-gold',
        issuedWeight: { value: 20, unit: 'gram' },
      });

      expect(mockPrisma.karigarMetalBalance.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.productionIssue.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            issuedWeightGram: 20,
            appliedFromBalanceGram: undefined,
          }),
        }),
      );
    });
  });

  // ── toleranceGram override ─────────────────────────────────────────────────

  describe('createProductionReturn toleranceGram', () => {
    beforeEach(() => {
      mockPrisma.productionReturn.findFirst.mockResolvedValue(null);
      mockPrisma.productionReturn.create.mockResolvedValue({ id: 'return-1' });
      mockPrisma.dailyRate.findFirst.mockResolvedValue({ id: 'rate-1' });
      mockPrisma.productionItem.create.mockResolvedValue({ id: 'pi-1' });
      mockPrisma.stockItem.create.mockResolvedValue({ id: 'stock-1' });
    });

    it('uses toleranceGram directly when set on the order', async () => {
      mockPrisma.productionOrder.findUnique.mockResolvedValue({
        id: 'order-1',
        status: 'OPEN',
        tolerancePct: new Decimal(50),
        toleranceGram: new Decimal(0.5),
        karigarId: 'karigar-1',
        karigar: {},
      });
      mockPrisma.productionIssue.findUnique.mockResolvedValue({
        id: 'issue-1',
        productionOrderId: 'order-1',
        metalTypeId: 'metal-gold',
        issuedWeightGram: new Decimal(20),
        sourceItems: [],
      });

      const result = await service.createProductionReturn({
        productionOrderId: 'order-1',
        productionIssueId: 'issue-1',
        returnedWeight: { value: 19.2, unit: 'gram' },
        items: [{ description: 'Ring', grossWeight: { value: 19.2, unit: 'gram' } }],
      });

      // kharchar = 0.8g > 0.5g absolute tolerance → dispute
      expect(result.productionReturn.withinTolerance).toBe(false);
      expect(result.productionReturn.maxAllowedWasteGram).toBe('0.5000');
      expect(mockPrisma.karigarDispute.create).toHaveBeenCalled();
    });

    it('falls back to tolerancePct when toleranceGram is null', async () => {
      mockPrisma.productionOrder.findUnique.mockResolvedValue({
        id: 'order-1',
        status: 'OPEN',
        tolerancePct: new Decimal(10),
        toleranceGram: null,
        karigarId: 'karigar-1',
        karigar: {},
      });
      mockPrisma.productionIssue.findUnique.mockResolvedValue({
        id: 'issue-1',
        productionOrderId: 'order-1',
        metalTypeId: 'metal-gold',
        issuedWeightGram: new Decimal(20),
        sourceItems: [],
      });

      const result = await service.createProductionReturn({
        productionOrderId: 'order-1',
        productionIssueId: 'issue-1',
        returnedWeight: { value: 19.2, unit: 'gram' },
        items: [{ description: 'Ring', grossWeight: { value: 19.2, unit: 'gram' } }],
      });

      // kharchar = 0.8g, max allowed = 10% of 20g = 2g → within tolerance
      expect(result.productionReturn.withinTolerance).toBe(true);
      expect(result.productionReturn.maxAllowedWasteGram).toBe('2.0000');
      expect(mockPrisma.karigarDispute.create).not.toHaveBeenCalled();
    });

    it('treats sub-epsilon rounding delta at tolerance boundary as within tolerance', async () => {
      mockPrisma.productionOrder.findUnique.mockResolvedValue({
        id: 'order-1',
        status: 'OPEN',
        tolerancePct: new Decimal(10),
        toleranceGram: null,
        karigarId: 'karigar-1',
        karigar: {},
      });
      mockPrisma.productionIssue.findUnique.mockResolvedValue({
        id: 'issue-1',
        productionOrderId: 'order-1',
        metalTypeId: 'metal-gold',
        issuedWeightGram: new Decimal(20),
        sourceItems: [],
      });

      // maxAllowedWaste = 2g; kharchar = 2.0005g (only 0.5mg over, within epsilon)
      const result = await service.createProductionReturn({
        productionOrderId: 'order-1',
        productionIssueId: 'issue-1',
        returnedWeight: { value: 17.9995, unit: 'gram' },
        items: [{ description: 'Ring', grossWeight: { value: 17.9995, unit: 'gram' } }],
      });

      expect(result.productionReturn.withinTolerance).toBe(true);
      expect(mockPrisma.karigarDispute.create).not.toHaveBeenCalled();
      expect(mockPrisma.stockItem.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'IN_STOCK' }),
        }),
      );
    });

    it('translates concurrent duplicate return (P2002) into ConflictException', async () => {
      mockPrisma.productionOrder.findUnique.mockResolvedValue({
        id: 'order-1',
        status: 'OPEN',
        tolerancePct: new Decimal(10),
        toleranceGram: null,
        karigarId: 'karigar-1',
        karigar: {},
      });
      mockPrisma.productionIssue.findUnique.mockResolvedValue({
        id: 'issue-1',
        productionOrderId: 'order-1',
        metalTypeId: 'metal-gold',
        issuedWeightGram: new Decimal(20),
        sourceItems: [],
      });
      mockPrisma.productionReturn.findFirst.mockResolvedValue(null);
      mockPrisma.productionReturn.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '5.22.0',
          meta: { target: ['productionIssueId'] },
        }),
      );

      await expect(
        service.createProductionReturn({
          productionOrderId: 'order-1',
          productionIssueId: 'issue-1',
          returnedWeight: { value: 19, unit: 'gram' },
          items: [{ description: 'Ring', grossWeight: { value: 19, unit: 'gram' } }],
        }),
      ).rejects.toThrow(ConflictException);

      expect(mockPrisma.productionItem.create).not.toHaveBeenCalled();
      expect(mockPrisma.stockItem.create).not.toHaveBeenCalled();
    });
  });
});
