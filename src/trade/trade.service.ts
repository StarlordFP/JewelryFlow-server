import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StockSkuService } from '../stock/stock-sku.service';
import {
  CreateTradePartyDto,
  UpdateTradePartyDto,
  CreateTradeDto,
  UpdateTradeStatusDto,
  TradePartyQueryDto,
  TradeQueryDto,
} from './dto/trade.dto';
import { Decimal } from '@prisma/client/runtime/library';
import { WeightUtil } from '../common/utils/weight.util';

@Injectable()
export class TradeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly skuService: StockSkuService,
  ) {}

  // ════════════════════════════════════════════════════════════════════════════
  //  TRADE PARTY
  // ════════════════════════════════════════════════════════════════════════════

  async createTradeParty(dto: CreateTradePartyDto) {
    return this.prisma.supplier.create({ data: { ...dto, supplierType: 'TRADE' } });
  }

  async listTradeParties(query: TradePartyQueryDto) {
    const { search, isActive, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (isActive !== undefined) where.isActive = isActive;

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
      ];
    }

    // Only list TRADE-type suppliers (trade parties)
    where.supplierType = 'TRADE';

    const [items, total] = await this.prisma.$transaction([
      this.prisma.supplier.findMany({
        where,
        orderBy: { name: 'asc' },
        skip,
        take: limit,
        include: {
          _count: { select: { trades: true } },
        },
      }),
      this.prisma.supplier.count({ where }),
    ]);

    return {
      data: items,
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    };
  }

  async getTradeParty(id: string) {
    const party = await this.prisma.supplier.findUnique({
      where: { id },
      include: {
        trades: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: { _count: { select: { tradeItems: true } } },
        },
        _count: { select: { trades: true } },
      },
    });

    if (!party) throw new NotFoundException(`TradeParty ${id} not found`);
    return party;
  }

  async updateTradeParty(id: string, dto: UpdateTradePartyDto) {
    await this.findTradePartyOrThrow(id);
    return this.prisma.supplier.update({ where: { id }, data: dto });
  }

  async deactivateTradeParty(id: string) {
    await this.findTradePartyOrThrow(id);

    const hasPending = await this.prisma.trade.count({
      where: { supplierId: id, status: 'PENDING' },
    });

    if (hasPending > 0) {
      throw new ConflictException(
        'Cannot deactivate a trade party with pending trades. Complete or cancel them first.',
      );
    }

    return this.prisma.supplier.update({
      where: { id },
      data: { isActive: false },
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  TRADE
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Creates a Trade + TradeItems + StockItems atomically.
   *
   * Business rules:
   *  - TradeParty must be active
   *  - givenWeight must be > 0
   *  - At least one TradeItem required
   *  - Each TradeItem spawns one StockItem (origin=TRADE)
   *  - rateAtTrade (per gram) is snapshotted at creation; never updated
   *  - All three weight units stored for flexible bill display
   */
  async createTrade(createdByUserId: string, dto: CreateTradeDto) {
    const {
      tradePartyId: supplierId,
      givenWeight,   // WeightValue — already converted by WeightUtil in DTO
      givenMetalTypeId,
      rateAtTradePerGram,
      cashAdjustment,
      notes,
      tradeItems,
    } = dto;

    // ── Convert input weights to WeightValue (gram master) ──────────────────
  // WeightInputDto has { value, unit } — WeightUtil.from() gives { gram, tola, lal }
  const givenW = WeightUtil.from(givenWeight.value, givenWeight.unit);

  const convertedItems = tradeItems.map((item) => ({
    ...item,
    grossW: WeightUtil.from(item.grossWeight.value, item.grossWeight.unit),
  }));

    // ── Validate supplier (trade party) ──────────────────────────────────
    const party = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
    });
    if (!party) throw new NotFoundException(`TradeParty ${supplierId} not found`);
    if (!party.isActive) throw new BadRequestException('TradeParty is inactive');
    if (party.supplierType !== 'TRADE') {
      throw new BadRequestException('Trades can only be created for TRADE suppliers');
    }

    // ── Validate rate ────────────────────────────────────────────────────
    try {
      const rateDec = new Decimal(rateAtTradePerGram);
      if (rateDec.lte(0)) {
        throw new BadRequestException('Rate must be positive');
      }
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      throw new BadRequestException('Invalid rate format');
    }

    // ── Validate metal type ───────────────────────────────────────────────
    const metalType = await this.prisma.metalType.findUnique({
      where: { id: givenMetalTypeId },
    });
    if (!metalType || !metalType.isActive) {
      throw new NotFoundException(`MetalType ${givenMetalTypeId} not found or inactive`);
    }

    // ── Validate trade items ──────────────────────────────────────────────
    if (!convertedItems || convertedItems.length === 0) {
      throw new BadRequestException('At least one trade item is required');
    }

    for (const item of convertedItems) {
      if (!item.grossW || item.grossW.gram <= 0) {
        throw new BadRequestException(
          `TradeItem "${item.description}" has invalid weight`,
        );
      }
    }

    // ── Atomic transaction: Trade + TradeItems + StockItems ───────────────
    return this.prisma.$transaction(async (tx) => {
      // 1. Create the Trade — store all three weight units
      const trade = await tx.trade.create({
        data: {
          supplierId,
          createdByUserId,
          givenWeightGram: givenW.gram,   // master — used in calculations
          givenWeightTola: givenW.tola,   // derived — for bill display
          givenWeightLal:  givenW.lal,    // derived — for bill display
          givenMetalTypeId,
          rateAtTradePerGram: new Decimal(rateAtTradePerGram), // rate per gram
          cashAdjustment: cashAdjustment
            ? new Decimal(cashAdjustment)
            : new Decimal(0),
          notes,
          status: 'PENDING',
        },
      });

      // 2. For each trade item: create TradeItem → StockItem
      for (const item of convertedItems) {
        const sku = await this.skuService.generateSku('TRADE', tx);

        const tradeItem = await tx.tradeItem.create({
          data: {
            tradeId: trade.id,
            description: item.description,
            grossWeightGram: item.grossW.gram,
            grossWeightTola: item.grossW.tola,
            grossWeightLal:  item.grossW.lal,
          },
        });

        // StockItem back-references the TradeItem
        await tx.stockItem.create({
          data: {
            sku,
            origin: 'TRADE',
            categoryId:
              item.categoryId ?? (await this.getDefaultCategoryId(tx)),
            metalTypeId:     givenMetalTypeId,
            grossWeightGram: item.grossW.gram,
            grossWeightTola: item.grossW.tola,
            grossWeightLal:  item.grossW.lal,
            status: 'IN_STOCK',
            tradeItemId: tradeItem.id,
          },
        });
      }

      // 3. Return full trade with relations + formatted weights for response
      const result = await tx.trade.findUnique({
        where: { id: trade.id },
        include: {
          supplier: true,
          createdBy: { select: { id: true, name: true } },
          givenMetal: true,
          tradeItems: { include: { stockItem: true } },
        },
      });

      // 4. Attach bill-ready weight display to response
      return this.formatTradeResponse(result);
    });
  }

  async listTrades(query: TradeQueryDto) {
    const { tradePartyId, status, from, to, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (tradePartyId) where.supplierId = tradePartyId;
    if (status) where.status = status;

    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.trade.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          supplier:  { select: { id: true, name: true } },
          givenMetal: { select: { id: true, name: true } },
          createdBy:  { select: { id: true, name: true } },
          _count: { select: { tradeItems: true } },
        },
      }),
      this.prisma.trade.count({ where }),
    ]);

    return {
      data: items.map((t) => this.formatTradeResponse(t)),
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    };
  }

  async getTrade(id: string) {
    const trade = await this.prisma.trade.findUnique({
      where: { id },
      include: {
        supplier: true,
        createdBy: { select: { id: true, name: true } },
        givenMetal: true,
        tradeItems: { include: { stockItem: true } },
      },
    });

    if (!trade) throw new NotFoundException(`Trade ${id} not found`);
    return this.formatTradeResponse(trade);
  }

  /**
   * Update trade status — only PENDING → COMPLETED or PENDING → CANCELLED.
   * On CANCELLED: marks all linked IN_STOCK items as SCRAPPED.
   */
  async updateTradeStatus(id: string, dto: UpdateTradeStatusDto) {
    const trade = await this.prisma.trade.findUnique({
      where: { id },
      include: { tradeItems: { include: { stockItem: true } } },
    });

    if (!trade) throw new NotFoundException(`Trade ${id} not found`);
    if (trade.status !== 'PENDING') {
      throw new ConflictException(
        `Trade is already ${trade.status}. Status can only be changed from PENDING.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      if (dto.status === 'CANCELLED') {
        const stockItemIds = trade.tradeItems
          .filter((ti) => ti.stockItem?.status === 'IN_STOCK')
          .map((ti) => ti.stockItem!.id);

        if (stockItemIds.length > 0) {
          await tx.stockItem.updateMany({
            where: { id: { in: stockItemIds } },
            data: { status: 'SCRAPPED' },
          });
        }
      }

      const updated = await tx.trade.update({
        where: { id },
        data: {
          status: dto.status,
          ...(dto.notes ? { notes: dto.notes } : {}),
        },
        include: {
          supplier: true,
          tradeItems: { include: { stockItem: true } },
        },
      });

      return this.formatTradeResponse(updated);
    });
  }

  /**
   * Lifetime summary for a trade party.
   * Totals in all three weight units for flexible display.
   */
  async getTradePartySummary(tradePartyId: string) {
    await this.findTradePartyOrThrow(tradePartyId);

    const trades = await this.prisma.trade.findMany({
      where: { supplierId: tradePartyId },
      select: {
        status: true,
        givenWeightGram: true,
        cashAdjustment: true,
        _count: { select: { tradeItems: true } },
      },
    });

    let totalGram = 0;
    let totalCash = new Decimal(0);
    const byStatus: Record<string, number> = { PENDING: 0, COMPLETED: 0, CANCELLED: 0 };
    let totalItemsReceived = 0;

    for (const t of trades as any[]) {
      totalGram += Number(t.givenWeightGram);
      totalCash = totalCash.plus(t.cashAdjustment);
      byStatus[t.status]++;
      totalItemsReceived += t._count.tradeItems;
    }

    return {
      totalTrades: trades.length,
      totalGivenWeight: WeightUtil.forBill(totalGram),  // all three units
      totalCashAdjustmentNpr: totalCash.toFixed(2),
      byStatus,
      totalItemsReceived,
    };
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  HELPERS
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Attaches bill-ready weight display to any trade object.
   * Keeps raw DB fields intact and adds a `weight` display object.
   */
  private formatTradeResponse(trade: any) {
    if (!trade) return trade;

    return {
      ...trade,
      // Bill-ready weight for the given metal
      givenWeight: WeightUtil.forBill(Number(trade.givenWeightGram)),

      // Bill-ready weight for each trade item
      tradeItems: trade.tradeItems?.map((item: any) => ({
        ...item,
        grossWeight: WeightUtil.forBill(Number(item.grossWeightGram)),
      })),
    };
  }

  private async findTradePartyOrThrow(id: string) {
    const party = await this.prisma.supplier.findUnique({ where: { id } });
    if (!party) throw new NotFoundException(`TradeParty ${id} not found`);
    return party;
  }

  private async getDefaultCategoryId(tx: any): Promise<string> {
  const cat = await tx.itemCategory.upsert({
    where:  { name: 'Uncategorised' },
    update: {},                          // already exists — do nothing
    create: { name: 'Uncategorised' },  // doesn't exist — create it
  });
  return cat.id;
}
}