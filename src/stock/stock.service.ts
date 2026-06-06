import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StockSkuService } from './stock-sku.service';
import { WeightUtil } from '../common/utils/weight.util';
import { Decimal } from '@prisma/client/runtime/library';
import {
  CreateStockItemDto,
  UpdateStockItemDto,
  UpdateStockStatusDto,
  PricePreviewDto,
  StockQueryDto,
  JyalaBreakdownDto,
  UpdateCategoryDto,
} from './dto/stock.dto';

// ─── PRICING RESULT ───────────────────────────────────────────────────────────

export interface PricingResult {
  // ── Inputs ──────────────────────────────────────────────────────────────
  grossWeight:    ReturnType<typeof WeightUtil.forBill>;
  jertyWeight:    ReturnType<typeof WeightUtil.forBill>;
  billableWeight: ReturnType<typeof WeightUtil.forBill>; // gross + jerty
  ratePerGram:    string;

  // ── Calculation steps ────────────────────────────────────────────────────
  metalValueNpr:  string; // billableWeight.gram × ratePerGram

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

  // ── Tax ──────────────────────────────────────────────────────────────────
  luxuryTaxNpr:  string; // 2% of metalValue (gold only, if toggled)
  vatNpr:        string; // 13% of jyala (if toggled)

  // ── Addons ────────────────────────────────────────────────────────────────
  addonValueNpr: string;

  // ── Totals ────────────────────────────────────────────────────────────────
  grandTotalNpr: string;

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
    if (dto.metalTypeId) {
      const metal = await this.prisma.metalType.findUnique({
        where: { id: dto.metalTypeId },
      });
      if (!metal || !metal.isActive) {
        throw new NotFoundException(`MetalType ${dto.metalTypeId} not found or inactive`);
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
    } else {
      if (dto.origin.tradeItemId || dto.origin.productionItemId) {
        throw new BadRequestException('tradeItemId or productionItemId may only be set when origin.type is TRADE or KARIGAR');
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

    // ── Generate SKU ─────────────────────────────────────────────────────────
    const sku = await this.skuService.generateSku(dto.origin.type);

    // ── Create stock item ────────────────────────────────────────────────────
    const stockItem = await this.prisma.stockItem.create({
      data: {
        sku,
        name:            dto.name,
        origin:          dto.origin.type,
        categoryId:      dto.categoryId,
        metalTypeId:     dto.metalTypeId,
        karat:           dto.karat,
        tradeItemId:     dto.origin.tradeItemId,
        productionItemId: dto.origin.productionItemId,

        // Gross weight
        grossWeightGram: grossW.gram,
        grossWeightTola: grossW.tola,
        grossWeightLal:  grossW.lal,

        // Jerty weight
        jertyGram:       finalJertyW.gram,
        jertyTola:       finalJertyW.tola,
        jertyLal:        finalJertyW.lal,

        // Jyala breakdown
        makingChargeNpr: jyala.making,
        stoneChargeNpr:  jyala.stone,
        motiChargeNpr:   jyala.moti,
        malaChargeNpr:   jyala.mala,
        otherChargeNpr:  jyala.other,
        totalJyalaNpr,

        // Tax toggles
        applyLuxuryTax:  dto.applyLuxuryTax ?? false,
        applyVat:        dto.applyVat ?? false,

        photoUrl:        dto.photoUrl,
        notes:           dto.notes,
        status:          'IN_STOCK',

        // Addons
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

    return this.formatStockResponse(stockItem);
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  READ
  // ════════════════════════════════════════════════════════════════════════════

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
        },
      }),
      this.prisma.stockItem.count({ where }),
    ]);

    return {
      data: items.map((i) => this.formatStockResponse(i)),
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
        tradeItem: { include: { trade: { include: { supplier: true } } } },
      },
    });

    if (!item) throw new NotFoundException(`StockItem ${id} not found`);
    return this.formatStockResponse(item);
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

    // ── Update jerty ─────────────────────────────────────────────────────────
    if (dto.jertyWeight) {
      const jertyW        = WeightUtil.from(dto.jertyWeight.value, dto.jertyWeight.unit);
      data.jertyGram      = jertyW.gram;
      data.jertyTola      = jertyW.tola;
      data.jertyLal       = jertyW.lal;
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

    return this.formatStockResponse(updated);
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

    return this.formatStockResponse(updated);
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
  const client     = tx ?? this.prisma;
  const ratePerGram = Number(dailyRate.ratePerGram ?? dailyRate.sellRatePerGram);

  // ── Weights ─────────────────────────────────────────────────────────────
  const grossGram = Number(item.grossWeightGram);

  const jertyGram = (overrides?.jertyOverride != null)
    ? WeightUtil.from(overrides.jertyOverride.value, overrides.jertyOverride.unit).gram
    : Number(item.jertyGram ?? 0);

  const billableGram = grossGram + jertyGram;

  // ── Metal value ──────────────────────────────────────────────────────────
  const metalValueNpr = billableGram * ratePerGram;

  // ── Jyala ────────────────────────────────────────────────────────────────
  // Treat both null and undefined as "no override" — callers may pass
  // { jyalaOverride: undefined } or { jyalaOverride: null } interchangeably
  const finalJyala = (overrides?.jyalaOverride != null)
    ? overrides.jyalaOverride
    : Number(item.totalJyalaNpr ?? 0);

  // ── Luxury tax — read active rule from DB, not hardcoded ─────────────────
  // item.applyLuxuryTax is the per-item toggle (checkbox on frontend)
  // LuxuryTaxRule.isActive is the shop-wide master switch (owner can disable globally)
  // Both must be true for tax to apply
  let luxuryTaxNpr = 0;
  if (item.applyLuxuryTax) {
    const isGold = item.metalType?.name?.toLowerCase().includes('gold') ?? false;
    if (isGold) {
      const luxuryRule = await client.luxuryTaxRule.findFirst({
        where:   { isActive: true, appliesTo: 'GOLD' },
        orderBy: { effectiveDate: 'desc' },   // most recent active rule wins
      });
      if (luxuryRule) {
        luxuryTaxNpr = metalValueNpr * Number(luxuryRule.rate);
      }
      // If no active rule exists → tax is 0, no error
      // This handles the case where government removes the tax —
      // owner deactivates the rule, all new bills automatically get 0 luxury tax
    }
  }

  // ── VAT — read active rule from DB ───────────────────────────────────────
  let vatNpr = 0;
  if (item.applyVat) {
    const vatRule = await client.vatRule.findFirst({
      where:   { isActive: true, appliesTo: 'JYALA' },
      orderBy: { effectiveDate: 'desc' },
    });
    if (vatRule) {
      vatNpr = finalJyala * Number(vatRule.rate);
    }
  }

  // ── Addons ───────────────────────────────────────────────────────────────
  const addonValueNpr = item.addons?.reduce(
    (sum: number, a: any) => sum + Number(a.valuationNpr ?? 0),
    0,
  ) ?? 0;

  // ── Grand total ──────────────────────────────────────────────────────────
  const grandTotalNpr = metalValueNpr + finalJyala + luxuryTaxNpr + vatNpr + addonValueNpr;

  const fmt = (n: number) => (n ?? 0).toFixed(2);

  const result: PricingResult = {
    grossWeight:    WeightUtil.forBill(grossGram),
    jertyWeight:    WeightUtil.forBill(jertyGram),
    billableWeight: WeightUtil.forBill(billableGram),
    ratePerGram:    fmt(ratePerGram),
    metalValueNpr:  fmt(metalValueNpr),

    jyalaOwnerView: {
      makingCharge: fmt(Number(item.makingChargeNpr ?? 0)),
      stoneCharge:  fmt(Number(item.stoneChargeNpr  ?? 0)),
      motiCharge:   fmt(Number(item.motiChargeNpr   ?? 0)),
      malaCharge:   fmt(Number(item.malaChargeNpr   ?? 0)),
      otherCharge:  fmt(Number(item.otherChargeNpr  ?? 0)),
      total:        fmt(finalJyala),
    },
    jyalaCustomerView: fmt(finalJyala),

    luxuryTaxNpr:  fmt(luxuryTaxNpr),
    vatNpr:        fmt(vatNpr),
    addonValueNpr: fmt(addonValueNpr),
    grandTotalNpr: fmt(grandTotalNpr),

    ownerBill: {
      metalValue: fmt(metalValueNpr),
      jyalaBreakdown: {
        makingCharge: fmt(Number(item.makingChargeNpr ?? 0)),
        stoneCharge:  fmt(Number(item.stoneChargeNpr  ?? 0)),
        motiCharge:   fmt(Number(item.motiChargeNpr   ?? 0)),
        malaCharge:   fmt(Number(item.malaChargeNpr   ?? 0)),
        otherCharge:  fmt(Number(item.otherChargeNpr  ?? 0)),
      },
      jyalaTotal:  fmt(finalJyala),
      luxuryTax:   luxuryTaxNpr > 0 ? fmt(luxuryTaxNpr) : null,
      vat:         vatNpr > 0       ? fmt(vatNpr)        : null,
      addonValue:  fmt(addonValueNpr),
      grandTotal:  fmt(grandTotalNpr),
    },

    customerBill: {
      metalValue: fmt(metalValueNpr),
      jyala:      fmt(finalJyala),
      luxuryTax:  luxuryTaxNpr > 0 ? fmt(luxuryTaxNpr) : null,
      vat:        vatNpr > 0       ? fmt(vatNpr)        : null,
      grandTotal: fmt(grandTotalNpr),
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

  /** Format a raw stock item for API response — adds bill-ready weight display */
  private formatStockResponse(item: any) {
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
    };
  }

  private async findOrThrow(id: string) {
    const item = await this.prisma.stockItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException(`StockItem ${id} not found`);
    return item;
  }

  async getCategories() {
  return this.prisma.itemCategory.findMany({
    where:   { isActive: true },   // ← add this filter — don't show deactivated
    orderBy: { name: 'asc' },
  });
}

async createCategory(name: string) {
  // Check for duplicate name
  const existing = await this.prisma.itemCategory.findUnique({
    where: { name },
  });
  if (existing) {
    // If it was deactivated before, reactivate it
    if (!existing.isActive) {
      return this.prisma.itemCategory.update({
        where: { name },
        data:  { isActive: true },
      });
    }
    throw new ConflictException(`Category "${name}" already exists`);
  }

  return this.prisma.itemCategory.create({
    data: { name },
  });
}

async updateCategory(id: string, dto: UpdateCategoryDto) {
  const category = await this.prisma.itemCategory.findUnique({
    where: { id },
  });
  if (!category) throw new NotFoundException(`Category ${id} not found`);

  // If renaming, check new name doesn't conflict
  if (dto.name && dto.name !== category.name) {
    const conflict = await this.prisma.itemCategory.findUnique({
      where: { name: dto.name },
    });
    if (conflict) {
      throw new ConflictException(`Category "${dto.name}" already exists`);
    }
  }

  return this.prisma.itemCategory.update({
    where: { id },
    data:  dto,
  });
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
