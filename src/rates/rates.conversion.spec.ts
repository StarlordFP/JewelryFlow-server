// src/rates/rates.conversion.spec.ts

import { Test, TestingModule } from '@nestjs/testing';
import { RatesService } from './rates.service';
import { PrismaService } from '../prisma/prisma.service';
import { Decimal } from '@prisma/client/runtime/library';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { GRAMS_PER_TOLA, GRAMS_PER_LAL } from '../common/constants/weight.constants';

const mockMetalTypes = [
  { id: 'gold-24k-id', name: 'Gold 24K', purityFactor: new Decimal(1.0000), isActive: true },
  { id: 'gold-22k-id', name: 'Gold 22K', purityFactor: new Decimal(0.9167), isActive: true },
  { id: 'gold-18k-id', name: 'Gold 18K', purityFactor: new Decimal(0.7500), isActive: true },
  { id: 'gold-14k-id', name: 'Gold 14K', purityFactor: new Decimal(0.5833), isActive: true },
  { id: 'silver-id', name: 'Silver', purityFactor: new Decimal(0.9990), isActive: true },
];

describe('Rates Conversion Unit Tests', () => {
  let service: RatesService;
  let mockPrisma: any;

  beforeEach(async () => {
    mockPrisma = {
      metalType: {
        findUnique: jest.fn().mockImplementation(({ where }) => {
          const metal = mockMetalTypes.find((m) => m.id === where.id);
          return Promise.resolve(metal || null);
        }),
        findMany: jest.fn().mockResolvedValue(mockMetalTypes),
      },
      dailyRate: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockImplementation(({ data }) => {
          const metal = mockMetalTypes.find((m) => m.id === data.metalTypeId);
          return Promise.resolve({
            id: 'new-rate-id',
            ...data,
            metalType: metal,
            updatedBy: { id: 'user-id', name: 'Test User' },
            effectiveDate: new Date(),
          });
        }),
      },
      $transaction: jest.fn().mockImplementation((cb) => cb(mockPrisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RatesService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    service = module.get<RatesService>(RatesService);
  });

  describe('Gold rate derivation from 24K base', () => {
    it('24K 120000/tola → correct perGram', async () => {
      const result = await service.setGoldRatesFrom24K('user-id', {
        gold24kSellPerTola: 120000,
        gold24kBuyPerTola: 118000,
      });

      // Verify transaction was called
      expect(mockPrisma.$transaction).toHaveBeenCalled();

      // Find 24K rate
      const gold24k = result.rates.find((r) => r.metal === 'Gold 24K');
      expect(gold24k).toBeDefined();
      expect(gold24k.sellPerTola).toBe('120000.00');
      expect(gold24k.buyPerTola).toBe('118000.00');

      // Check create calls to verify DB stored values
      const createCalls = mockPrisma.dailyRate.create.mock.calls;
      const rate24kCall = createCalls.find((call: any) => call[0].data.metalTypeId === 'gold-24k-id');
      expect(rate24kCall).toBeDefined();

      const data = rate24kCall[0].data;
      expect(new Decimal(data.sellRatePerGram).toNumber()).toBeCloseTo(120000 / 11.664, 4);
      expect(new Decimal(data.buyRatePerGram).toNumber()).toBeCloseTo(118000 / 11.664, 4);
    });

    it('22K derived correctly from 24K base', async () => {
      const result = await service.setGoldRatesFrom24K('user-id', {
        gold24kSellPerTola: 120000,
        gold24kBuyPerTola: 118000,
      });

      const gold22k = result.rates.find((r) => r.metal === 'Gold 22K');
      expect(gold22k).toBeDefined();
      expect(gold22k.sellPerTola).toBe('110004.00'); // 120000 * 0.9167
      expect(gold22k.buyPerTola).toBe('108170.60');  // 118000 * 0.9167
    });

    it('18K derived correctly from 24K base', async () => {
      const result = await service.setGoldRatesFrom24K('user-id', {
        gold24kSellPerTola: 120000,
        gold24kBuyPerTola: 118000,
      });

      const gold18k = result.rates.find((r) => r.metal === 'Gold 18K');
      expect(gold18k).toBeDefined();
      expect(gold18k.sellPerTola).toBe('90000.00'); // 120000 * 0.75
      expect(gold18k.buyPerTola).toBe('88500.00');  // 118000 * 0.75
    });

    it('14K derived correctly from 24K base', async () => {
      const result = await service.setGoldRatesFrom24K('user-id', {
        gold24kSellPerTola: 120000,
        gold24kBuyPerTola: 118000,
      });

      const gold14k = result.rates.find((r) => r.metal === 'Gold 14K');
      expect(gold14k).toBeDefined();
      expect(gold14k.sellPerTola).toBe('69996.00'); // 120000 * 0.5833
      expect(gold14k.buyPerTola).toBe('68829.40');  // 118000 * 0.5833
    });

    it('derived perTola matches input perTola within 0.01 NPR', async () => {
      await service.setGoldRatesFrom24K('user-id', {
        gold24kSellPerTola: 120000,
        gold24kBuyPerTola: 118000,
      });

      const createCalls = mockPrisma.dailyRate.create.mock.calls;
      const rate24kCall = createCalls.find((call: any) => call[0].data.metalTypeId === 'gold-24k-id');
      const data = rate24kCall[0].data;

      const derivedSellTola = new Decimal(data.sellRateTola || data.sellRatePerTola).toNumber();
      const derivedBuyTola = new Decimal(data.buyRateTola || data.buyRatePerTola).toNumber();

      expect(Math.abs(derivedSellTola - 120000)).toBeLessThan(0.01);
      expect(Math.abs(derivedBuyTola - 118000)).toBeLessThan(0.01);
    });

    it('sellRate > buyRate validation', async () => {
      await expect(
        service.setGoldRatesFrom24K('user-id', {
          gold24kSellPerTola: 120000,
          gold24kBuyPerTola: 120000,
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.setGoldRatesFrom24K('user-id', {
          gold24kSellPerTola: 120000,
          gold24kBuyPerTola: 121000,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('negative rate rejected', async () => {
      await expect(
        service.setGoldRatesFrom24K('user-id', {
          gold24kSellPerTola: -100,
          gold24kBuyPerTola: 100,
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.setGoldRatesFrom24K('user-id', {
          gold24kSellPerTola: 100,
          gold24kBuyPerTola: -10,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('zero rate rejected', async () => {
      await expect(
        service.setGoldRatesFrom24K('user-id', {
          gold24kSellPerTola: 0,
          gold24kBuyPerTola: 100,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('Silver rate setting', () => {
    it('perTola input → correct perGram stored', async () => {
      const rate = await service.setRate('user-id', {
        metalTypeId: 'silver-id',
        sellRatePerTola: 1450,
        buyRatePerTola: 1400,
      });

      expect(rate.sellRatePerTola).toBe('1450.00');
      expect(rate.buyRatePerTola).toBe('1400.00');

      const createCalls = mockPrisma.dailyRate.create.mock.calls;
      const silverCall = createCalls.find((call: any) => call[0].data.metalTypeId === 'silver-id');
      const data = silverCall[0].data;

      expect(new Decimal(data.sellRatePerGram).toNumber()).toBeCloseTo(1450 / 11.664, 4);
      expect(new Decimal(data.buyRatePerGram).toNumber()).toBeCloseTo(1400 / 11.664, 4);
    });

    it('perGram input → correct perTola stored', async () => {
      const rate = await service.setRate('user-id', {
        metalTypeId: 'silver-id',
        sellRatePerGram: 124.31,
        buyRatePerGram: 120.03,
      });

      expect(rate.sellRatePerGram).toBe('124.31');
      expect(rate.buyRatePerGram).toBe('120.03');
      expect(Number(rate.sellRatePerTola)).toBeCloseTo(124.31 * 11.664, 2);
      expect(Number(rate.buyRatePerTola)).toBeCloseTo(120.03 * 11.664, 2);
    });

    it('perLal calculated correctly', async () => {
      const rate = await service.setRate('user-id', {
        metalTypeId: 'silver-id',
        sellRatePerGram: 124.31,
        buyRatePerGram: 120.03,
      });

      expect(Number(rate.sellRatePerLal)).toBeCloseTo(124.31 * 11.664 / 100, 2);
      expect(Number(rate.buyRatePerLal)).toBeCloseTo(120.03 * 11.664 / 100, 2);
    });

    it('defaults to silver metal lookup when metalTypeId is missing', async () => {
      mockPrisma.metalType.findFirst = jest.fn().mockResolvedValue(mockMetalTypes[4]); // silver-id

      const rate = await service.setRate('user-id', {
        sellRatePerTola: 1450,
        buyRatePerTola: 1400,
      });

      expect(rate.metalType.id).toBe('silver-id');
      expect(rate.sellRatePerTola).toBe('1450.00');
      expect(mockPrisma.metalType.findFirst).toHaveBeenCalled();
    });
  });
});
