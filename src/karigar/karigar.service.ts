import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StockSkuService } from '../stock/stock-sku.service';
import { WeightUtil } from '../common/utils/weight.util';
import { Decimal } from '@prisma/client/runtime/library';
import {
  CreateKarigarDto,
  UpdateKarigarDto,
  KarigarQueryDto,
  CreateProductionOrderDto,
  CreateProductionIssueDto,
  CreateProductionReturnDto,
  CreateKarigarPaymentDto,
  ResolveDisputeDto,
  ProductionOrderQueryDto,
} from './dto/karigar.dto';

@Injectable()
export class KarigarService {
  constructor(
    private readonly prisma:     PrismaService,
    private readonly skuService: StockSkuService,
  ) {}

  // ════════════════════════════════════════════════════════════════════════════
  //  KARIGAR
  // ════════════════════════════════════════════════════════════════════════════

  async createKarigar(dto: CreateKarigarDto) {
    return this.prisma.karigar.create({ data: dto });
  }

  async listKarigars(query: KarigarQueryDto) {
    const { search, isActive, page = 1, limit = 20 } = query;
    const skip  = (page - 1) * limit;
    const where: any = {};

    if (isActive !== undefined) where.isActive = isActive;
    if (search) {
      where.OR = [
        { name:  { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
      ];
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.karigar.findMany({
        where,
        orderBy: { name: 'asc' },
        skip,
        take:    limit,
        include: { _count: { select: { productionOrders: true } } },
      }),
      this.prisma.karigar.count({ where }),
    ]);

    return { data: items, meta: { total, page, limit, pages: Math.ceil(total / limit) } };
  }

  async getKarigar(id: string) {
    const karigar = await this.prisma.karigar.findUnique({
      where:   { id },
      include: {
        productionOrders: {
          orderBy: { createdAt: 'desc' },
          take:    5,
          include: { _count: { select: { productionIssues: true } } },
        },
        disputes: {
          where:   { status: 'PENDING' },
          orderBy: { createdAt: 'desc' },
        },
        _count: { select: { productionOrders: true, disputes: true } },
      },
    });
    if (!karigar) throw new NotFoundException(`Karigar ${id} not found`);
    return karigar;
  }

  async updateKarigar(id: string, dto: UpdateKarigarDto) {
    await this.findKarigarOrThrow(id);
    return this.prisma.karigar.update({ where: { id }, data: dto });
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  PRODUCTION ORDER
  // ════════════════════════════════════════════════════════════════════════════

  async createProductionOrder(dto: CreateProductionOrderDto) {
    const karigar = await this.prisma.karigar.findUnique({
      where: { id: dto.karigarId },
    });
    if (!karigar) throw new NotFoundException(`Karigar ${dto.karigarId} not found`);
    if (!karigar.isActive) throw new BadRequestException('Karigar is inactive');

    return this.prisma.productionOrder.create({
      data: {
        karigarId:    dto.karigarId,
        tolerancePct: dto.tolerancePct ?? Number(karigar.tolerancePct),
        notes:        dto.notes,
        status:       'OPEN',
      },
      include: { karigar: true },
    });
  }

  async listProductionOrders(query: ProductionOrderQueryDto) {
    const { karigarId, status, from, to, page = 1, limit = 20 } = query;
    const skip  = (page - 1) * limit;
    const where: any = {};

    if (karigarId) where.karigarId = karigarId;
    if (status)    where.status    = status;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to)   where.createdAt.lte = new Date(to);
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.productionOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take:    limit,
        include: {
          karigar: { select: { id: true, name: true } },
          _count:  { select: { productionIssues: true, productionReturns: true } },
        },
      }),
      this.prisma.productionOrder.count({ where }),
    ]);

    return { data: items, meta: { total, page, limit, pages: Math.ceil(total / limit) } };
  }

  async getProductionOrder(id: string) {
    const order = await this.prisma.productionOrder.findUnique({
      where:   { id },
      include: {
        karigar:          true,
        productionIssues: { include: { metalType: true } },
        productionReturns: {
          include: {
            productionItems: { include: { stockItem: true } },
          },
        },
        payments:  true,
        disputes:  true,
      },
    });
    if (!order) throw new NotFoundException(`ProductionOrder ${id} not found`);
    return this.formatOrderResponse(order);
  }

  async completeProductionOrder(id: string) {
    const order = await this.prisma.productionOrder.findUnique({ where: { id } });
    if (!order) throw new NotFoundException(`ProductionOrder ${id} not found`);
    if (order.status !== 'OPEN') {
      throw new ConflictException(`Order is already ${order.status}`);
    }
    return this.prisma.productionOrder.update({
      where: { id },
      data:  { status: 'COMPLETED' },
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  PRODUCTION ISSUE
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Issue raw metal to karigar.
   * Rate defaults to today's current rate if not provided.
   */
  async createProductionIssue(dto: CreateProductionIssueDto) {
    const order = await this.prisma.productionOrder.findUnique({
      where: { id: dto.productionOrderId },
    });
    if (!order) throw new NotFoundException(`ProductionOrder ${dto.productionOrderId} not found`);
    if (order.status !== 'OPEN') {
      throw new BadRequestException('Can only issue metal to OPEN production orders');
    }

    const metal = await this.prisma.metalType.findUnique({
      where: { id: dto.metalTypeId },
    });
    if (!metal || !metal.isActive) {
      throw new NotFoundException(`MetalType ${dto.metalTypeId} not found or inactive`);
    }

    // Get today's rate if not provided
    let rateAtIssue = dto.rateAtIssuePerGram;
    if (!rateAtIssue) {
      const dailyRate = await this.prisma.dailyRate.findFirst({
        where:   { metalTypeId: dto.metalTypeId, isCurrent: true },
        orderBy: { effectiveDate: 'desc' },
      });
      if (!dailyRate) {
        throw new BadRequestException(
          `No current rate for ${metal.name}. Set today's rate or provide rateAtIssuePerGram.`,
        );
      }
      rateAtIssue = Number(dailyRate.sellRatePerGram);
    }

    const w = WeightUtil.from(dto.issuedWeight.value, dto.issuedWeight.unit);

    return this.prisma.productionIssue.create({
      data: {
        productionOrderId:  dto.productionOrderId,
        metalTypeId:        dto.metalTypeId,
        issuedWeightGram:   w.gram,
        issuedWeightTola:   w.tola,
        issuedWeightLal:    w.lal,
        rateAtIssuePerGram: rateAtIssue,
      },
      include: {
        metalType:      true,
        productionOrder: { include: { karigar: true } },
      },
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  PRODUCTION RETURN
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Record karigar returning finished items.
   *
   * Flow:
   * 1. Calculate actual kharchar (wastage) = issued - returned
   * 2. Check if within tolerance
   * 3. If over tolerance → create KarigarDispute automatically
   * 4. Create ProductionItem per piece → StockItem (origin=KARIGAR)
   */
  async createProductionReturn(dto: CreateProductionReturnDto) {
    const order = await this.prisma.productionOrder.findUnique({
      where: { id: dto.productionOrderId },
      include: { karigar: true },
    });
    if (!order) throw new NotFoundException(`ProductionOrder ${dto.productionOrderId} not found`);
    if (order.status !== 'OPEN') {
      throw new BadRequestException('Can only return to OPEN production orders');
    }

    const issue = await this.prisma.productionIssue.findUnique({
      where: { id: dto.productionIssueId },
    });
    if (!issue) throw new NotFoundException(`ProductionIssue ${dto.productionIssueId} not found`);

    const returnedW = WeightUtil.from(dto.returnedWeight.value, dto.returnedWeight.unit);
    const issuedGram = Number(issue.issuedWeightGram);

    if (returnedW.gram > issuedGram) {
      throw new BadRequestException('Returned weight cannot exceed issued weight');
    }

    // Calculate kharchar (wastage)
    const kharcharGram = issuedGram - returnedW.gram;
    const kharcharW    = WeightUtil.fromGram(kharcharGram);

    // Check tolerance
    const tolerancePct    = Number(order.tolerancePct);
    const maxAllowedWaste = (issuedGram * tolerancePct) / 100;
    const withinTolerance = kharcharGram <= maxAllowedWaste;

    return this.prisma.$transaction(async (tx) => {
      // 1. Create production return record
      const productionReturn = await tx.productionReturn.create({
        data: {
          productionOrderId: dto.productionOrderId,
          productionIssueId: dto.productionIssueId,
          returnedWeightGram: returnedW.gram,
          returnedWeightTola: returnedW.tola,
          returnedWeightLal:  returnedW.lal,
          kharcharGram:       kharcharW.gram,
          kharcharTola:       kharcharW.tola,
          kharcharLal:        kharcharW.lal,
          withinTolerance,
        },
      });

      // 2. Create stock item for each finished piece
      const entryRate = await tx.dailyRate.findFirst({
        where:   { isCurrent: true },
        orderBy: { effectiveDate: 'desc' },
      });

      for (const item of dto.items) {
        const sku    = await this.skuService.generateSku('KARIGAR', tx);
        const itemW  = WeightUtil.from(item.grossWeight.value, item.grossWeight.unit);

        const productionItem = await tx.productionItem.create({
          data: {
            productionReturnId: productionReturn.id,
            description:        item.description,
            grossWeightGram:    itemW.gram,
            grossWeightTola:    itemW.tola,
            grossWeightLal:     itemW.lal,
          },
        });

        await tx.stockItem.create({
          data: {
            sku,
            origin:           'KARIGAR',
            categoryId:       await this.getDefaultCategoryId(tx),
            metalTypeId:      issue.metalTypeId,
            grossWeightGram:  itemW.gram,
            grossWeightTola:  itemW.tola,
            grossWeightLal:   itemW.lal,
            entryRateId:      entryRate?.id,
            productionItemId: productionItem.id,
            status:           'IN_STOCK',
          },
        });
      }

      // 3. If over tolerance → auto-create dispute
      let dispute = null;
      if (!withinTolerance) {
        const excessGram = kharcharGram - maxAllowedWaste;
        const excessW    = WeightUtil.fromGram(excessGram);

        dispute = await tx.karigarDispute.create({
          data: {
            karigarId:        order.karigarId,
            productionOrderId: dto.productionOrderId,
            excessWeightGram: excessW.gram,
            excessWeightTola: excessW.tola,
            excessWeightLal:  excessW.lal,
            status:           'PENDING',
          },
        });
      }

      return {
        productionReturn: {
          ...productionReturn,
          returnedWeight: WeightUtil.forBill(returnedW.gram),
          kharcharWeight: WeightUtil.forBill(kharcharW.gram),
          withinTolerance,
          tolerancePct,
          maxAllowedWasteGram: maxAllowedWaste.toFixed(4),
        },
        dispute,
        stockItemsCreated: dto.items.length,
      };
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  KARIGAR PAYMENT
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Record payment to karigar.
   * Can be cash + metal, cash only, or metal only.
   * Optional dispute deduction applied manually by owner.
   */
  async createKarigarPayment(dto: CreateKarigarPaymentDto) {
    await this.findKarigarOrThrow(dto.karigarId);

    const order = await this.prisma.productionOrder.findUnique({
      where: { id: dto.productionOrderId },
    });
    if (!order) throw new NotFoundException(`ProductionOrder ${dto.productionOrderId} not found`);

    // Must provide at least cash or metal
    if (!dto.cashAmountNpr && !dto.metalWeight) {
      throw new BadRequestException('Must provide at least cashAmountNpr or metalWeight');
    }

    // If metal payment, metalTypeId required
    if (dto.metalWeight && !dto.metalTypeId) {
      throw new BadRequestException('metalTypeId is required when providing metalWeight');
    }

    let metalGram: number | undefined;
    let metalTola: number | undefined;
    let metalLal:  number | undefined;

    if (dto.metalWeight) {
      const w  = WeightUtil.from(dto.metalWeight.value, dto.metalWeight.unit);
      metalGram = w.gram;
      metalTola = w.tola;
      metalLal  = w.lal;
    }

    const payment = await this.prisma.karigarPayment.create({
      data: {
        karigarId:        dto.karigarId,
        productionOrderId: dto.productionOrderId,
        cashAmountNpr:    dto.cashAmountNpr,
        metalWeightGram:  metalGram,
        metalWeightTola:  metalTola,
        metalWeightLal:   metalLal,
        metalTypeId:      dto.metalTypeId,
        deductionNpr:     dto.deductionNpr ?? 0,
        deductionNotes:   dto.deductionNotes,
        notes:            dto.notes,
      },
      include: {
        karigar:         true,
        productionOrder: true,
        metalType:       true,
      },
    });

    return {
      ...payment,
      ...(metalGram ? { metalWeight: WeightUtil.forBill(metalGram) } : {}),
    };
  }

  async getKarigarPayments(karigarId: string) {
    await this.findKarigarOrThrow(karigarId);
    return this.prisma.karigarPayment.findMany({
      where:   { karigarId },
      orderBy: { paidAt: 'desc' },
      include: { metalType: true, productionOrder: true },
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  KARIGAR DISPUTE
  // ════════════════════════════════════════════════════════════════════════════

  async listDisputes(karigarId?: string) {
    const where: any = {};
    if (karigarId) where.karigarId = karigarId;

    return this.prisma.karigarDispute.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        karigar:         { select: { id: true, name: true } },
        productionOrder: { select: { id: true, status: true } },
      },
    });
  }

  /**
   * Resolve a dispute — owner sets deduction amount.
   * Marks dispute as RESOLVED.
   * The deduction is applied manually in the next KarigarPayment.
   */
  async resolveDispute(disputeId: string, dto: ResolveDisputeDto) {
    const dispute = await this.prisma.karigarDispute.findUnique({
      where: { id: disputeId },
    });
    if (!dispute) throw new NotFoundException(`Dispute ${disputeId} not found`);
    if (dispute.status === 'RESOLVED') {
      throw new ConflictException('Dispute is already resolved');
    }

    return this.prisma.karigarDispute.update({
      where: { id: disputeId },
      data:  {
        deductionNpr:    dto.deductionNpr,
        resolutionNotes: dto.resolutionNotes,
        status:          'RESOLVED',
        resolvedAt:      new Date(),
      },
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  HELPERS
  // ════════════════════════════════════════════════════════════════════════════

  private formatOrderResponse(order: any) {
    const totalIssuedGram = order.productionIssues?.reduce(
      (sum: number, i: any) => sum + Number(i.issuedWeightGram),
      0,
    ) ?? 0;

    const totalReturnedGram = order.productionReturns?.reduce(
      (sum: number, r: any) => sum + Number(r.returnedWeightGram),
      0,
    ) ?? 0;

    return {
      ...order,
      weightSummary: {
        totalIssued:   WeightUtil.forBill(totalIssuedGram),
        totalReturned: WeightUtil.forBill(totalReturnedGram),
        totalKharchar: WeightUtil.forBill(Math.max(0, totalIssuedGram - totalReturnedGram)),
      },
    };
  }

  private async findKarigarOrThrow(id: string) {
    const k = await this.prisma.karigar.findUnique({ where: { id } });
    if (!k) throw new NotFoundException(`Karigar ${id} not found`);
    return k;
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
