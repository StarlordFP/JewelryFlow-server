import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WeightUtil } from '../common/utils/weight.util';
import { SetDailyRateDto, RateHistoryQueryDto } from './dto/rates.dto';

const GRAMS_PER_TOLA = 11.664;
const GRAMS_PER_LAL  = 11.664 / 100;

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
    const { metalTypeId, sellRatePerGram, buyRatePerGram } = dto;

    // Validate metal type exists
    const metal = await this.prisma.metalType.findUnique({
      where: { id: metalTypeId },
    });
    if (!metal || !metal.isActive) {
      throw new NotFoundException(`MetalType ${metalTypeId} not found or inactive`);
    }

    if (buyRatePerGram >= sellRatePerGram) {
      throw new BadRequestException(
        `Buy rate (${buyRatePerGram}) must be lower than sell rate (${sellRatePerGram})`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // Expire all current rates for this metal type
      await tx.dailyRate.updateMany({
        where: { metalTypeId, isCurrent: true },
        data:  { isCurrent: false },
      });

      // Derive all units from gram (master)
      const sellRatePerTola = sellRatePerGram * GRAMS_PER_TOLA;
      const sellRatePerLal  = sellRatePerGram * GRAMS_PER_LAL;
      const buyRatePerTola  = buyRatePerGram  * GRAMS_PER_TOLA;
      const buyRatePerLal   = buyRatePerGram  * GRAMS_PER_LAL;

      const rate = await tx.dailyRate.create({
        data: {
          metalTypeId,
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
          updatedBy: { select: { id: true, name: true } },
        },
      });

      return this.formatRate(rate);
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
    return {
      id:           rate.id,
      metalType:    rate.metalType,
      isCurrent:    rate.isCurrent,
      effectiveDate: rate.effectiveDate,
      updatedBy:    rate.updatedBy,

      sellRate: {
        perGram: Number(rate.sellRatePerGram).toFixed(2),
        perTola: Number(rate.sellRatePerTola).toFixed(2),
        perLal:  Number(rate.sellRatePerLal).toFixed(2),
      },
      buyRate: {
        perGram: Number(rate.buyRatePerGram).toFixed(2),
        perTola: Number(rate.buyRatePerTola).toFixed(2),
        perLal:  Number(rate.buyRatePerLal).toFixed(2),
      },
    };
  }

  async getMetalTypes() {
  return this.prisma.metalType.findMany({
    orderBy: { name: 'asc' }
  })
}

}
