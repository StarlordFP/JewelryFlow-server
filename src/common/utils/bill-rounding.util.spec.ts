import { Decimal } from '@prisma/client/runtime/library';
import {
  applyBillRounding,
  GOLD_ROUNDING_UNIT,
  resolveRoundingUnit,
  SILVER_ROUNDING_UNIT,
} from './bill-rounding.util';

describe('resolveRoundingUnit', () => {
  it('uses 100 when any line is gold', () => {
    expect(resolveRoundingUnit([{ name: 'Gold 22K' }, { name: 'Silver' }])).toBe(
      GOLD_ROUNDING_UNIT,
    );
  });

  it('uses 5 when all lines are silver', () => {
    expect(resolveRoundingUnit([{ name: 'Silver' }])).toBe(SILVER_ROUNDING_UNIT);
  });
});

describe('applyBillRounding', () => {
  it('ceil gold total to nearest 100', () => {
    const result = applyBillRounding(new Decimal(97447), GOLD_ROUNDING_UNIT);
    expect(result.roundedTotal.toNumber()).toBe(97500);
    expect(result.roundingNpr.toNumber()).toBe(53);
  });

  it('ceil silver total to nearest 5', () => {
    const result = applyBillRounding(new Decimal(3583), SILVER_ROUNDING_UNIT);
    expect(result.roundedTotal.toNumber()).toBe(3585);
    expect(result.roundingNpr.toNumber()).toBe(2);
  });

  it('leaves already-round totals unchanged', () => {
    const result = applyBillRounding(new Decimal(254200), GOLD_ROUNDING_UNIT);
    expect(result.roundedTotal.toNumber()).toBe(254200);
    expect(result.roundingNpr.toNumber()).toBe(0);
  });

  it('applies rounding after discount (preRoundingPayable input)', () => {
    const result = applyBillRounding(new Decimal(254247), GOLD_ROUNDING_UNIT);
    expect(result.roundedTotal.toNumber()).toBe(254300);
    expect(result.roundingNpr.toNumber()).toBe(53);
  });
});
