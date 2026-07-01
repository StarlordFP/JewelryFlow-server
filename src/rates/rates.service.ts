import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  SetDailyRateDto,
  RateHistoryQueryDto,
  SetGoldRatesDto,
  ConfirmRatesDto,
  PatchRatesSettingsDto,
} from './dto/rates.dto';
import { GRAMS_PER_TOLA, GRAMS_PER_LAL } from '../common/constants/weight.constants';
import { Decimal } from '@prisma/client/runtime/library';
import { FetchedRateSnapshotStatus } from '@prisma/client';
import {
  expireAndCreateDailyRate,
  deriveShopRateFromPureBase,
  computeBuyRate,
  roundRate,
  PURE_METAL_PURITY_FACTOR,
} from './rates.helpers';
import {
  BUY_DISCOUNT_PCT_KEY,
  DEFAULT_BUY_DISCOUNT_PCT,
} from './rates.constants';

@Injectable()
export class RatesService {
  constructor(private readonly prisma: PrismaService) {}

  // ════════════════════════════════════════════════════════════════════════════
  //  SET TODAY'S RATE
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Set today's buy and sell rate for a metal type.
   * Automatically expires the previous current rate (isCurrent = false).
   * Derives per-tola and per-lal from per-gram input.
   */
  async setRate(userId: string, dto: SetDailyRateDto) {
    const { metalTypeId, sellRatePerGram, buyRatePerGram, sellRatePerTola, buyRatePerTola } = dto;

    let resolvedMetalTypeId = metalTypeId;

    if (!resolvedMetalTypeId) {
      const silverMetal = await this.prisma.metalType.findFirst({
        where: {
          name: {
            contains: 'silver',
            mode: 'insensitive',
          },
          isActive: true,
        },
      });
      if (!silverMetal) {
        throw new NotFoundException(`Active Silver metal type not found in database`);
      }
      resolvedMetalTypeId = silverMetal.id;
    }

    // Validate metal type exists
    const metal = await this.prisma.metalType.findUnique({
      where: { id: resolvedMetalTypeId },
    });
    if (!metal || !metal.isActive) {
      throw new NotFoundException(`MetalType ${resolvedMetalTypeId} not found or inactive`);
    }

    let sellGramDec: Decimal;
    let buyGramDec: Decimal;

    if (sellRatePerTola !== undefined && buyRatePerTola !== undefined) {
      sellGramDec = new Decimal(sellRatePerTola).div(GRAMS_PER_TOLA);
      buyGramDec = new Decimal(buyRatePerTola).div(GRAMS_PER_TOLA);
    } else if (sellRatePerGram !== undefined && buyRatePerGram !== undefined) {
      sellGramDec = new Decimal(sellRatePerGram);
      buyGramDec = new Decimal(buyRatePerGram);
    } else {
      throw new BadRequestException(
        `Provide either both (sellRatePerGram, buyRatePerGram) or both (sellRatePerTola, buyRatePerTola)`,
      );
    }

    if (buyGramDec.lte(0) || sellGramDec.lte(0)) {
      throw new BadRequestException(`Rates must be positive numbers`);
    }

    if (buyGramDec.gte(sellGramDec)) {
      throw new BadRequestException(
        `Buy rate (${buyGramDec.toString()}) must be lower than sell rate (${sellGramDec.toString()})`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // Expire all current rates for this metal type
      await tx.dailyRate.updateMany({
        where: { metalTypeId: resolvedMetalTypeId, isCurrent: true },
        data:  { isCurrent: false },
      });

      // Derive all units from gram (master) using Decimal
      const sellRatePerTolaDerived = sellGramDec.mul(GRAMS_PER_TOLA);
      const sellRatePerLalDerived  = sellGramDec.mul(GRAMS_PER_LAL);
      const buyRatePerTolaDerived  = buyGramDec.mul(GRAMS_PER_TOLA);
      const buyRatePerLalDerived   = buyGramDec.mul(GRAMS_PER_LAL);

      const rate = await tx.dailyRate.create({
        data: {
          metalTypeId:     resolvedMetalTypeId,
          sellRatePerGram: sellGramDec,
          sellRatePerTola: sellRatePerTolaDerived,
          sellRatePerLal:  sellRatePerLalDerived,
          buyRatePerGram:  buyGramDec,
          buyRatePerTola:  buyRatePerTolaDerived,
          buyRatePerLal:   buyRatePerLalDerived,
          isCurrent:       true,
          updatedByUserId: userId,
        },
        include: {
          metalType: true,
          updatedBy: { select: { id: true, name: true } },
        },
      });

      return this.formatRate(rate);
    });
  }

  /**
   * Set gold rates for all karat types derived from 24K base rate.
   * Atomically expires previous current rates and inserts new ones.
   */
  async setGoldRatesFrom24K(userId: string, dto: SetGoldRatesDto) {
    const { gold24kSellPerTola, gold24kBuyPerTola, gold24kSellPerGram, gold24kBuyPerGram } = dto;

    let sellGram24K: Decimal;
    let buyGram24K: Decimal;

    if (gold24kSellPerTola !== undefined && gold24kBuyPerTola !== undefined) {
      sellGram24K = new Decimal(gold24kSellPerTola).div(GRAMS_PER_TOLA);
      buyGram24K = new Decimal(gold24kBuyPerTola).div(GRAMS_PER_TOLA);
    } else if (gold24kSellPerGram !== undefined && gold24kBuyPerGram !== undefined) {
      sellGram24K = new Decimal(gold24kSellPerGram);
      buyGram24K = new Decimal(gold24kBuyPerGram);
    } else {
      throw new BadRequestException(
        `Provide either both (gold24kSellPerTola, gold24kBuyPerTola) or both (gold24kSellPerGram, gold24kBuyPerGram)`,
      );
    }

    if (buyGram24K.lte(0) || sellGram24K.lte(0)) {
      throw new BadRequestException(`Rates must be positive numbers`);
    }

    if (buyGram24K.gte(sellGram24K)) {
      throw new BadRequestException(
        `Buy rate (${buyGram24K.toString()}) must be lower than sell rate (${sellGram24K.toString()})`,
      );
    }

    // Fetch all active metal types from DB
    const metals = await this.prisma.metalType.findMany({
      where: { isActive: true },
    });

    // Filter gold metal types
    const goldMetals = metals.filter((m) => m.name.toLowerCase().includes('gold'));
    if (goldMetals.length === 0) {
      throw new NotFoundException(`No active gold metal types found in the database`);
    }

    // Find 24K gold type to check its purity factor
    const gold24k = goldMetals.find((m) => m.name.toLowerCase().includes('24k'));
    const purityFactor24k = gold24k ? new Decimal(gold24k.purityFactor) : new Decimal(1.0);

    return this.prisma.$transaction(async (tx) => {
      const results: any[] = [];

      for (const metal of goldMetals) {
        // Derive rates using purityFactor relative to 24K base
        const purityFactor = new Decimal(metal.purityFactor);
        const sellRatePerGram = sellGram24K.mul(purityFactor).div(purityFactor24k);
        const buyRatePerGram  = buyGram24K.mul(purityFactor).div(purityFactor24k);

        const rate = await expireAndCreateDailyRate(tx, {
          metalTypeId:     metal.id,
          sellRatePerGram,
          buyRatePerGram,
          userId,
          include:         { metalType: true },
        });

        const formatted = this.formatRate(rate);
        results.push({
          metal:       metal.name,
          sellPerTola: formatted.sellRatePerTola,
          buyPerTola:  formatted.buyRatePerTola,
        });
      }

      // Sort results: 24K, 22K, 18K, 14K
      const order = ['24k', '22k', '18k', '14k'];
      results.sort((a, b) => {
        const aIndex = order.findIndex((k) => a.metal.toLowerCase().includes(k));
        const bIndex = order.findIndex((k) => b.metal.toLowerCase().includes(k));
        if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
        if (aIndex !== -1) return -1;
        if (bIndex !== -1) return 1;
        return a.metal.localeCompare(b.metal);
      });

      const baseSellTolaValue = gold24kSellPerTola ?? sellGram24K.mul(GRAMS_PER_TOLA).toNumber();
      const baseSellTolaFormatted = new Decimal(baseSellTolaValue)
        .toNumber()
        .toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

      return {
        message: 'All gold rates set successfully',
        base:    `24K sell: NPR ${baseSellTolaFormatted}/tola`,
        rates:   results,
      };
    });
  }


  // ════════════════════════════════════════════════════════════════════════════
  //  TODAY'S RATES
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Get all current rates — one per metal type.
   * Used on the dashboard every morning.
   */
  async getTodaysRates() {
    const rates = await this.prisma.dailyRate.findMany({
      where:   { isCurrent: true },
      include: {
        metalType: true,
        updatedBy: { select: { id: true, name: true } },
      },
      orderBy: { metalType: { name: 'asc' } },
    });

    return rates.map((r) => this.formatRate(r));
  }

  /**
   * Get current rate for a specific metal type.
   */
  async getCurrentRate(metalTypeId: string) {
    const rate = await this.prisma.dailyRate.findFirst({
      where:   { metalTypeId, isCurrent: true },
      orderBy: { effectiveDate: 'desc' },
      include: {
        metalType: true,
        updatedBy: { select: { id: true, name: true } },
      },
    });

    if (!rate) {
      throw new NotFoundException(
        `No current rate set for this metal type. Please set today's rate first.`,
      );
    }

    return this.formatRate(rate);
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  RATE HISTORY
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Rate history — all rates, newest first.
   * Filterable by metal type and date range.
   */
  async getRateHistory(query: RateHistoryQueryDto) {
    const { metalTypeId, from, to, page = 1, limit = 30 } = query;
    const skip  = (page - 1) * limit;
    const where: any = {};

    if (metalTypeId) where.metalTypeId = metalTypeId;
    if (from || to) {
      where.effectiveDate = {};
      if (from) where.effectiveDate.gte = new Date(from);
      if (to)   where.effectiveDate.lte = new Date(to);
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.dailyRate.findMany({
        where,
        orderBy: { effectiveDate: 'desc' },
        skip,
        take:    limit,
        include: {
          metalType: { select: { id: true, name: true } },
          updatedBy: { select: { id: true, name: true } },
        },
      }),
      this.prisma.dailyRate.count({ where }),
    ]);

    return {
      data: items.map((r) => this.formatRate(r)),
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    };
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  HELPERS
  // ════════════════════════════════════════════════════════════════════════════

  /** Format rate with all three units for all three unit displays */
  private formatRate(rate: any) {
    // Convert Decimal types to number string
    const toNum = (val: any) => {
      if (val === null || val === undefined) return '0.00';
      const num = typeof val === 'string' ? parseFloat(val) : Number(val);
      return isNaN(num) ? '0.00' : num.toFixed(2);
    };

    return {
      id:           rate.id,
      metalType:    rate.metalType,
      isCurrent:    rate.isCurrent,
      effectiveDate: rate.effectiveDate,
      updatedBy:    rate.updatedBy,

      sellRatePerGram: toNum(rate.sellRatePerGram),
      sellRatePerTola: toNum(rate.sellRatePerTola),
      sellRatePerLal:  toNum(rate.sellRatePerLal),
      buyRatePerGram:  toNum(rate.buyRatePerGram),
      buyRatePerTola:  toNum(rate.buyRatePerTola),
      buyRatePerLal:   toNum(rate.buyRatePerLal),
    };
  }

  async getMetalTypes() {
    return this.prisma.metalType.findMany({
      orderBy: { name: 'asc' },
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  SETTINGS (buy discount)
  // ════════════════════════════════════════════════════════════════════════════

  async getSettings() {
    const globalPct = await this.getGlobalBuyDiscountPct();
    const metals = await this.prisma.metalType.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        buyDiscountPctOverride: true,
      },
    });

    return {
      buyDiscountPct: globalPct,
      metals: metals.map((m) => ({
        metalTypeId: m.id,
        name: m.name,
        buyDiscountPctOverride:
          m.buyDiscountPctOverride != null
            ? Number(m.buyDiscountPctOverride)
            : null,
      })),
    };
  }

  async patchSettings(dto: PatchRatesSettingsDto) {
    if (dto.buyDiscountPct !== undefined) {
      await this.prisma.systemSetting.upsert({
        where: { key: BUY_DISCOUNT_PCT_KEY },
        create: { key: BUY_DISCOUNT_PCT_KEY, value: String(dto.buyDiscountPct) },
        update: { value: String(dto.buyDiscountPct) },
      });
    }

    if (dto.metalTypeId !== undefined) {
      const metal = await this.prisma.metalType.findUnique({
        where: { id: dto.metalTypeId },
      });
      if (!metal) {
        throw new NotFoundException(`MetalType ${dto.metalTypeId} not found`);
      }

      if (dto.buyDiscountPctOverride === null) {
        await this.prisma.metalType.update({
          where: { id: dto.metalTypeId },
          data: { buyDiscountPctOverride: null },
        });
      } else if (dto.buyDiscountPctOverride !== undefined) {
        await this.prisma.metalType.update({
          where: { id: dto.metalTypeId },
          data: { buyDiscountPctOverride: new Decimal(dto.buyDiscountPctOverride) },
        });
      }
    }

    return this.getSettings();
  }

  async getGlobalBuyDiscountPct(): Promise<number> {
    const row = await this.prisma.systemSetting.findUnique({
      where: { key: BUY_DISCOUNT_PCT_KEY },
    });
    if (!row) return DEFAULT_BUY_DISCOUNT_PCT;
    const parsed = parseFloat(row.value);
    return Number.isNaN(parsed) ? DEFAULT_BUY_DISCOUNT_PCT : parsed;
  }

  async getEffectiveBuyDiscountPct(metal: {
    buyDiscountPctOverride: Decimal | null;
  }): Promise<number> {
    if (metal.buyDiscountPctOverride != null) {
      return Number(metal.buyDiscountPctOverride);
    }
    return this.getGlobalBuyDiscountPct();
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  DERIVE PREVIEW & CONFIRM (fetch-derived flow)
  // ════════════════════════════════════════════════════════════════════════════

  async derivePreview(fineGoldSellPerGram: number, pureSilverSellPerGram: number) {
    const metals = await this.prisma.metalType.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });

    const goldMetals = metals.filter((m) => m.name.toLowerCase().includes('gold'));
    const silverMetal = metals.find((m) => m.name.toLowerCase().includes('silver'));
    const gold24k = goldMetals.find((m) => m.name.toLowerCase().includes('24k'));
    const gold24kPurity = gold24k
      ? new Decimal(gold24k.purityFactor)
      : PURE_METAL_PURITY_FACTOR;

    const fineGoldBase = new Decimal(fineGoldSellPerGram);
    const pureSilverBase = new Decimal(pureSilverSellPerGram);
    const globalDiscount = await this.getGlobalBuyDiscountPct();

    const goldRows = await Promise.all(
      goldMetals.map(async (metal) => {
        const shopPurity = new Decimal(metal.purityFactor);
        const derivedSell = deriveShopRateFromPureBase(
          fineGoldBase,
          gold24kPurity,
          shopPurity,
        );
        const discount = await this.getEffectiveBuyDiscountPct(metal);
        const derivedBuy = computeBuyRate(derivedSell, discount);

        return {
          metalTypeId: metal.id,
          name: metal.name,
          metalKind: 'gold' as 'gold' | 'silver',
          pureBaseLabel: 'Fine gold (24K / 9999)',
          pureBaseSellPerGram: fineGoldBase.toFixed(2),
          pureBasePurityFactor: gold24kPurity.toFixed(4),
          shopPurityFactor: shopPurity.toFixed(4),
          derivationFormula: `${fineGoldBase.toFixed(2)} × (${shopPurity.toFixed(4)} ÷ ${gold24kPurity.toFixed(4)}) = ${derivedSell.toFixed(2)} NPR/g`,
          derivedSellRatePerGram: derivedSell.toFixed(2),
          derivedBuyRatePerGram: derivedBuy.toFixed(2),
          buyDiscountPct: discount,
        };
      }),
    );

    type PreviewRow = (typeof goldRows)[number];
    const rows: PreviewRow[] = [...goldRows];

    if (silverMetal) {
      // FENEGOSIDA publishes 100% pure silver — daily rate matches that figure directly.
      // MetalType.purityFactor (0.925) applies to item weight/content in stock/sales, not here.
      const derivedSell = roundRate(pureSilverBase);
      const discount = await this.getEffectiveBuyDiscountPct(silverMetal);
      const derivedBuy = computeBuyRate(derivedSell, discount);

      rows.push({
        metalTypeId: silverMetal.id,
        name: silverMetal.name,
        metalKind: 'silver' as const,
        pureBaseLabel: 'Pure silver (FENEGOSIDA)',
        pureBaseSellPerGram: pureSilverBase.toFixed(2),
        pureBasePurityFactor: PURE_METAL_PURITY_FACTOR.toFixed(4),
        shopPurityFactor: PURE_METAL_PURITY_FACTOR.toFixed(4),
        derivationFormula: `${pureSilverBase.toFixed(2)} NPR/g (100% pure — stored as published, no purity discount)`,
        derivedSellRatePerGram: derivedSell.toFixed(2),
        derivedBuyRatePerGram: derivedBuy.toFixed(2),
        buyDiscountPct: discount,
      });
    }

    return { rows, globalBuyDiscountPct: globalDiscount };
  }

  async confirmRates(userId: string, dto: ConfirmRatesDto) {
    const deriveGold = dto.deriveFromGold24k !== false;
    const metals = await this.prisma.metalType.findMany({
      where: { isActive: true },
    });

    const goldMetals = metals.filter((m) => m.name.toLowerCase().includes('gold'));
    const silverMetal = metals.find((m) => m.name.toLowerCase().includes('silver'));
    const gold24k = goldMetals.find((m) => m.name.toLowerCase().includes('24k'));

    if (goldMetals.length === 0) {
      throw new NotFoundException('No active gold metal types found');
    }
    if (!silverMetal) {
      throw new NotFoundException('No active silver metal type found');
    }

    const gold24kPurity = gold24k
      ? new Decimal(gold24k.purityFactor)
      : PURE_METAL_PURITY_FACTOR;
    const fineGoldBase = new Decimal(dto.fineGoldSellPerGram);
    const pureSilverBase = new Decimal(dto.pureSilverSellPerGram);

    const overrideMap = new Map(
      (dto.rows ?? []).map((r) => [r.metalTypeId, r]),
    );

    type PlannedRow = {
      metal: (typeof metals)[0];
      sellRatePerGram: Decimal;
      buyRatePerGram: Decimal;
      pureBaseLabel: string;
    };

    const planned: PlannedRow[] = [];

    if (deriveGold) {
      for (const metal of goldMetals) {
        const override = overrideMap.get(metal.id);
        const shopPurity = new Decimal(metal.purityFactor);
        const sell =
          override?.sellRatePerGram != null
            ? new Decimal(override.sellRatePerGram)
            : deriveShopRateFromPureBase(fineGoldBase, gold24kPurity, shopPurity);
        const discount = await this.getEffectiveBuyDiscountPct(metal);
        const buy =
          override?.buyRatePerGram != null
            ? new Decimal(override.buyRatePerGram)
            : computeBuyRate(sell, discount);

        planned.push({
          metal,
          sellRatePerGram: sell,
          buyRatePerGram: buy,
          pureBaseLabel: 'Fine gold (24K / 9999)',
        });
      }
    } else {
      const gold24kMetal = gold24k ?? goldMetals[0];
      const override = overrideMap.get(gold24kMetal.id);
      if (!override?.sellRatePerGram || !override?.buyRatePerGram) {
        throw new BadRequestException(
          'When deriveFromGold24k is false, provide sell and buy for 24K gold in rows',
        );
      }
      planned.push({
        metal: gold24kMetal,
        sellRatePerGram: new Decimal(override.sellRatePerGram),
        buyRatePerGram: new Decimal(override.buyRatePerGram),
        pureBaseLabel: 'Fine gold (24K / 9999)',
      });
    }

    {
      const override = overrideMap.get(silverMetal.id);
      const sell =
        override?.sellRatePerGram != null
          ? new Decimal(override.sellRatePerGram)
          : roundRate(pureSilverBase);
      const discount = await this.getEffectiveBuyDiscountPct(silverMetal);
      const buy =
        override?.buyRatePerGram != null
          ? new Decimal(override.buyRatePerGram)
          : computeBuyRate(sell, discount);

      planned.push({
        metal: silverMetal,
        sellRatePerGram: sell,
        buyRatePerGram: buy,
        pureBaseLabel: 'Pure silver (FENEGOSIDA)',
      });
    }

    for (const row of planned) {
      if (row.buyRatePerGram.gte(row.sellRatePerGram)) {
        throw new BadRequestException(
          `Buy rate must be lower than sell rate for ${row.metal.name}`,
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const createdIds: string[] = [];
      const results: ReturnType<RatesService['formatRate']>[] = [];

      for (const row of planned) {
        const rate = await expireAndCreateDailyRate(tx, {
          metalTypeId: row.metal.id,
          sellRatePerGram: row.sellRatePerGram,
          buyRatePerGram: row.buyRatePerGram,
          userId,
          include: {
            metalType: true,
            updatedBy: { select: { id: true, name: true } },
          },
        });
        createdIds.push((rate as { id: string }).id);
        results.push(this.formatRate(rate));
      }

      if (dto.snapshotId) {
        await tx.fetchedRateSnapshot.update({
          where: { id: dto.snapshotId },
          data: {
            status: FetchedRateSnapshotStatus.CONFIRMED,
            consumedAt: new Date(),
            consumedByDailyRateIds: createdIds,
          },
        });
      }

      return {
        message: 'Daily rates confirmed successfully',
        rates: results,
        snapshotId: dto.snapshotId ?? null,
      };
    });
  }

}
