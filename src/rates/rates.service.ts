import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WeightUtil } from '../common/utils/weight.util';
import { SetDailyRateDto, RateHistoryQueryDto, SetGoldRatesDto } from './dto/rates.dto';
import { GRAMS_PER_TOLA, GRAMS_PER_LAL } from '../common/constants/weight.constants';
import { Decimal } from '@prisma/client/runtime/library';

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
        // Expire all current rates for this gold metal type
        await tx.dailyRate.updateMany({
          where: { metalTypeId: metal.id, isCurrent: true },
          data:  { isCurrent: false },
        });

        // Derive rates using purityFactor relative to 24K base
        const purityFactor = new Decimal(metal.purityFactor);
        const sellRatePerGram = sellGram24K.mul(purityFactor).div(purityFactor24k);
        const buyRatePerGram  = buyGram24K.mul(purityFactor).div(purityFactor24k);

        const sellRatePerTola = sellRatePerGram.mul(GRAMS_PER_TOLA);
        const sellRatePerLal  = sellRatePerGram.mul(GRAMS_PER_LAL);
        const buyRatePerTola  = buyRatePerGram.mul(GRAMS_PER_TOLA);
        const buyRatePerLal   = buyRatePerGram.mul(GRAMS_PER_LAL);

        const rate = await tx.dailyRate.create({
          data: {
            metalTypeId:     metal.id,
            sellRatePerGram,
            sellRatePerTola,
            sellRatePerLal,
            buyRatePerGram,
            buyRatePerTola,
            buyRatePerLal,
            isCurrent:       true,
            updatedByUserId: userId,
          },
          include: {
            metalType: true,
          },
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
    orderBy: { name: 'asc' }
  })
}

}
