import { Decimal } from '@prisma/client/runtime/library';
import {
  computeBuyRate,
  deriveShopRateFromPureBase,
  PURE_METAL_PURITY_FACTOR,
} from './rates.helpers';

describe('rates.helpers', () => {
  describe('computeBuyRate', () => {
    it('applies default 5% discount correctly', () => {
      const sell = new Decimal(10000);
      const buy = computeBuyRate(sell, 5);
      expect(buy.toFixed(2)).toBe('9500.00');
    });

    it('applies custom discount percentage', () => {
      const sell = new Decimal(1000);
      const buy = computeBuyRate(sell, 3);
      expect(buy.toFixed(2)).toBe('970.00');
    });
  });

  describe('deriveShopRateFromPureBase', () => {
    it('derives 22K from 24K fine gold base', () => {
      const derived = deriveShopRateFromPureBase(
        new Decimal(10000),
        PURE_METAL_PURITY_FACTOR,
        new Decimal(0.9167),
      );
      expect(derived.toFixed(2)).toBe('9167.00');
    });

    it('derives shop silver from pure silver base × purity factor', () => {
      const derived = deriveShopRateFromPureBase(
        new Decimal(150),
        PURE_METAL_PURITY_FACTOR,
        new Decimal(0.925),
      );
      expect(derived.toFixed(2)).toBe('138.75');
    });

    it('24K gold equals pure base when purity factors match', () => {
      const derived = deriveShopRateFromPureBase(
        new Decimal(10288.07),
        PURE_METAL_PURITY_FACTOR,
        PURE_METAL_PURITY_FACTOR,
      );
      expect(derived.toFixed(2)).toBe('10288.07');
    });
  });
});
