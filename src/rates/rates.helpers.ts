import { Decimal } from '@prisma/client/runtime/library';
import { GRAMS_PER_TOLA, GRAMS_PER_LAL } from '../common/constants/weight.constants';

/** Purity factor representing fine / pure metal (24K gold, FENEGOSIDA pure silver). */
export const PURE_METAL_PURITY_FACTOR = new Decimal(1.0);

export function roundRate(value: Decimal | number): Decimal {
  const num = value instanceof Decimal ? value : new Decimal(value);
  return new Decimal(num.toFixed(2));
}

export function computeBuyRate(
  sellRatePerGram: Decimal,
  discountPct: Decimal | number,
): Decimal {
  const discount = discountPct instanceof Decimal ? discountPct : new Decimal(discountPct);
  return roundRate(sellRatePerGram.mul(new Decimal(1).minus(discount.div(100))));
}

/**
 * Derive a shop metal sell rate from a pure-metal base rate using purity ratios.
 * shopRate = pureBaseSellPerGram × (targetPurityFactor / pureBasePurityFactor)
 */
export function deriveShopRateFromPureBase(
  pureBaseSellPerGram: Decimal,
  pureBasePurityFactor: Decimal,
  targetPurityFactor: Decimal,
): Decimal {
  return roundRate(
    pureBaseSellPerGram.mul(targetPurityFactor).div(pureBasePurityFactor),
  );
}

/**
 * Expire current DailyRate rows for a metal type and insert a new isCurrent row.
 * Shared by setGoldRatesFrom24K, confirm flow, and future rate writers.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function expireAndCreateDailyRate(
  tx: any,
  params: {
    metalTypeId: string;
    sellRatePerGram: Decimal;
    buyRatePerGram: Decimal;
    userId: string;
    include?: Record<string, unknown>;
  },
) {
  const { metalTypeId, sellRatePerGram, buyRatePerGram, userId, include } = params;

  await tx.dailyRate.updateMany({
    where: { metalTypeId, isCurrent: true },
    data: { isCurrent: false },
  });

  const sellRatePerTola = sellRatePerGram.mul(GRAMS_PER_TOLA);
  const sellRatePerLal = sellRatePerGram.mul(GRAMS_PER_LAL);
  const buyRatePerTola = buyRatePerGram.mul(GRAMS_PER_TOLA);
  const buyRatePerLal = buyRatePerGram.mul(GRAMS_PER_LAL);

  return tx.dailyRate.create({
    data: {
      metalTypeId,
      sellRatePerGram,
      sellRatePerTola,
      sellRatePerLal,
      buyRatePerGram,
      buyRatePerTola,
      buyRatePerLal,
      isCurrent: true,
      updatedByUserId: userId,
    },
    include: include ?? { metalType: true },
  });
}
