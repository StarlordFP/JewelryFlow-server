import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StockSkuService } from './stock-sku.service';
import { WeightUtil } from '../common/utils/weight.util';
import { isGoldMetal } from '../common/utils/metal.util';
import { Decimal } from '@prisma/client/runtime/library';
import {
  CreateStockItemDto,
  UpdateStockItemDto,
  UpdateStockStatusDto,
  PricePreviewDto,
  StockQueryDto,
  JyalaBreakdownDto,
  UpdateCategoryDto,
  BulkCreateStockDto,
} from './dto/stock.dto';
import { deriveCategoryShortCode } from './sku-suffix.util';

// ─── PRICING RESULT ───────────────────────────────────────────────────────────

export interface PricingResult {
  // ── Inputs ──────────────────────────────────────────────────────────────
  grossWeight:    ReturnType<typeof WeightUtil.forBill>;
  jertyWeight:    ReturnType<typeof WeightUtil.forBill>;
  billableWeight: ReturnType<typeof WeightUtil.forBill>; // gross + jerty
  ratePerGram:    string;

  // ── Calculation steps (numbers) ──────────────────────────────────────────
  metalValueNpr:  number; // billableWeight.gram × ratePerGram
  totalPriceNpr:  number; // metal + jyala + taxes + addons
  grandTotalNpr:  number; // same as totalPriceNpr for backwards compatibility
  luxuryTaxNpr:   number; // 2% of metalValue (gold only, if toggled)
  vatNpr:         number; // 13% of jyala (if toggled)
  addonValueNpr:  number;

  // ── Calculation steps (strings, for display) ─────────────────────────────
  metalValueNprStr:  string;
  totalPriceNprStr:  string;
  grandTotalNprStr:  string;
  luxuryTaxNprStr:   string;
  vatNprStr:         string;
  addonValueNprStr:  string;

  // ── Jyala (owner sees breakdown, customer sees only total) ────────────────
  jyalaOwnerView: {
    makingCharge: string;
    stoneCharge:  string;
    motiCharge:   string;
    malaCharge:   string;
    otherCharge:  string;
    total:        string;
  };
  jyalaCustomerView: string; // same as jyalaOwnerView.total

  // ── Bill views ────────────────────────────────────────────────────────────
  ownerBill:    OwnerBillView;
  customerBill: CustomerBillView;
}

interface OwnerBillView {
  metalValue:    string;
  jyalaBreakdown: {
    makingCharge: string;
    stoneCharge:  string;
    motiCharge:   string;
    malaCharge:   string;
    otherCharge:  string;
  };
  jyalaTotal:    string;
  luxuryTax:     string | null;
  vat:           string | null;
  addonValue:    string;
  grandTotal:    string;
}

interface CustomerBillView {
  metalValue: string;
  jyala:      string; // single line — no breakdown
  luxuryTax:  string | null;
  vat:        string | null;
  grandTotal: string;
}

@Injectable()
export class StockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly skuService: StockSkuService,
  ) {}

  // ════════════════════════════════════════════════════════════════════════════
  //  CREATE
  // ════════════════════════════════════════════════════════════════════════════

  async createStockItem(dto: CreateStockItemDto) {
    // ── Convert weights ──────────────────────────────────────────────────────
    const grossW = WeightUtil.from(dto.grossWeight.value, dto.grossWeight.unit);
    const jertyW = dto.jertyWeight
      ? WeightUtil.from(dto.jertyWeight.value, dto.jertyWeight.unit)
      : WeightUtil.fromGram(0);

    // ── Validate category ────────────────────────────────────────────────────
    const category = await this.prisma.itemCategory.findUnique({
      where: { id: dto.categoryId },
    });
    if (!category || !category.isActive) {
      throw new NotFoundException(`Category ${dto.categoryId} not found or inactive`);
    }

    // ── Validate metal type ──────────────────────────────────────────────────
    const metalTypeId = dto.metalTypeId?.trim() ? dto.metalTypeId.trim() : null;
    let resolvedMetal = null;
    if (metalTypeId) {
      resolvedMetal = await this.prisma.metalType.findUnique({
        where: { id: metalTypeId },
      });
      if (!resolvedMetal || !resolvedMetal.isActive) {
        throw new NotFoundException(`MetalType ${metalTypeId} not found or inactive`);
      }
    }

    // ── Validate origin-specific references ──────────────────────────────────
    if (dto.origin.type === 'TRADE') {
      if (!dto.origin.tradeItemId) {
        throw new BadRequestException('tradeItemId is required when origin.type=TRADE');
      }
      const tradeItem = await this.prisma.tradeItem.findUnique({
        where: { id: dto.origin.tradeItemId },
      });
      if (!tradeItem) {
        throw new NotFoundException(`TradeItem ${dto.origin.tradeItemId} not found`);
      }
      if (dto.origin.productionItemId) {
        throw new BadRequestException('productionItemId may only be set when origin.type=KARIGAR');
      }
    } else if (dto.origin.type === 'KARIGAR') {
      if (!dto.origin.productionItemId) {
        throw new BadRequestException('productionItemId is required when origin.type=KARIGAR');
      }
      const productionItem = await this.prisma.productionItem.findUnique({
        where: { id: dto.origin.productionItemId },
      });
      if (!productionItem) {
        throw new NotFoundException(`ProductionItem ${dto.origin.productionItemId} not found`);
      }
      if (dto.origin.tradeItemId) {
        throw new BadRequestException('tradeItemId may only be set when origin.type=TRADE');
      }
    } else if (dto.origin.type === 'DIRECT' || dto.origin.type === 'PURCHASED' || dto.origin.type === 'REMAKE') {
      if (dto.origin.tradeItemId || dto.origin.productionItemId) {
        throw new BadRequestException('tradeItemId or productionItemId may only be set when origin.type is TRADE or KARIGAR');
      }
      if (dto.origin.type === 'DIRECT' && !metalTypeId) {
        throw new BadRequestException('metalTypeId is required when origin.type=DIRECT');
      }
    }

    // ── Suggest jerty from bracket if not manually provided ──────────────────
    let suggestedJertyGram = 0;
    if (!dto.jertyWeight) {
      const bracket = await this.prisma.jertyBracket.findFirst({
        where: {
          categoryId:    dto.categoryId,
          minWeightGram: { lte: grossW.gram },
          maxWeightGram: { gte: grossW.gram },
          isActive:      true,
        },
      });
      suggestedJertyGram = bracket ? Number(bracket.jertyGram) : 0;
    }

    const finalJertyW = dto.jertyWeight
      ? jertyW
      : WeightUtil.fromGram(suggestedJertyGram);

    // ── Calculate jyala total ────────────────────────────────────────────────
    const jyala   = this.sumJyala(dto.jyalaBreakdown);
    const totalJyalaNpr = jyala.total;

    // ── Create stock item + SKU in one transaction ─────────────────────────
    const stockItem = await this.prisma.$transaction(async (tx) => {
      let sku: string;
      if (dto.origin.type === 'DIRECT') {
        sku = await this.skuService.generateCategoryKaratSku(
          dto.categoryId,
          metalTypeId!,
          tx,
        );
      } else {
        sku = await this.skuService.generateSku(
          dto.origin.type as 'TRADE' | 'KARIGAR' | 'PURCHASED' | 'REMAKE',
          tx,
        );
      }

      let entryRateId: string | null = null;
      if (metalTypeId) {
        const entryRate = await tx.dailyRate.findFirst({
          where:   { metalTypeId, isCurrent: true },
          orderBy: { effectiveDate: 'desc' },
        });
        entryRateId = entryRate?.id ?? null;
      }

      return tx.stockItem.create({
        data: {
          sku,
          name:            dto.name?.trim() || null,
          origin:          dto.origin.type,
          categoryId:      dto.categoryId,
          metalTypeId,
          karat:           isGoldMetal(resolvedMetal) ? dto.karat ?? null : null,
          entryRateId,
          tradeItemId:     dto.origin.tradeItemId,
          productionItemId: dto.origin.productionItemId,

          grossWeightGram: grossW.gram,
          grossWeightTola: grossW.tola,
          grossWeightLal:  grossW.lal,

          jertyGram:       finalJertyW.gram,
          jertyTola:       finalJertyW.tola,
          jertyLal:        finalJertyW.lal,

          makingChargeNpr: jyala.making,
          stoneChargeNpr:  jyala.stone,
          motiChargeNpr:   jyala.moti,
          malaChargeNpr:   jyala.mala,
          otherChargeNpr:  jyala.other,
          totalJyalaNpr,

          applyLuxuryTax:  dto.applyLuxuryTax ?? false,
          applyVat:        dto.applyVat ?? false,

          photoUrl:        dto.photoUrl,
          notes:           dto.notes,
          status:          'IN_STOCK',

          addons: dto.addons?.length
            ? {
                create: dto.addons.map((a) => ({
                  addonTypeId:  a.addonTypeId,
                  quantity:     a.quantity,
                  valuationNpr: a.valuationNpr,
                  notes:        a.notes,
                })),
              }
            : undefined,
        },
        include: {
          category:  true,
          metalType: true,
          addons:    { include: { addonType: true } },
          tradeItem: true,
        },
      });
    });

    return await this.formatStockResponse(stockItem);
  }

  async bulkCreateStock(dto: BulkCreateStockDto) {
    if (dto.items.length < 1 || dto.items.length > 100) {
      throw new BadRequestException('items must contain between 1 and 100 entries');
    }

    const category = await this.prisma.itemCategory.findUnique({
      where: { id: dto.categoryId },
    });
    if (!category || !category.isActive) {
      throw new NotFoundException(`Category ${dto.categoryId} not found or inactive`);
    }

    const metalType = await this.prisma.metalType.findUnique({
      where: { id: dto.metalTypeId },
    });
    if (!metalType || !metalType.isActive) {
      throw new NotFoundException(`MetalType ${dto.metalTypeId} not found or inactive`);
    }

    const isGold = isGoldMetal(metalType);

    const created = await this.prisma.$transaction(async (tx) => {
      const entryRate = await tx.dailyRate.findFirst({
        where:   { metalTypeId: dto.metalTypeId, isCurrent: true },
        orderBy: { effectiveDate: 'desc' },
      });
      const entryRateId = entryRate?.id ?? null;

      const rows = [];
      for (const item of dto.items) {
        const grossW = WeightUtil.from(item.grossWeight.value, item.grossWeight.unit);
        const sku = await this.skuService.generateCategoryKaratSku(
          dto.categoryId,
          dto.metalTypeId,
          tx,
        );

        const row = await tx.stockItem.create({
          data: {
            sku,
            name:            item.name?.trim() || null,
            origin:          'DIRECT',
            categoryId:      dto.categoryId,
            metalTypeId:     dto.metalTypeId,
            karat:           isGold ? item.karat ?? null : null,
            entryRateId,
            grossWeightGram: grossW.gram,
            grossWeightTola: grossW.tola,
            grossWeightLal:  grossW.lal,
            status:          'IN_STOCK',
            notes:           item.notes,
          },
          include: {
            category:  true,
            metalType: true,
          },
        });
        rows.push(row);
      }
      return rows;
    });

    return {
      items: await Promise.all(created.map((row) => this.formatStockResponse(row))),
    };
  }

  previewSku(categoryId: string, metalTypeId: string) {
    return this.skuService.previewCategoryKaratSku(categoryId, metalTypeId);
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  READ
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * List trade items or production items that are not yet linked to stock.
   * Used by the stock form when origin=TRADE or origin=KARIGAR.
   */
  async getOriginLinkOptions(type: 'KARIGAR' | 'TRADE') {
    if (type === 'TRADE') {
      const items = await this.prisma.tradeItem.findMany({
        where:   { stockItem: null },
        include: {
          trade: { include: { supplier: { select: { id: true, name: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        take:    100,
      });

      return items.map((item) => ({
        id:             item.id,
        label:          `${item.description} — ${item.trade.supplier.name} (${Number(item.grossWeightGram).toFixed(2)} g)`,
        tradePartyId:   item.trade.supplier.id,
        tradePartyName: item.trade.supplier.name,
        tradeId:        item.tradeId,
      }));
    }

    const items = await this.prisma.productionItem.findMany({
      where:   { stockItem: null },
      include: {
        productionReturn: {
          include: {
            productionOrder: { include: { karigar: { select: { id: true, name: true } } } },
          },
        },
      },
      orderBy: { id: 'desc' },
      take:    100,
    });

    return items.map((item) => ({
      id:                item.id,
      label:             `${item.description} — ${item.productionReturn.productionOrder.karigar.name} (${Number(item.grossWeightGram).toFixed(2)} g)`,
      karigarId:         item.productionReturn.productionOrder.karigar.id,
      karigarName:       item.productionReturn.productionOrder.karigar.name,
      productionOrderId: item.productionReturn.productionOrderId,
    }));
  }

  async listStockItems(query: StockQueryDto) {
    const {
      categoryId, metalTypeId, origin, status,
      minWeightGram, maxWeightGram,
      from, to, search,
      page = 1, limit = 20,
    } = query;

    const skip  = (page - 1) * limit;
    const where: any = {};

    if (categoryId)  where.categoryId  = categoryId;
    if (metalTypeId) where.metalTypeId = metalTypeId;
    if (origin)      where.origin      = origin;
    if (status)      where.status      = status;

    if (minWeightGram !== undefined || maxWeightGram !== undefined) {
      where.grossWeightGram = {};
      if (minWeightGram !== undefined) where.grossWeightGram.gte = minWeightGram;
      if (maxWeightGram !== undefined) where.grossWeightGram.lte = maxWeightGram;
    }

    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to)   where.createdAt.lte = new Date(to);
    }

    if (search) {
      where.OR = [
        { sku:   { contains: search, mode: 'insensitive' } },
        { name:  { contains: search, mode: 'insensitive' } },
        { notes: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.stockItem.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take:    limit,
        include: {
          category:  { select: { id: true, name: true } },
          metalType: { select: { id: true, name: true } },
          addons:    { include: { addonType: true } },
          entryRate: { select: { id: true, sellRatePerGram: true, effectiveDate: true } },
          purchaseOrderLine: { select: { rateAtPurchasePerGram: true, purchaseOrderId: true } },
        },
      }),
      this.prisma.stockItem.count({ where }),
    ]);

    const formattedItems = await Promise.all(items.map((i) => this.formatStockResponse(i)));

    return {
      data: formattedItems,
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    };
  }

  async getStockItem(id: string) {
    const item = await this.prisma.stockItem.findUnique({
      where: { id },
      include: {
        category:  true,
        metalType: true,
        addons:    { include: { addonType: true } },
        entryRate: { select: { id: true, sellRatePerGram: true, effectiveDate: true } },
        purchaseOrderLine: { select: { rateAtPurchasePerGram: true, purchaseOrderId: true } },
        tradeItem: { include: { trade: { include: { supplier: true } } } },
        // Remake traceability: which production issue consumed this item as input
        productionIssueSourceItems: {
          include: {
            productionIssue: {
              include: {
                productionOrder: {
                  include: { karigar: { select: { id: true, name: true } } },
                },
              },
            },
          },
        },
        // If remade: which new stock item it was turned into (best-effort pointer)
        remadeIntoStockItem: {
          select: { id: true, sku: true, name: true },
        },
      },
    });

    if (!item) throw new NotFoundException(`StockItem ${id} not found`);
    return await this.formatStockResponse(item);
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  UPDATE
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Update jerty, jyala, tax toggles, notes, photo.
   * Jerty and jyala are mutable — shopkeeper can adjust at any time
   * including at bill creation time.
   */
  async updateStockItem(id: string, dto: UpdateStockItemDto) {
    const existing = await this.findOrThrow(id);

    if (existing.status === 'SOLD' || existing.status === 'SCRAPPED') {
      throw new ConflictException(
        `Cannot edit a stock item with status ${existing.status}`,
      );
    }

    const data: any = {};

    // ── Update gross weight ──────────────────────────────────────────────────
    if (dto.grossWeight) {
      const grossW            = WeightUtil.from(dto.grossWeight.value, dto.grossWeight.unit);
      data.grossWeightGram    = grossW.gram;
      data.grossWeightTola    = grossW.tola;
      data.grossWeightLal     = grossW.lal;
    }

    // ── Update jerty ─────────────────────────────────────────────────────────
    if (dto.jertyWeight) {
      const jertyW        = WeightUtil.from(dto.jertyWeight.value, dto.jertyWeight.unit);
      data.jertyGram      = jertyW.gram;
      data.jertyTola      = jertyW.tola;
      data.jertyLal       = jertyW.lal;
    }

    // ── Update category ──────────────────────────────────────────────────────
    if (dto.categoryId !== undefined) {
      const category = await this.prisma.itemCategory.findUnique({
        where: { id: dto.categoryId },
      });
      if (!category || !category.isActive) {
        throw new NotFoundException(`Category ${dto.categoryId} not found or inactive`);
      }
      data.categoryId = dto.categoryId;
    }

    // ── Update metal type ────────────────────────────────────────────────────
    if (dto.metalTypeId !== undefined) {
      const metalTypeId = dto.metalTypeId?.trim() ? dto.metalTypeId.trim() : null;
      if (metalTypeId) {
        const metal = await this.prisma.metalType.findUnique({
          where: { id: metalTypeId },
        });
        if (!metal || !metal.isActive) {
          throw new NotFoundException(`MetalType ${metalTypeId} not found or inactive`);
        }
        data.metalTypeId = metalTypeId;
      } else {
        data.metalTypeId = null;
      }
    }

    if (dto.karat !== undefined) data.karat = dto.karat;

    // Non-gold metals (e.g. Silver) never carry a karat value
    const effectiveMetalId =
      data.metalTypeId !== undefined ? data.metalTypeId : existing.metalTypeId;
    if (effectiveMetalId) {
      const metal = await this.prisma.metalType.findUnique({
        where: { id: effectiveMetalId },
      });
      if (!isGoldMetal(metal)) {
        data.karat = null;
      }
    } else if (data.metalTypeId === null) {
      data.karat = null;
    }

    // ── Update jyala breakdown ────────────────────────────────────────────────
    if (dto.jyalaBreakdown) {
      const jyala           = this.sumJyala(dto.jyalaBreakdown);
      data.makingChargeNpr  = jyala.making;
      data.stoneChargeNpr   = jyala.stone;
      data.motiChargeNpr    = jyala.moti;
      data.malaChargeNpr    = jyala.mala;
      data.otherChargeNpr   = jyala.other;
      data.totalJyalaNpr    = jyala.total;
    }

    if (dto.name          !== undefined) data.name          = dto.name;
    if (dto.applyLuxuryTax !== undefined) data.applyLuxuryTax = dto.applyLuxuryTax;
    if (dto.applyVat       !== undefined) data.applyVat       = dto.applyVat;
    if (dto.notes          !== undefined) data.notes          = dto.notes;
    if (dto.photoUrl       !== undefined) data.photoUrl       = dto.photoUrl;

    const updated = await this.prisma.stockItem.update({
      where:   { id },
      data,
      include: {
        category:  true,
        metalType: true,
        addons:    { include: { addonType: true } },
      },
    });

    return await this.formatStockResponse(updated);
  }

  async updateStockStatus(id: string, dto: UpdateStockStatusDto) {
    const existing = await this.findOrThrow(id);

    // SOLD and RETURNED can only be set by the sales/transaction module
    if (existing.status === 'SOLD') {
      throw new ConflictException('Status of a SOLD item can only be changed via a return transaction');
    }

    const updated = await this.prisma.stockItem.update({
      where: { id },
      data:  {
        status: dto.status,
        ...(dto.notes ? { notes: dto.notes } : {}),
      },
    });

    return await this.formatStockResponse(updated);
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  PRICE PREVIEW
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Calculate the full price for a stock item using today's rate.
   * Jerty and jyala can be overridden here (bill-time override).
   *
   * Formula:
   *   metalValue  = (grossWeight + jertyWeight) × ratePerGram
   *   luxuryTax   = 2% of metalValue (if gold + toggled)
   *   vat         = 13% of jyala (if toggled)
   *   addonValue  = sum of all addon valuations
   *   grandTotal  = metalValue + jyala + luxuryTax + vat + addonValue
   */
  async getPricePreview(dto: PricePreviewDto): Promise<PricingResult> {
    const item = await this.prisma.stockItem.findUnique({
      where:   { id: dto.stockItemId },
      include: {
        metalType: true,
        addons:    true,
      },
    });

    if (!item) throw new NotFoundException(`StockItem ${dto.stockItemId} not found`);
    if (item.status === 'SOLD') {
      throw new BadRequestException('Item is already sold');
    }

    // ── Get today's rate ──────────────────────────────────────────────────────
    const dailyRate = await this.resolveRate(dto.dailyRateId, item.metalTypeId!);
    return this.calculatePrice(item, dailyRate, dto);
  }

  /**
   * Standalone price preview — calculates pricing without a saved stock item.
   * Used by frontend to show price BEFORE the shopkeeper adds the item to stock.
   */
  async getStandalonePricePreview(dto: any): Promise<PricingResult> {
    // ── Resolve metal type ────────────────────────────────────────────────────
    const metalType = dto.metalTypeId
      ? await this.prisma.metalType.findUnique({ where: { id: dto.metalTypeId } })
      : null;

    // ── Build a virtual item matching the shape calculatePrice expects ────────
    const grossW = WeightUtil.from(dto.grossWeight.value, dto.grossWeight.unit);
    const jertyW = dto.jertyWeight
      ? WeightUtil.from(dto.jertyWeight.value, dto.jertyWeight.unit)
      : WeightUtil.fromGram(0);
    const jyala = this.sumJyala(dto.jyalaBreakdown);

    const virtualItem = {
      grossWeightGram: grossW.gram,
      jertyGram:       jertyW.gram,
      makingChargeNpr: jyala.making,
      stoneChargeNpr:  jyala.stone,
      motiChargeNpr:   jyala.moti,
      malaChargeNpr:   jyala.mala,
      otherChargeNpr:  jyala.other,
      totalJyalaNpr:   jyala.total,
      applyLuxuryTax:  dto.applyLuxuryTax ?? false,
      applyVat:        dto.applyVat ?? false,
      metalType,
      addons:          [],
    };

    // ── Get today's rate ──────────────────────────────────────────────────────
    const dailyRate = await this.resolveRate(dto.dailyRateId, dto.metalTypeId);
    return this.calculatePrice(virtualItem, dailyRate, dto);
  }

  /** Resolve daily rate by ID or find current rate for the metal type */
  private async resolveRate(dailyRateId?: string, metalTypeId?: string) {
    if (dailyRateId) {
      const rate = await this.prisma.dailyRate.findUnique({
        where: { id: dailyRateId },
      });
      if (!rate) throw new NotFoundException(`DailyRate ${dailyRateId} not found`);
      return rate;
    }

    const rate = await this.prisma.dailyRate.findFirst({
      where:   { metalTypeId: metalTypeId!, isCurrent: true },
      orderBy: { effectiveDate: 'desc' },
    });
    if (!rate) {
      throw new BadRequestException(
        `No current daily rate found for this metal type. Please set today's rate first.`,
      );
    }
    return rate;
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  PRICING ENGINE
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Core pricing calculation.
   * Called by getPricePreview and will be called by the sales module
   * when creating a bill.
   */
  async calculatePrice(
    item: any,
    dailyRate: any,
    overrides?: Partial<PricePreviewDto>,
    tx?: any,                              // accepts prisma tx client for use inside transactions
  ): Promise<PricingResult> {
    const client = tx ?? this.prisma;
    const ratePerGram = new Decimal(dailyRate.ratePerGram ?? dailyRate.sellRatePerGram);

    // ── Weights ─────────────────────────────────────────────────────────────
    const grossGram = new Decimal(item.grossWeightGram ?? 0);

    const resolvedJertyGram = (overrides?.jertyOverride != null)
      ? WeightUtil.from(overrides.jertyOverride.value, overrides.jertyOverride.unit).gram
      : Number(item.jertyGram ?? 0);
    const jertyGram = new Decimal(resolvedJertyGram);

    const billableGram = grossGram.plus(jertyGram);

    // ── Metal value ──────────────────────────────────────────────────────────
    const metalValueNpr = billableGram.mul(ratePerGram);

    // ── Jyala ────────────────────────────────────────────────────────────────
    let finalJyala: Decimal;
    let jyalaBreakdown = {
      makingCharge: Number(item.makingChargeNpr ?? 0),
      stoneCharge: Number(item.stoneChargeNpr ?? 0),
      motiCharge: Number(item.motiChargeNpr ?? 0),
      malaCharge: Number(item.malaChargeNpr ?? 0),
      otherCharge: Number(item.otherChargeNpr ?? 0),
    };

    if (overrides?.jyalaBreakdown) {
      // Use jyalaBreakdown override
      jyalaBreakdown = {
        makingCharge: overrides.jyalaBreakdown.makingChargeNpr ?? jyalaBreakdown.makingCharge,
        stoneCharge: overrides.jyalaBreakdown.stoneChargeNpr ?? jyalaBreakdown.stoneCharge,
        motiCharge: overrides.jyalaBreakdown.motiChargeNpr ?? jyalaBreakdown.motiCharge,
        malaCharge: overrides.jyalaBreakdown.malaChargeNpr ?? jyalaBreakdown.malaCharge,
        otherCharge: overrides.jyalaBreakdown.otherChargeNpr ?? jyalaBreakdown.otherCharge,
      };
      finalJyala = new Decimal(
        jyalaBreakdown.makingCharge +
        jyalaBreakdown.stoneCharge +
        jyalaBreakdown.motiCharge +
        jyalaBreakdown.malaCharge +
        jyalaBreakdown.otherCharge
      );
    } else if (overrides?.jyalaOverride != null) {
      // Use jyalaOverride if provided
      finalJyala = new Decimal(overrides.jyalaOverride);
    } else {
      // Use stored values
      finalJyala = new Decimal(Number(item.totalJyalaNpr ?? 0));
    }

    // ── Tax overrides ────────────────────────────────────────────────────────
    const resolvedApplyLuxuryTax = overrides?.applyLuxuryTax ?? item.applyLuxuryTax;
    const resolvedApplyVat = overrides?.applyVat ?? item.applyVat;

    // ── Luxury tax — read active rule from DB, not hardcoded ─────────────────
    let luxuryTaxNpr = new Decimal(0);
    if (resolvedApplyLuxuryTax) {
      if (isGoldMetal(item.metalType)) {
        const luxuryRule = await client.luxuryTaxRule.findFirst({
          where:   { isActive: true, appliesTo: 'GOLD' },
          orderBy: { effectiveDate: 'desc' },   // most recent active rule wins
        });
        if (luxuryRule) {
          luxuryTaxNpr = metalValueNpr.mul(new Decimal(luxuryRule.rate));
        }
      }
    }

    // ── VAT — read active rule from DB ───────────────────────────────────────
    let vatNpr = new Decimal(0);
    if (resolvedApplyVat) {
      const vatRule = await client.vatRule.findFirst({
        where:   { isActive: true, appliesTo: 'JYALA' },
        orderBy: { effectiveDate: 'desc' },
      });
      if (vatRule) {
        vatNpr = finalJyala.mul(new Decimal(vatRule.rate));
      }
    }

    // ── Addons ───────────────────────────────────────────────────────────────
    const resolvedAddonValue = item.addons?.reduce(
      (sum: number, a: any) => sum + Number(a.valuationNpr ?? 0),
      0,
    ) ?? 0;
    const addonValueNpr = new Decimal(resolvedAddonValue);

    // ── Grand total ──────────────────────────────────────────────────────────
    const grandTotalNprDecimal = metalValueNpr.plus(finalJyala).plus(luxuryTaxNpr).plus(vatNpr).plus(addonValueNpr);

    const fmt = (d: Decimal) => d.toFixed(2);

    const result: PricingResult = {
      grossWeight:    WeightUtil.forBill(grossGram.toNumber()),
      jertyWeight:    WeightUtil.forBill(jertyGram.toNumber()),
      billableWeight: WeightUtil.forBill(billableGram.toNumber()),
      ratePerGram:    fmt(ratePerGram),

      // Number fields
      metalValueNpr:  metalValueNpr.toNumber(),
      totalPriceNpr:  grandTotalNprDecimal.toNumber(),
      grandTotalNpr:  grandTotalNprDecimal.toNumber(),
      luxuryTaxNpr:   luxuryTaxNpr.toNumber(),
      vatNpr:         vatNpr.toNumber(),
      addonValueNpr:  addonValueNpr.toNumber(),

      // String fields for display
      metalValueNprStr:  fmt(metalValueNpr),
      totalPriceNprStr:  fmt(grandTotalNprDecimal),
      grandTotalNprStr:  fmt(grandTotalNprDecimal),
      luxuryTaxNprStr:   fmt(luxuryTaxNpr),
      vatNprStr:         fmt(vatNpr),
      addonValueNprStr:  fmt(addonValueNpr),

      jyalaOwnerView: {
        makingCharge: new Decimal(jyalaBreakdown.makingCharge).toFixed(2),
        stoneCharge:  new Decimal(jyalaBreakdown.stoneCharge).toFixed(2),
        motiCharge:   new Decimal(jyalaBreakdown.motiCharge).toFixed(2),
        malaCharge:   new Decimal(jyalaBreakdown.malaCharge).toFixed(2),
        otherCharge:  new Decimal(jyalaBreakdown.otherCharge).toFixed(2),
        total:        fmt(finalJyala),
      },
      jyalaCustomerView: fmt(finalJyala),

      ownerBill: {
        metalValue: fmt(metalValueNpr),
        jyalaBreakdown: {
          makingCharge: new Decimal(jyalaBreakdown.makingCharge).toFixed(2),
          stoneCharge:  new Decimal(jyalaBreakdown.stoneCharge).toFixed(2),
          motiCharge:   new Decimal(jyalaBreakdown.motiCharge).toFixed(2),
          malaCharge:   new Decimal(jyalaBreakdown.malaCharge).toFixed(2),
          otherCharge:  new Decimal(jyalaBreakdown.otherCharge).toFixed(2),
        },
        jyalaTotal:  fmt(finalJyala),
        luxuryTax:   luxuryTaxNpr.greaterThan(0) ? fmt(luxuryTaxNpr) : null,
        vat:         vatNpr.greaterThan(0)       ? fmt(vatNpr)        : null,
        addonValue:  fmt(addonValueNpr),
        grandTotal:  fmt(grandTotalNprDecimal),
      },

      customerBill: {
        metalValue: fmt(metalValueNpr),
        jyala:      fmt(finalJyala),
        luxuryTax:  luxuryTaxNpr.greaterThan(0) ? fmt(luxuryTaxNpr) : null,
        vat:         vatNpr.greaterThan(0)       ? fmt(vatNpr)        : null,
        grandTotal: fmt(grandTotalNprDecimal),
      },
    };

    return result;
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  SUGGESTED JERTY & JYALA (for frontend hints)
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Returns suggested jerty and jyala range for a given category + metal + weight.
   * Frontend can show these as hints when the shopkeeper is adding stock.
   */
  async getSuggestions(categoryId: string, metalTypeId: string, weightGram: number) {
    const [jertyBracket, jyalaRule] = await this.prisma.$transaction([
      this.prisma.jertyBracket.findFirst({
        where: {
          categoryId,
          minWeightGram: { lte: new Decimal(weightGram) },
          maxWeightGram: { gte: new Decimal(weightGram) },
          isActive: true,
        },
      }),
      this.prisma.jyalaRule.findFirst({
        where: { categoryId, metalTypeId, isActive: true },
      }),
    ]);

    const suggestedJertyGram = jertyBracket ? Number(jertyBracket.jertyGram) : 0;

    return {
      suggestedJertyGram,
      suggestedJerty: jertyBracket
        ? WeightUtil.forBill(suggestedJertyGram)
        : null,
      suggestedJyalaRange: jyalaRule
        ? {
            chargeType: jyalaRule.chargeType,
            min:        Number(jyalaRule.minValue).toFixed(2),
            max:        Number(jyalaRule.maxValue).toFixed(2),
          }
        : null,
    };
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  HELPERS
  // ════════════════════════════════════════════════════════════════════════════

  /** Sum jyala breakdown fields, return individual values + total */
  private sumJyala(breakdown?: JyalaBreakdownDto) {
    const making = breakdown?.makingChargeNpr ?? 0;
    const stone  = breakdown?.stoneChargeNpr  ?? 0;
    const moti   = breakdown?.motiChargeNpr   ?? 0;
    const mala   = breakdown?.malaChargeNpr   ?? 0;
    const other  = breakdown?.otherChargeNpr  ?? 0;
    const total  = making + stone + moti + mala + other;

    return { making, stone, moti, mala, other, total };
  }

  /** Same cost-rate logic as the profit report — for API responses and audits. */
  private resolveCostRateInfo(item: {
    id: string;
    origin: string;
    entryRateId?: string | null;
    entryRate?: { id: string; sellRatePerGram: unknown; effectiveDate?: Date } | null;
    purchaseOrderLine?: { rateAtPurchasePerGram: unknown; purchaseOrderId?: string } | null;
  }) {
    const purchaseRate = item.purchaseOrderLine?.rateAtPurchasePerGram;
    const entryRateGram = item.entryRate?.sellRatePerGram;

    if (item.origin === 'PURCHASED' && purchaseRate != null) {
      return {
        hasKnownCost:      true,
        costRatePerGram:   Number(purchaseRate).toFixed(2),
        costRateSource:    'PURCHASE_RATE' as const,
        purchaseRatePerGram: Number(purchaseRate).toFixed(2),
        entryRatePerGram:  entryRateGram != null ? Number(entryRateGram).toFixed(2) : null,
        entryRateId:       item.entryRateId ?? item.entryRate?.id ?? null,
        purchaseOrderId:   item.purchaseOrderLine?.purchaseOrderId ?? null,
      };
    }

    if (entryRateGram != null) {
      return {
        hasKnownCost:      true,
        costRatePerGram:   Number(entryRateGram).toFixed(2),
        costRateSource:    'ENTRY_RATE' as const,
        purchaseRatePerGram: purchaseRate != null ? Number(purchaseRate).toFixed(2) : null,
        entryRatePerGram:  Number(entryRateGram).toFixed(2),
        entryRateId:       item.entryRateId ?? item.entryRate?.id ?? null,
        purchaseOrderId:   item.purchaseOrderLine?.purchaseOrderId ?? null,
      };
    }

    return {
      hasKnownCost:      false,
      costRatePerGram:   null,
      costRateSource:    'UNKNOWN' as const,
      purchaseRatePerGram: purchaseRate != null ? Number(purchaseRate).toFixed(2) : null,
      entryRatePerGram:  null,
      entryRateId:       item.entryRateId ?? null,
      purchaseOrderId:   item.purchaseOrderLine?.purchaseOrderId ?? null,
    };
  }

  /**
   * Audit all stock items — shows whether each has a purchase/entry cost rate
   * (used by profit report). Callable from GET /stock/cost-audit or browser console.
   */
  async getCostRateAudit(query?: { status?: string }) {
    const where: Record<string, unknown> = {};
    if (query?.status) where.status = query.status;

    const items = await this.prisma.stockItem.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        metalType: { select: { id: true, name: true } },
        entryRate: { select: { id: true, sellRatePerGram: true, effectiveDate: true } },
        purchaseOrderLine: { select: { rateAtPurchasePerGram: true, purchaseOrderId: true } },
      },
    });

    const rows = items.map((item) => {
      const cost = this.resolveCostRateInfo(item);
      return {
        id:                item.id,
        sku:               item.sku,
        name:              item.name,
        status:            item.status,
        origin:            item.origin,
        metalType:         item.metalType?.name ?? null,
        ...cost,
      };
    });

    const withCost    = rows.filter((r) => r.hasKnownCost).length;
    const withoutCost = rows.filter((r) => !r.hasKnownCost).length;

    return {
      summary: {
        total:            rows.length,
        withKnownCost:    withCost,
        withoutKnownCost: withoutCost,
        bySource: {
          PURCHASE_RATE: rows.filter((r) => r.costRateSource === 'PURCHASE_RATE').length,
          ENTRY_RATE:    rows.filter((r) => r.costRateSource === 'ENTRY_RATE').length,
          UNKNOWN:       rows.filter((r) => r.costRateSource === 'UNKNOWN').length,
        },
      },
      data: rows,
    };
  }

  /** Format a raw stock item for API response — adds bill-ready weight display */
  private async formatStockResponse(item: any) {
    if (!item) return item;

    // Convert Prisma Decimal fields to plain numbers for JSON serialization
    const grossWeightGram = Number(item.grossWeightGram);
    const grossWeightTola = Number(item.grossWeightTola);
    const grossWeightLal  = Number(item.grossWeightLal);
    const jertyGram       = Number(item.jertyGram);
    const jertyTola       = Number(item.jertyTola);
    const jertyLal        = Number(item.jertyLal);
    const makingChargeNpr = Number(item.makingChargeNpr);
    const stoneChargeNpr  = Number(item.stoneChargeNpr);
    const motiChargeNpr   = Number(item.motiChargeNpr);
    const malaChargeNpr   = Number(item.malaChargeNpr);
    const otherChargeNpr  = Number(item.otherChargeNpr);
    const totalJyalaNpr   = Number(item.totalJyalaNpr);

    // Calculate all price fields
    let metalValueNpr = 0;
    let luxuryTaxNpr = 0;
    let vatNpr = 0;
    let totalPriceNpr = 0;
    let grandTotalNpr = 0;

    if (item.metalTypeId) {
      const dailyRate = await this.prisma.dailyRate.findFirst({
        where: { metalTypeId: item.metalTypeId, isCurrent: true },
        orderBy: { effectiveDate: 'desc' },
      });

      if (dailyRate) {
        const billableGram = grossWeightGram + jertyGram;
        const ratePerGram = Number(dailyRate.sellRatePerGram);

        metalValueNpr = billableGram * ratePerGram;

        // Calculate luxury tax
        if (item.applyLuxuryTax) {
          if (isGoldMetal(item.metalType)) {
            const luxuryRule = await this.prisma.luxuryTaxRule.findFirst({
              where: { isActive: true, appliesTo: 'GOLD' },
              orderBy: { effectiveDate: 'desc' },
            });
            if (luxuryRule) {
              luxuryTaxNpr = metalValueNpr * Number(luxuryRule.rate);
            }
          }
        }

        // Calculate VAT
        if (item.applyVat) {
          const vatRule = await this.prisma.vatRule.findFirst({
            where: { isActive: true, appliesTo: 'JYALA' },
            orderBy: { effectiveDate: 'desc' },
          });
          if (vatRule) {
            vatNpr = totalJyalaNpr * Number(vatRule.rate);
          }
        }

        // Calculate addon value
        const addonValueNpr = item.addons?.reduce(
          (sum: number, a: any) => sum + Number(a.valuationNpr ?? 0),
          0,
        ) ?? 0;

        totalPriceNpr = metalValueNpr + totalJyalaNpr + luxuryTaxNpr + vatNpr + addonValueNpr;
        grandTotalNpr = totalPriceNpr; // backwards compatibility
      }
    }

    return {
      ...item,
      // Override Decimal → Number
      grossWeightGram,
      grossWeightTola,
      grossWeightLal,
      jertyGram,
      jertyTola,
      jertyLal,
      makingChargeNpr,
      stoneChargeNpr,
      motiChargeNpr,
      malaChargeNpr,
      otherChargeNpr,
      totalJyalaNpr,
      // New price fields
      metalValueNpr,
      totalPriceNpr,
      grandTotalNpr,
      luxuryTaxNpr,
      vatNpr,
      // Computed weight views
      grossWeight: WeightUtil.forBill(grossWeightGram),
      jertyWeight: WeightUtil.forBill(jertyGram),
      billableWeight: WeightUtil.forBill(grossWeightGram + jertyGram),
      // Jyala owner view — full breakdown
      jyalaOwnerView: {
        makingCharge: makingChargeNpr.toFixed(2),
        stoneCharge:  stoneChargeNpr.toFixed(2),
        motiCharge:   motiChargeNpr.toFixed(2),
        malaCharge:   malaChargeNpr.toFixed(2),
        otherCharge:  otherChargeNpr.toFixed(2),
        total:        totalJyalaNpr.toFixed(2),
      },
      // Customer only sees total jyala
      jyalaCustomerView: totalJyalaNpr.toFixed(2),
      // Cost rate snapshot — for profit report debugging
      costRate: this.resolveCostRateInfo(item),
    };
  }

  private async findOrThrow(id: string) {
    const item = await this.prisma.stockItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException(`StockItem ${id} not found`);
    return item;
  }

  async getCategories() {
    const rows = await this.prisma.itemCategory.findMany({
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { stockItems: true } },
        karatSequences: { where: { lastSeq: { gt: 0 } }, select: { id: true }, take: 1 },
      },
    });

    return rows.map((c) => ({
      id:               c.id,
      name:             c.name,
      shortCode:        c.shortCode,
      isProtected:      c.isProtected,
      isActive:         c.isActive,
      itemCount:        c._count.stockItems,
      skuSequenceUsed:  c.karatSequences.length > 0,
    }));
  }

  private async resolveUniqueShortCode(
    proposed: string,
    excludeId?: string,
  ): Promise<string> {
    const normalized = proposed.toUpperCase().slice(0, 4);
    let candidate = normalized;
    let n = 2;

    while (true) {
      const conflict = await this.prisma.itemCategory.findFirst({
        where: {
          shortCode: candidate,
          ...(excludeId ? { NOT: { id: excludeId } } : {}),
        },
      });
      if (!conflict) return candidate;
      candidate = `${normalized.slice(0, 2)}${n}`;
      n += 1;
    }
  }

  async createCategory(name: string, shortCode?: string, createdByUserId?: string) {
    const existing = await this.prisma.itemCategory.findUnique({
      where: { name },
    });
    if (existing) {
      if (!existing.isActive) {
        return this.prisma.itemCategory.update({
          where: { name },
          data:  { isActive: true },
        });
      }
      throw new ConflictException(`Category "${name}" already exists`);
    }

    const code = await this.resolveUniqueShortCode(
      shortCode?.toUpperCase() ?? deriveCategoryShortCode(name),
    );

    return this.prisma.itemCategory.create({
      data: {
        name,
        shortCode: code,
        isProtected: false,
        createdByUserId: createdByUserId ?? null,
      },
    });
  }

  async updateCategory(id: string, dto: UpdateCategoryDto) {
    const category = await this.prisma.itemCategory.findUnique({
      where: { id },
    });
    if (!category) throw new NotFoundException(`Category ${id} not found`);

    if (dto.name && dto.name !== category.name) {
      const conflict = await this.prisma.itemCategory.findUnique({
        where: { name: dto.name },
      });
      if (conflict) {
        throw new ConflictException(`Category "${dto.name}" already exists`);
      }
    }

    if (dto.shortCode && dto.shortCode.toUpperCase() !== category.shortCode) {
      const seqUsed = await this.prisma.categoryKaratSequence.findFirst({
        where: { categoryId: id, lastSeq: { gt: 0 } },
      });
      if (seqUsed) {
        throw new ConflictException(
          'Items already have SKUs using this code — shortCode cannot be changed after stock has been added.',
        );
      }

      const conflict = await this.prisma.itemCategory.findFirst({
        where: { shortCode: dto.shortCode.toUpperCase(), NOT: { id } },
      });
      if (conflict) {
        throw new ConflictException(`shortCode "${dto.shortCode}" is already in use`);
      }
    }

    const data: { name?: string; shortCode?: string; isActive?: boolean } = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.shortCode !== undefined) data.shortCode = dto.shortCode.toUpperCase();
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    return this.prisma.itemCategory.update({
      where: { id },
      data,
    });
  }

  async deleteCategory(id: string) {
    const category = await this.prisma.itemCategory.findUnique({
      where: { id },
    });
    if (!category) throw new NotFoundException(`Category ${id} not found`);

    if (category.isProtected) {
      throw new ConflictException(
        `Category "${category.name}" is protected and cannot be deleted`,
      );
    }

    const stockCount = await this.prisma.stockItem.count({
      where: { categoryId: id },
    });
    if (stockCount > 0) {
      throw new ConflictException(
        `Cannot delete category "${category.name}" — ${stockCount} stock item(s) reference it`,
      );
    }

    await this.prisma.categoryKaratSequence.deleteMany({ where: { categoryId: id } });
    return this.prisma.itemCategory.delete({ where: { id } });
  }

async deactivateCategory(id: string) {
  const category = await this.prisma.itemCategory.findUnique({
    where: { id },
  });
  if (!category) throw new NotFoundException(`Category ${id} not found`);

  // Check if any active stock items use this category
  const activeStockCount = await this.prisma.stockItem.count({
    where: {
      categoryId: id,
      status:     { in: ['IN_STOCK', 'RESERVED'] },
    },
  });

  if (activeStockCount > 0) {
    throw new ConflictException(
      `Cannot deactivate category "${category.name}" — ${activeStockCount} active stock items use it`,
    );
  }

  return this.prisma.itemCategory.update({
    where: { id },
    data:  { isActive: false },
  });
}
}
