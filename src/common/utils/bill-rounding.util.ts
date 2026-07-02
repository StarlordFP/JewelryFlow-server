import { Decimal } from '@prisma/client/runtime/library';
import { isGoldMetal } from './metal.util';

export const GOLD_ROUNDING_UNIT = 100;
export const SILVER_ROUNDING_UNIT = 5;

/** Gold-dominated bills round to 100; all-silver bills round to 5. */
export function resolveRoundingUnit(
  metals: Array<{ name: string } | null | undefined>,
): number {
  return metals.some((m) => isGoldMetal(m)) ? GOLD_ROUNDING_UNIT : SILVER_ROUNDING_UNIT;
}

export interface BillRoundingResult {
  preRoundingPayable: Decimal;
  roundedTotal: Decimal;
  roundingNpr: Decimal;
  unit: number;
}

/**
 * Ceiling rounding for bill totals.
 * preRoundingPayable = subTotalNpr - discountNpr (caller supplies this).
 */
export function applyBillRounding(
  preRoundingPayable: Decimal,
  unit: number,
): BillRoundingResult {
  if (preRoundingPayable.lte(0)) {
    return {
      preRoundingPayable,
      roundedTotal: new Decimal(0),
      roundingNpr: new Decimal(0),
      unit,
    };
  }

  const preNum = preRoundingPayable.toNumber();
  const roundedNum = Math.ceil(preNum / unit) * unit;
  const roundedTotal = new Decimal(roundedNum);

  return {
    preRoundingPayable,
    roundedTotal,
    roundingNpr: roundedTotal.minus(preRoundingPayable),
    unit,
  };
}
