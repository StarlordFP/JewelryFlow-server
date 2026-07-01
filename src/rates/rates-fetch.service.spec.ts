import { Test, TestingModule } from '@nestjs/testing';
import { FetchedRateSnapshotStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { RatesFetchService } from './rates-fetch.service';
import { PrismaService } from '../prisma/prisma.service';

describe('RatesFetchService', () => {
  let service: RatesFetchService;
  let mockPrisma: any;

  beforeEach(async () => {
    mockPrisma = {
      fetchedRateSnapshot: {
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      metalType: { findMany: jest.fn().mockResolvedValue([]) },
      dailyRate: { findFirst: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RatesFetchService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get(RatesFetchService);
  });

  describe('evaluateStatus', () => {
    it('flags FAILED when both rates are null', async () => {
      const result = await service.evaluateStatus({
        fineGoldPer10g: null,
        silverPer10g: null,
      });
      expect(result.status).toBe(FetchedRateSnapshotStatus.FAILED);
    });

    it('flags SUSPICIOUS when gold swing exceeds threshold', async () => {
      mockPrisma.metalType.findMany.mockResolvedValue([
        { id: 'g24', name: 'Gold 24K', purityFactor: new Decimal(1) },
        { id: 'sv', name: 'Silver', purityFactor: new Decimal(0.925) },
      ]);
      mockPrisma.dailyRate.findFirst.mockImplementation(({ where }: any) => {
        if (where.metalTypeId === 'g24') {
          return { sellRatePerGram: new Decimal(9000) };
        }
        return null;
      });

      const result = await service.evaluateStatus({
        fineGoldPer10g: 110000,
        silverPer10g: null,
      });
      expect(result.status).toBe(FetchedRateSnapshotStatus.SUSPICIOUS);
      expect(result.warningReason).toContain('24K gold');
    });

    it('returns PENDING when swing is within threshold', async () => {
      mockPrisma.metalType.findMany.mockResolvedValue([
        { id: 'g24', name: 'Gold 24K', purityFactor: new Decimal(1) },
      ]);
      mockPrisma.dailyRate.findFirst.mockResolvedValue({
        sellRatePerGram: new Decimal(10288),
      });

      const result = await service.evaluateStatus({
        fineGoldPer10g: 102880,
        silverPer10g: null,
      });
      expect(result.status).toBe(FetchedRateSnapshotStatus.PENDING);
    });
  });

  describe('isSaturdayKathmandu', () => {
    it('detects Saturday in Kathmandu timezone', () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-06-27T06:00:00.000Z'));
      expect(service.isSaturdayKathmandu()).toBe(true);
      jest.useRealTimers();
    });
  });

  describe('runFetch unchanged-date skip', () => {
    it('skips creating snapshot when nepali date unchanged', async () => {
      jest.spyOn(service['provider'], 'fetchTodayRates').mockResolvedValue({
        fineGoldPer10g: 185000,
        tejabiGoldPer10g: 0,
        silverPer10g: 1450,
        nepaliDateLabel: '2082/09/15',
        rawSnippet: 'snippet',
      });

      mockPrisma.fetchedRateSnapshot.findFirst.mockResolvedValue({
        id: 'snap-1',
        fetchedAt: new Date(),
        source: 'FENEGOSIDA',
        nepaliDateLabel: '2082/09/15',
        fineGoldPer10g: new Decimal(185000),
        silverPer10g: new Decimal(1450),
        status: FetchedRateSnapshotStatus.PENDING,
        warningReason: null,
        rawSnippet: 'old',
        consumedAt: null,
        consumedByDailyRateIds: [],
      });

      const result = await service.runFetch(false);
      expect(mockPrisma.fetchedRateSnapshot.create).not.toHaveBeenCalled();
      expect(result?.id).toBe('snap-1');
    });
  });
});
