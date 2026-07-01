import { Test, TestingModule } from '@nestjs/testing';
import { RatesService } from './rates.service';
import { PrismaService } from '../prisma/prisma.service';
import { Decimal } from '@prisma/client/runtime/library';
import { FetchedRateSnapshotStatus } from '@prisma/client';

const mockMetals = [
  { id: 'gold-24k-id', name: 'Gold 24K', purityFactor: new Decimal(1.0), isActive: true, buyDiscountPctOverride: null },
  { id: 'gold-22k-id', name: 'Gold 22K', purityFactor: new Decimal(0.9167), isActive: true, buyDiscountPctOverride: null },
  { id: 'silver-id', name: 'Silver', purityFactor: new Decimal(0.925), isActive: true, buyDiscountPctOverride: null },
];

describe('RatesService confirm & derive', () => {
  let service: RatesService;
  let mockPrisma: any;

  beforeEach(async () => {
    mockPrisma = {
      metalType: {
        findMany: jest.fn().mockResolvedValue(mockMetals),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      systemSetting: {
        findUnique: jest.fn().mockResolvedValue({ key: 'buyDiscountPct', value: '5' }),
        upsert: jest.fn(),
      },
      dailyRate: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: `rate-${data.metalTypeId}`,
            ...data,
            metalType: mockMetals.find((m) => m.id === data.metalTypeId),
            updatedBy: { id: 'user-id', name: 'Owner' },
            effectiveDate: new Date(),
            isCurrent: true,
          }),
        ),
      },
      fetchedRateSnapshot: {
        update: jest.fn(),
      },
      $transaction: jest.fn().mockImplementation((cb) => cb(mockPrisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RatesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get(RatesService);
  });

  describe('derivePreview', () => {
    it('returns gold karats and silver with explicit derivation math', async () => {
      const result = await service.derivePreview(10000, 150);

      const g22 = result.rows.find((r) => r.name === 'Gold 22K');
      expect(g22?.derivedSellRatePerGram).toBe('9167.00');
      expect(g22?.derivationFormula).toContain('×');

      const silver = result.rows.find((r) => r.name === 'Silver');
      expect(silver?.pureBaseLabel).toBe('Pure silver (FENEGOSIDA)');
      expect(silver?.derivedSellRatePerGram).toBe('150.00');
      expect(silver?.derivedBuyRatePerGram).toBe('142.50');
    });
  });

  describe('confirmRates', () => {
    it('creates all gold + silver rows and flips isCurrent via updateMany per metal', async () => {
      await service.confirmRates('user-id', {
        fineGoldSellPerGram: 10000,
        pureSilverSellPerGram: 150,
        deriveFromGold24k: true,
      });

      expect(mockPrisma.dailyRate.updateMany).toHaveBeenCalledTimes(3);
      expect(mockPrisma.dailyRate.create).toHaveBeenCalledTimes(3);
    });

    it('uses per-row sell override instead of formula for that metal only', async () => {
      await service.confirmRates('user-id', {
        fineGoldSellPerGram: 10000,
        pureSilverSellPerGram: 150,
        rows: [
          { metalTypeId: 'gold-22k-id', sellRatePerGram: 9500, buyRatePerGram: 9000 },
          { metalTypeId: 'silver-id', sellRatePerGram: 140, buyRatePerGram: 133 },
        ],
      });

      const createCalls = mockPrisma.dailyRate.create.mock.calls;
      const g22 = createCalls.find((c: any) => c[0].data.metalTypeId === 'gold-22k-id');
      expect(Number(g22[0].data.sellRatePerGram)).toBe(9500);
      expect(Number(g22[0].data.buyRatePerGram)).toBe(9000);

      const silver = createCalls.find((c: any) => c[0].data.metalTypeId === 'silver-id');
      expect(Number(silver[0].data.sellRatePerGram)).toBe(140);
    });

    it('marks snapshot CONFIRMED when snapshotId provided', async () => {
      await service.confirmRates('user-id', {
        snapshotId: 'snap-1',
        fineGoldSellPerGram: 10000,
        pureSilverSellPerGram: 150,
      });

      expect(mockPrisma.fetchedRateSnapshot.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'snap-1' },
          data: expect.objectContaining({
            status: FetchedRateSnapshotStatus.CONFIRMED,
          }),
        }),
      );
    });
  });

  describe('getSettings / patchSettings', () => {
    it('returns global buy discount', async () => {
      const settings = await service.getSettings();
      expect(settings.buyDiscountPct).toBe(5);
    });

    it('updates per-metal override', async () => {
      mockPrisma.metalType.findUnique.mockResolvedValue(mockMetals[2]);
      await service.patchSettings({
        metalTypeId: 'silver-id',
        buyDiscountPctOverride: 3,
      });
      expect(mockPrisma.metalType.update).toHaveBeenCalled();
    });
  });
});
