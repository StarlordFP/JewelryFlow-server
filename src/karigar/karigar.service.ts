import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StockSkuService } from '../stock/stock-sku.service';
import { StockService } from '../stock/stock.service';
import { WeightUtil } from '../common/utils/weight.util';
import { Decimal } from '@prisma/client/runtime/library';
import {
  CreateKarigarDto,
  UpdateKarigarDto,
  KarigarQueryDto,
  CreateProductionOrderDto,
  CreateProductionIssueDto,
  IssueProductionOrderLinesBatchDto,
  WeighInProductionOrderLineDto,
  WeighInProductionOrderLinesBatchDto,
  ApproveProductionOrderLinesBatchDto,
  CreateProductionReturnDto,
  CreateKarigarPaymentDto,
  ResolveDisputeDto,
  ProductionOrderQueryDto,
} from './dto/karigar.dto';

/** Shared float tolerance for gram comparisons in this module */
const WEIGHT_EPSILON = 0.001;

@Injectable()
export class KarigarService {
  constructor(
    private readonly prisma:        PrismaService,
    private readonly skuService:    StockSkuService,
    private readonly stockService:  StockService,
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
        include: {
          _count: { select: { productionOrders: true } },
          metalBalances: {
            where:   { balanceGram: { not: 0 } },
            include: { metalType: { select: { id: true, name: true } } },
          },
        },
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
        metalBalances: {
          where:   { balanceGram: { gt: 0 } },
          include: { metalType: { select: { id: true, name: true } } },
        },
        _count: { select: { productionOrders: true, disputes: true } },
      },
    });
    if (!karigar) throw new NotFoundException(`Karigar ${id} not found`);
    return karigar;
  }

  async getKarigarMetalBalance(karigarId: string) {
    await this.findKarigarOrThrow(karigarId);
    return this.prisma.karigarMetalBalance.findMany({
      where:   { karigarId, balanceGram: { not: 0 } },
      include: { metalType: { select: { id: true, name: true } } },
      orderBy: { metalType: { name: 'asc' } },
    });
  }

  async updateKarigar(id: string, dto: UpdateKarigarDto) {
    await this.findKarigarOrThrow(id);
    return this.prisma.karigar.update({ where: { id }, data: dto });
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  PRODUCTION ORDER
  // ════════════════════════════════════════════════════════════════════════════

  async createProductionOrder(userId: string, dto: CreateProductionOrderDto) {
    const karigar = await this.prisma.karigar.findUnique({
      where: { id: dto.karigarId },
    });
    if (!karigar) throw new NotFoundException(`Karigar ${dto.karigarId} not found`);
    if (!karigar.isActive) throw new BadRequestException('Karigar is inactive');

    const hasLines = (dto.lines?.length ?? 0) > 0;
    if (!hasLines && dto.toleranceGram == null && dto.tolerancePct == null) {
      throw new BadRequestException(
        'Simple production orders require tolerancePct or toleranceGram.',
      );
    }

    const orderData = {
      karigarId:       dto.karigarId,
      tolerancePct:    dto.tolerancePct ?? 0,
      toleranceGram:   dto.toleranceGram,
      notes:           dto.notes,
      status:          'OPEN' as const,
      createdByUserId: userId,
    };

    if (!dto.lines?.length) {
      return this.prisma.productionOrder.create({
        data:    orderData,
        include: { karigar: true },
      });
    }

    for (const line of dto.lines) {
      if (line.plannedIssuedWeightGram < line.expectedWeightGram) {
        throw new BadRequestException(
          `plannedIssuedWeightGram (${line.plannedIssuedWeightGram}g) must be >= ` +
          `expectedWeightGram (${line.expectedWeightGram}g) for line "${line.description}".`,
        );
      }
    }

    const categoryIds = [...new Set(dto.lines.map((l) => l.categoryId))];
    const metalTypeIds = [...new Set(dto.lines.map((l) => l.metalTypeId))];

    const [categories, metalTypes] = await Promise.all([
      this.prisma.itemCategory.findMany({
        where:  { id: { in: categoryIds }, isActive: true },
        select: { id: true },
      }),
      this.prisma.metalType.findMany({
        where:  { id: { in: metalTypeIds }, isActive: true },
        select: { id: true },
      }),
    ]);

    if (categories.length !== categoryIds.length) {
      const found = new Set(categories.map((c) => c.id));
      const missing = categoryIds.filter((id) => !found.has(id));
      throw new BadRequestException(
        `Category not found or inactive: ${missing.join(', ')}`,
      );
    }
    if (metalTypes.length !== metalTypeIds.length) {
      const found = new Set(metalTypes.map((m) => m.id));
      const missing = metalTypeIds.filter((id) => !found.has(id));
      throw new BadRequestException(
        `MetalType not found or inactive: ${missing.join(', ')}`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const order = await tx.productionOrder.create({
        data:    orderData,
        include: { karigar: true },
      });

      const lines = await Promise.all(
        dto.lines!.map((line) =>
          tx.productionOrderLine.create({
            data: {
              productionOrderId:       order.id,
              description:             line.description,
              categoryId:              line.categoryId,
              metalTypeId:             line.metalTypeId,
              karat:                   line.karat,
              expectedWeightGram:      line.expectedWeightGram,
              plannedIssuedWeightGram: line.plannedIssuedWeightGram,
              status:                  'PENDING',
            },
            include: {
              category:  { select: { id: true, name: true } },
              metalType: { select: { id: true, name: true } },
            },
          }),
        ),
      );

      return { ...order, lines };
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
          createdBy: { select: { id: true, name: true } },
          disputes: {
            select: {
              id: true,
              status: true,
              productionOrderLineId: true,
              excessWeightGram: true,
            },
          },
          lines: {
            orderBy: { createdAt: 'asc' },
            include: {
              category:  { select: { id: true, name: true } },
              metalType: { select: { id: true, name: true } },
              productionIssue: {
                select: {
                  id: true,
                  issuedWeightGram: true,
                  issuedAt: true,
                  rateAtIssuePerGram: true,
                },
              },
            },
          },
          _count:  { select: { productionIssues: true, productionReturns: true } },
        },
      }),
      this.prisma.productionOrder.count({ where }),
    ]);

    return {
      data: items.map((order) => ({
        ...order,
        lines: order.lines.map((line) => this.formatProductionOrderLine(line)),
      })),
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    };
  }

  async getProductionOrder(id: string) {
    const order = await this.prisma.productionOrder.findUnique({
      where:   { id },
      include: {
        karigar:          true,
        createdBy:        { select: { id: true, name: true } },
        productionIssues: {
          include: {
            metalType:  true,
            sourceItems: {
              include: {
                stockItem: {
                  select: { id: true, sku: true, name: true, grossWeightGram: true },
                },
              },
            },
          },
        },
        productionReturns: {
          include: {
            productionItems: { include: { stockItem: true } },
          },
        },
        lines: {
          orderBy: { createdAt: 'asc' },
          include: {
            category:  { select: { id: true, name: true } },
            metalType: { select: { id: true, name: true } },
            productionIssue: {
              select: {
                id: true,
                issuedWeightGram: true,
                rateAtIssuePerGram: true,
                issuedAt: true,
              },
            },
          },
        },
        metalPools: {
          include: {
            metalType: { select: { id: true, name: true } },
          },
        },
        payments:  true,
        disputes:  true,
      },
    });
    if (!order) throw new NotFoundException(`ProductionOrder ${id} not found`);
    return this.formatOrderResponse(order);
  }

  async getProductionOrderLine(id: string) {
    const line = await this.prisma.productionOrderLine.findUnique({
      where:   { id },
      include: {
        category:  { select: { id: true, name: true } },
        metalType: { select: { id: true, name: true } },
        productionIssue: {
          select: {
            id: true,
            issuedWeightGram: true,
            rateAtIssuePerGram: true,
            issuedAt: true,
          },
        },
        productionOrder: { select: { id: true, status: true } },
      },
    });
    if (!line) {
      throw new NotFoundException(`ProductionOrderLine ${id} not found`);
    }
    return this.formatProductionOrderLine(line);
  }

  async completeProductionOrder(id: string) {
    const order = await this.prisma.productionOrder.findUnique({ where: { id } });
    if (!order) throw new NotFoundException(`ProductionOrder ${id} not found`);
    if (order.status !== 'OPEN') {
      throw new ConflictException(`Order is already ${order.status}`);
    }

    const lines = await this.prisma.productionOrderLine.findMany({
      where:  { productionOrderId: id },
      select: { id: true, status: true },
    });

    // Legacy/simple orders with no lines — unchanged completion path.
    if (lines.length === 0) {
      return this.prisma.productionOrder.update({
        where: { id },
        data:  { status: 'COMPLETED' },
      });
    }

    const incompleteCount = lines.filter((l) => l.status !== 'APPROVED').length;
    if (incompleteCount > 0) {
      throw new BadRequestException(
        `Cannot complete: ${incompleteCount} line(s) are not yet APPROVED.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const pools = await tx.productionOrderMetalPool.findMany({
        where: { productionOrderId: id },
        include: { metalType: { select: { id: true, name: true } } },
      });

      const sweptMetalBalance: Array<{
        metalTypeId: string;
        metalTypeName: string;
        amountGram: number;
      }> = [];

      for (const pool of pools) {
        const amountGram = Number(pool.pooledSurplusGram);
        if (amountGram <= WEIGHT_EPSILON) continue;

        await tx.karigarMetalBalance.upsert({
          where: {
            karigarId_metalTypeId: {
              karigarId:   order.karigarId,
              metalTypeId: pool.metalTypeId,
            },
          },
          create: {
            karigarId:   order.karigarId,
            metalTypeId: pool.metalTypeId,
            balanceGram: amountGram,
          },
          update: {
            balanceGram: { increment: amountGram },
          },
        });

        await tx.productionOrderMetalPool.update({
          where: { id: pool.id },
          data:  { pooledSurplusGram: 0 },
        });

        sweptMetalBalance.push({
          metalTypeId:   pool.metalTypeId,
          metalTypeName: pool.metalType.name,
          amountGram,
        });
      }

      const completed = await tx.productionOrder.update({
        where: { id },
        data:  { status: 'COMPLETED' },
      });

      return { ...completed, sweptMetalBalance };
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  PRODUCTION ORDER LINE (weigh-in / approve — STEP 4+)
  // ════════════════════════════════════════════════════════════════════════════
  //
  // STEP 4 correct-weigh-in FK ordering (required):
  // productionReturnId is @unique on ProductionOrderLine. Before deleting the
  // ProductionReturn, null line.productionReturnId (and productionReturn.productionOrderLineId)
  // in the SAME transaction, then delete the return — never delete while the line still points
  // at that return id.

  // ════════════════════════════════════════════════════════════════════════════
  //  PRODUCTION ISSUE
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Issue raw metal (and/or existing IN_STOCK items) to karigar.
   *
   * Remake flow: if `sourceStockItemIds` is provided
   *   1. Load each StockItem and verify status === IN_STOCK (reject whole
   *      request with a clear error if any item fails)
   *   2. Sum source-item weights and add to raw metal weight (may be 0)
   *   3. Store the combined total as issuedWeight on the ProductionIssue
   *   4. Create one ProductionIssueSourceItem row per source item
   *   5. Flip each source item IN_STOCK → IN_REMAKE via StockService
   *
   * If sourceStockItemIds is absent, behaviour is 100% identical to today.
   *
   * Rate defaults to today's current rate if not provided.
   */
  async createProductionIssue(dto: CreateProductionIssueDto) {
    const order = await this.prisma.productionOrder.findUnique({
      where: { id: dto.productionOrderId },
      include: { karigar: true },
    });
    if (!order) throw new NotFoundException(`ProductionOrder ${dto.productionOrderId} not found`);
    if (order.status !== 'OPEN') {
      throw new BadRequestException('Can only issue metal to OPEN production orders');
    }

    let orderLine: {
      id: string;
      productionOrderId: string;
      metalTypeId: string;
      status: string;
      expectedWeightGram: Decimal;
      plannedIssuedWeightGram: Decimal;
    } | null = null;

    if (dto.productionOrderLineId) {
      orderLine = await this.prisma.productionOrderLine.findUnique({
        where: { id: dto.productionOrderLineId },
      });
      if (!orderLine) {
        throw new NotFoundException(
          `ProductionOrderLine ${dto.productionOrderLineId} not found`,
        );
      }
      if (orderLine.productionOrderId !== dto.productionOrderId) {
        throw new BadRequestException(
          'productionOrderLineId does not belong to this productionOrderId',
        );
      }
      if (orderLine.status !== 'PENDING') {
        throw new ConflictException(
          `Production order line is already ${orderLine.status} — cannot issue again`,
        );
      }
      if (orderLine.metalTypeId !== dto.metalTypeId) {
        throw new BadRequestException(
          `Line metal type (${orderLine.metalTypeId}) does not match issue metal type (${dto.metalTypeId})`,
        );
      }
    }

    const metal = await this.prisma.metalType.findUnique({
      where: { id: dto.metalTypeId },
    });
    if (!metal || !metal.isActive) {
      throw new NotFoundException(`MetalType ${dto.metalTypeId} not found or inactive`);
    }

    // Deduplicate sourceStockItemIds
    const uniqueSourceIds = dto.sourceStockItemIds
      ? Array.from(new Set(dto.sourceStockItemIds))
      : [];
    const hasSourceItems = uniqueSourceIds.length > 0;

    let issuedWeightInput = dto.issuedWeight;
    if (orderLine && !issuedWeightInput) {
      issuedWeightInput = {
        value: Number(orderLine.plannedIssuedWeightGram),
        unit:  'gram' as const,
      };
    }

    // Must have at least some weight input
    if (!hasSourceItems && !issuedWeightInput) {
      throw new BadRequestException(
        'Provide either issuedWeight (raw metal) or sourceStockItemIds (items to remake), or both.',
      );
    }

    let sourceStockItems: any[] = [];
    let sourceWeightGram = 0;

    if (hasSourceItems) {
      // Load all source items in one query
      sourceStockItems = await this.prisma.stockItem.findMany({
        where: { id: { in: uniqueSourceIds } },
      });

      // Confirm every requested ID was found
      const foundIds = new Set(sourceStockItems.map((s) => s.id));
      const missing = uniqueSourceIds.filter((id) => !foundIds.has(id));
      if (missing.length > 0) {
        throw new BadRequestException(
          `Source StockItem(s) not found: ${missing.join(', ')}`,
        );
      }

      // Check metal type of every source item matches the production issue's metal type
      const mismatchedMetals = sourceStockItems.filter(
        (s) => s.metalTypeId !== dto.metalTypeId,
      );
      if (mismatchedMetals.length > 0) {
        const details = mismatchedMetals.map((s) => `${s.sku} (metalTypeId: ${s.metalTypeId})`).join(', ');
        throw new BadRequestException(
          `All source items must match the production issue metal type (${dto.metalTypeId}). Non-compliant: ${details}`,
        );
      }

      sourceWeightGram = sourceStockItems.reduce(
        (sum, s) => sum + Number(s.grossWeightGram),
        0,
      );
    }

    // ── Raw metal weight (may be 0 when only source items are used) ───────────
    const rawW = issuedWeightInput
      ? WeightUtil.from(issuedWeightInput.value, issuedWeightInput.unit)
      : WeightUtil.fromGram(0);

    // Combined total is what the karigar actually receives (before balance apply)
    const combinedGram = rawW.gram + sourceWeightGram;
    if (combinedGram <= 0) {
      throw new BadRequestException('Total issued weight must be greater than zero.');
    }

    const applyBalanceGram = dto.applyBalanceGram ?? 0;
    if (applyBalanceGram < 0) {
      throw new BadRequestException('applyBalanceGram cannot be negative.');
    }
    if (applyBalanceGram > combinedGram) {
      throw new BadRequestException(
        `applyBalanceGram (${applyBalanceGram}g) cannot exceed total issue weight (${combinedGram}g).`,
      );
    }

    const effectiveGram = combinedGram - applyBalanceGram;
    if (effectiveGram <= 0) {
      throw new BadRequestException(
        'Effective issued weight after balance apply must be greater than zero.',
      );
    }
    const effectiveW = WeightUtil.fromGram(effectiveGram);

    // ── Resolve rate ──────────────────────────────────────────────────────────
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

    const expectedWeightGram = orderLine
      ? Number(orderLine.expectedWeightGram)
      : null;

    // ── Create issue + source rows + flip statuses in one transaction ─────────
    return this.prisma.$transaction(async (tx) => {
      if (applyBalanceGram > 0) {
        const result = await tx.karigarMetalBalance.updateMany({
          where: {
            karigarId:   order.karigarId,
            metalTypeId: dto.metalTypeId,
            balanceGram: { gte: applyBalanceGram },
          },
          data: { balanceGram: { decrement: applyBalanceGram } },
        });
        if (result.count !== 1) {
          throw new ConflictException(
            'Pending metal balance is insufficient or changed — refresh and try again.',
          );
        }
      }

      const productionIssue = await tx.productionIssue.create({
        data: {
          productionOrderId:      dto.productionOrderId,
          metalTypeId:            dto.metalTypeId,
          issuedWeightGram:       effectiveW.gram,
          issuedWeightTola:       effectiveW.tola,
          issuedWeightLal:        effectiveW.lal,
          appliedFromBalanceGram: applyBalanceGram > 0 ? applyBalanceGram : undefined,
          rateAtIssuePerGram:     rateAtIssue,
        },
        include: {
          metalType:       true,
          productionOrder: { include: { karigar: true } },
        },
      });

      if (hasSourceItems) {
        // Atomic status flip & IN_STOCK check
        const result = await tx.stockItem.updateMany({
          where: { id: { in: uniqueSourceIds }, status: 'IN_STOCK' },
          data:  { status: 'IN_REMAKE' },
        });
        if (result.count !== uniqueSourceIds.length) {
          throw new ConflictException(
            'One or more source items are no longer available for remake.',
          );
        }

        // Create one ProductionIssueSourceItem per source item
        await tx.productionIssueSourceItem.createMany({
          data: sourceStockItems.map((s) => ({
            productionIssueId: productionIssue.id,
            stockItemId:       s.id,
            weightAtIssueGram: Number(s.grossWeightGram),
          })),
        });
      }

      if (orderLine) {
        const allowedLossGram = effectiveGram - expectedWeightGram!;
        const flip = await tx.productionOrderLine.updateMany({
          where: {
            id:                orderLine.id,
            status:            'PENDING',
            productionOrderId: dto.productionOrderId,
          },
          data: {
            status:            'ISSUED',
            productionIssueId: productionIssue.id,
            allowedLossGram,
          },
        });
        if (flip.count !== 1) {
          throw new ConflictException(
            'Production order line is no longer pending — refresh and try again.',
          );
        }
      }

      return {
        ...productionIssue,
        // Expose breakdown for caller convenience
        rawWeightGram:          rawW.gram,
        sourceWeightGram,
        combinedWeightGram:     combinedGram,
        appliedFromBalanceGram: applyBalanceGram,
        effectiveWeightGram:    effectiveGram,
        sourceItemsCount:       sourceStockItems.length,
        ...(orderLine
          ? {
              productionOrderLineId: orderLine.id,
              allowedLossGram:       effectiveGram - expectedWeightGram!,
            }
          : {}),
      };
    });
  }

  /**
   * Issue metal for multiple production order lines independently.
   * One line failing does not block others in the same request.
   */
  async issueProductionOrderLinesBatch(
    orderId: string,
    dto: IssueProductionOrderLinesBatchDto,
  ) {
    const order = await this.prisma.productionOrder.findUnique({
      where: { id: orderId },
    });
    if (!order) throw new NotFoundException(`ProductionOrder ${orderId} not found`);

    const results: Array<{
      productionOrderLineId: string;
      success: boolean;
      error?: string;
      issue?: unknown;
    }> = [];

    for (const item of dto.lines) {
      try {
        const line = await this.prisma.productionOrderLine.findUnique({
          where: { id: item.productionOrderLineId },
        });
        if (!line) {
          throw new NotFoundException(
            `ProductionOrderLine ${item.productionOrderLineId} not found`,
          );
        }

        const issue = await this.createProductionIssue({
          productionOrderId:     orderId,
          metalTypeId:           line.metalTypeId,
          productionOrderLineId: item.productionOrderLineId,
          issuedWeight:          item.issuedWeight,
        });

        results.push({
          productionOrderLineId: item.productionOrderLineId,
          success:                 true,
          issue,
        });
      } catch (err: any) {
        const message =
          err?.response?.message ?? err?.message ?? 'Issue failed';
        results.push({
          productionOrderLineId: item.productionOrderLineId,
          success:                 false,
          error:                   Array.isArray(message) ? message.join('; ') : String(message),
        });
      }
    }

    return results;
  }

  /**
   * Weigh-in a single production order line — records result, does NOT create stock.
   */
  async weighInProductionOrderLine(
    lineId: string,
    dto: WeighInProductionOrderLineDto,
  ) {
    const line = await this.prisma.productionOrderLine.findUnique({
      where:   { id: lineId },
      include: {
        productionOrder: true,
        productionIssue: true,
      },
    });
    if (!line) {
      throw new NotFoundException(`ProductionOrderLine ${lineId} not found`);
    }
    if (line.status !== 'ISSUED') {
      throw new ConflictException(
        `Production order line must be ISSUED to weigh in (current: ${line.status})`,
      );
    }
    if (line.productionOrder.status !== 'OPEN') {
      throw new BadRequestException('Can only weigh in lines on OPEN production orders');
    }
    if (!line.productionIssue) {
      throw new BadRequestException('Line has no linked production issue');
    }
    if (line.allowedLossGram == null) {
      throw new BadRequestException('Line is missing allowedLossGram from issue step');
    }

    const issuedGram = Number(line.productionIssue.issuedWeightGram);
    const actualW    = WeightUtil.from(dto.actualWeight.value, dto.actualWeight.unit);
    const actualWeightGram = actualW.gram;

    if (actualWeightGram > issuedGram + WEIGHT_EPSILON) {
      throw new BadRequestException('Actual weight cannot exceed issued weight');
    }

    const allowedLossGram = Number(line.allowedLossGram);
    const actualLossGram  = issuedGram - actualWeightGram;
    const actualLossW     = WeightUtil.fromGram(actualLossGram);
    const returnedW       = actualW;

    const isSurplusBranch = actualLossGram <= allowedLossGram + WEIGHT_EPSILON;

    return this.prisma.$transaction(async (tx) => {
      let lineSurplusGram = 0;
      let lineDeficitGram = 0;
      let uncoveredDeficitGram = 0;
      let dispute: Awaited<ReturnType<typeof tx.karigarDispute.create>> | null = null;

      if (isSurplusBranch) {
        lineSurplusGram = allowedLossGram - actualLossGram;
        lineDeficitGram = 0;
        if (lineSurplusGram > WEIGHT_EPSILON) {
          await this.incrementMetalPool(
            tx,
            line.productionOrderId,
            line.metalTypeId,
            lineSurplusGram,
          );
        }
      } else {
        const rawDeficitGram = actualLossGram - allowedLossGram;
        lineSurplusGram = 0;

        const poolRow = await tx.productionOrderMetalPool.findUnique({
          where: {
            productionOrderId_metalTypeId: {
              productionOrderId: line.productionOrderId,
              metalTypeId:       line.metalTypeId,
            },
          },
        });

        const poolSurplus = poolRow ? Number(poolRow.pooledSurplusGram) : 0;
        const coverable   = Math.min(rawDeficitGram, poolSurplus);
        let coverApplied  = 0;

        if (coverable > WEIGHT_EPSILON && poolRow) {
          const poolUpdate = await tx.productionOrderMetalPool.updateMany({
            where: {
              id:                poolRow.id,
              pooledSurplusGram: { gte: coverable },
            },
            data: { pooledSurplusGram: { decrement: coverable } },
          });
          if (poolUpdate.count === 1) {
            coverApplied = coverable;
          }
        }

        uncoveredDeficitGram = rawDeficitGram - coverApplied;
        lineDeficitGram      = uncoveredDeficitGram;
      }

      const withinTolerance = uncoveredDeficitGram <= WEIGHT_EPSILON;

      let productionReturn;
      try {
        productionReturn = await tx.productionReturn.create({
          data: {
            productionOrderId:     line.productionOrderId,
            productionIssueId:     line.productionIssueId!,
            productionOrderLineId: line.id,
            returnedWeightGram:    returnedW.gram,
            returnedWeightTola:    returnedW.tola,
            returnedWeightLal:     returnedW.lal,
            kharcharGram:          actualLossW.gram,
            kharcharTola:          actualLossW.tola,
            kharcharLal:           actualLossW.lal,
            withinTolerance,
          },
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          throw new ConflictException(
            'A return already exists for this production issue.',
          );
        }
        throw error;
      }

      if (uncoveredDeficitGram > WEIGHT_EPSILON) {
        const excessW = WeightUtil.fromGram(uncoveredDeficitGram);
        dispute = await tx.karigarDispute.create({
          data: {
            karigarId:             line.productionOrder.karigarId,
            productionOrderId:     line.productionOrderId,
            productionIssueId:     line.productionIssueId!,
            metalTypeId:           line.metalTypeId,
            productionOrderLineId: line.id,
            excessWeightGram:      excessW.gram,
            excessWeightTola:      excessW.tola,
            excessWeightLal:       excessW.lal,
            status:                'PENDING',
          },
        });
      }

      const flip = await tx.productionOrderLine.updateMany({
        where: { id: lineId, status: 'ISSUED' },
        data: {
          status:             'WEIGHED',
          actualWeightGram,
          lineLossGram:       actualLossGram,
          lineSurplusGram:    lineSurplusGram > WEIGHT_EPSILON ? lineSurplusGram : 0,
          lineDeficitGram:    lineDeficitGram > WEIGHT_EPSILON ? lineDeficitGram : 0,
          productionReturnId: productionReturn.id,
          disputeId:          dispute?.id ?? null,
        },
      });
      if (flip.count !== 1) {
        throw new ConflictException(
          'Production order line is no longer issued — refresh and try again.',
        );
      }

      return {
        lineId,
        status:               'WEIGHED',
        actualWeightGram,
        lineLossGram:         actualLossGram,
        lineSurplusGram:      lineSurplusGram > WEIGHT_EPSILON ? lineSurplusGram : 0,
        lineDeficitGram:      lineDeficitGram > WEIGHT_EPSILON ? lineDeficitGram : 0,
        withinTolerance,
        productionReturnId:   productionReturn.id,
        disputeId:            dispute?.id ?? null,
        productionReturn,
        dispute,
      };
    });
  }

  /**
   * Weigh-in multiple lines independently — one failure does not block others.
   */
  async weighInProductionOrderLinesBatch(dto: WeighInProductionOrderLinesBatchDto) {
    const results: Array<{
      productionOrderLineId: string;
      success: boolean;
      error?: string;
      result?: unknown;
    }> = [];

    for (const item of dto.lines) {
      try {
        const result = await this.weighInProductionOrderLine(
          item.productionOrderLineId,
          { actualWeight: item.actualWeight },
        );
        results.push({
          productionOrderLineId: item.productionOrderLineId,
          success:               true,
          result,
        });
      } catch (err: any) {
        const message =
          err?.response?.message ?? err?.message ?? 'Weigh-in failed';
        results.push({
          productionOrderLineId: item.productionOrderLineId,
          success:               false,
          error:                 Array.isArray(message) ? message.join('; ') : String(message),
        });
      }
    }

    return results;
  }

  /**
   * Undo a weigh-in so the line can be weighed again — blocked when a dispute exists.
   */
  async correctWeighInProductionOrderLine(lineId: string) {
    const line = await this.prisma.productionOrderLine.findUnique({
      where:   { id: lineId },
      include: {
        productionReturn: true,
        productionIssue:  true,
      },
    });
    if (!line) {
      throw new NotFoundException(`ProductionOrderLine ${lineId} not found`);
    }
    if (line.status !== 'WEIGHED') {
      throw new ConflictException(
        `Can only correct weigh-in on WEIGHED lines (current: ${line.status})`,
      );
    }
    if (line.disputeId) {
      throw new ConflictException(
        'Cannot correct weigh-in while a dispute exists — resolve the dispute first.',
      );
    }
    if (!line.productionReturnId || !line.productionReturn) {
      throw new BadRequestException('Line has no production return to correct');
    }

    const returnId = line.productionReturnId;
    const lineSurplus = Number(line.lineSurplusGram ?? 0);
    const lineDeficit = Number(line.lineDeficitGram ?? 0);
    const allowedLoss = Number(line.allowedLossGram ?? 0);

    return this.prisma.$transaction(async (tx) => {
      if (lineSurplus > WEIGHT_EPSILON) {
        const dec = await tx.productionOrderMetalPool.updateMany({
          where: {
            productionOrderId: line.productionOrderId,
            metalTypeId:       line.metalTypeId,
            pooledSurplusGram: { gte: lineSurplus },
          },
          data: { pooledSurplusGram: { decrement: lineSurplus } },
        });
        if (dec.count !== 1) {
          throw new ConflictException(
            'This surplus has already been partially used by another line and can\'t be fully reversed.',
          );
        }
      } else if (
        line.productionIssue &&
        line.actualWeightGram != null &&
        lineSurplus <= WEIGHT_EPSILON
      ) {
        const issuedGram       = Number(line.productionIssue.issuedWeightGram);
        const actualWeightGram = Number(line.actualWeightGram);
        const actualLossGram   = issuedGram - actualWeightGram;
        if (actualLossGram > allowedLoss + WEIGHT_EPSILON) {
          const rawDeficit      = actualLossGram - allowedLoss;
          const coveredFromPool = rawDeficit - lineDeficit;
          if (coveredFromPool > WEIGHT_EPSILON) {
            await this.incrementMetalPool(
              tx,
              line.productionOrderId,
              line.metalTypeId,
              coveredFromPool,
            );
          }
        }
      }

      const unlinkLine = await tx.productionOrderLine.updateMany({
        where: {
          id:       lineId,
          status:   'WEIGHED',
          disputeId: null,
        },
        data: {
          productionReturnId: null,
          actualWeightGram:   null,
          lineLossGram:       null,
          lineSurplusGram:    null,
          lineDeficitGram:    null,
          status:             'ISSUED',
        },
      });
      if (unlinkLine.count !== 1) {
        throw new ConflictException(
          'Line state changed — refresh and try again.',
        );
      }

      await tx.productionReturn.update({
        where: { id: returnId },
        data:  { productionOrderLineId: null },
      });

      await tx.productionReturn.delete({ where: { id: returnId } });

      return {
        lineId,
        status:              'ISSUED',
        productionReturnId:  null,
      };
    });
  }

  /**
   * Approve a weighed line — creates ProductionItem + StockItem (only step that touches stock).
   */
  async approveProductionOrderLine(lineId: string) {
    const line = await this.prisma.productionOrderLine.findUnique({
      where:   { id: lineId },
      include: {
        productionIssue: { include: { sourceItems: true } },
        productionReturn: true,
      },
    });
    if (!line) {
      throw new NotFoundException(`ProductionOrderLine ${lineId} not found`);
    }
    if (line.status !== 'WEIGHED') {
      throw new ConflictException(
        `Production order line must be WEIGHED to approve (current: ${line.status})`,
      );
    }
    if (!line.productionReturnId || !line.productionReturn) {
      throw new BadRequestException('Line has no production return — weigh in first');
    }
    if (line.actualWeightGram == null) {
      throw new BadRequestException('Line is missing actualWeightGram from weigh-in');
    }

    const hasSourceItems = (line.productionIssue?.sourceItems.length ?? 0) > 0;
    const stockOrigin: 'REMAKE' | 'KARIGAR' = hasSourceItems ? 'REMAKE' : 'KARIGAR';
    const weightGram = Number(line.actualWeightGram);
    const itemW      = WeightUtil.fromGram(weightGram);

    return this.prisma.$transaction(async (tx) => {
      let stockStatus: 'IN_STOCK' | 'UNDER_DISPUTE' = 'IN_STOCK';
      if (line.disputeId) {
        const dispute = await tx.karigarDispute.findUnique({
          where: { id: line.disputeId },
        });
        if (dispute?.status === 'PENDING') {
          stockStatus = 'UNDER_DISPUTE';
        }
      }

      const productionItem = await tx.productionItem.create({
        data: {
          productionReturnId: line.productionReturnId!,
          description:        line.description,
          grossWeightGram:    itemW.gram,
          grossWeightTola:    itemW.tola,
          grossWeightLal:     itemW.lal,
        },
      });

      const stockItem = await this.createStockItemFromProduction(tx, {
        origin:           stockOrigin,
        categoryId:       line.categoryId,
        metalTypeId:      line.metalTypeId,
        karat:            line.karat,
        weightGram,
        productionItemId: productionItem.id,
        status:           stockStatus,
        name:             line.description,
      });

      if (hasSourceItems && line.productionIssue) {
        for (const sourceItem of line.productionIssue.sourceItems) {
          await tx.stockItem.update({
            where: { id: sourceItem.stockItemId },
            data:  {
              status:                'REMADE',
              remadeIntoStockItemId: stockItem.id,
            },
          });
        }
      }

      const flip = await tx.productionOrderLine.updateMany({
        where: { id: lineId, status: 'WEIGHED' },
        data:  {
          status:      'APPROVED',
          stockItemId: stockItem.id,
        },
      });
      if (flip.count !== 1) {
        throw new ConflictException(
          'Production order line is no longer weighed — refresh and try again.',
        );
      }

      return {
        lineId,
        status:         'APPROVED',
        stockItemId:    stockItem.id,
        stockItem,
        productionItem,
        origin:         stockOrigin,
      };
    });
  }

  /**
   * Approve multiple lines independently — one failure does not block others.
   */
  async approveProductionOrderLinesBatch(
    dto: ApproveProductionOrderLinesBatchDto,
  ) {
    const results: Array<{
      productionOrderLineId: string;
      success: boolean;
      error?: string;
      result?: unknown;
    }> = [];

    for (const item of dto.lines) {
      try {
        const result = await this.approveProductionOrderLine(
          item.productionOrderLineId,
        );
        results.push({
          productionOrderLineId: item.productionOrderLineId,
          success:               true,
          result,
        });
      } catch (err: any) {
        const message =
          err?.response?.message ?? err?.message ?? 'Approve failed';
        results.push({
          productionOrderLineId: item.productionOrderLineId,
          success:               false,
          error:                 Array.isArray(message) ? message.join('; ') : String(message),
        });
      }
    }

    return results;
  }

  private async incrementMetalPool(
    tx: Prisma.TransactionClient,
    productionOrderId: string,
    metalTypeId: string,
    amountGram: number,
  ) {
    await tx.productionOrderMetalPool.upsert({
      where: {
        productionOrderId_metalTypeId: { productionOrderId, metalTypeId },
      },
      create: {
        productionOrderId,
        metalTypeId,
        pooledSurplusGram: amountGram,
      },
      update: {
        pooledSurplusGram: { increment: amountGram },
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
   *    ("issued" includes both raw metal AND source items' weight)
   * 2. Check if within tolerance
   * 3. If over tolerance → create KarigarDispute automatically
   * 4. Create ProductionItem per piece → StockItem
   *    - origin = REMAKE if the issue had source items, else KARIGAR
   * 5. If source items exist, flip each one IN_REMAKE → REMADE and
   *    set remadeIntoStockItemId = first new piece's id (best-effort pointer;
   *    V1 limitation — see schema comment for exact traceability via join table)
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
      where:   { id: dto.productionIssueId },
      include: {
        sourceItems: true,  // load source items for remake detection
      },
    });
    if (!issue) throw new NotFoundException(`ProductionIssue ${dto.productionIssueId} not found`);

    if (issue.productionOrderId !== dto.productionOrderId) {
      throw new BadRequestException(
        'productionIssueId does not belong to this productionOrderId',
      );
    }

    const existingReturn = await this.prisma.productionReturn.findFirst({
      where: { productionIssueId: dto.productionIssueId },
    });
    if (existingReturn) {
      throw new ConflictException(
        'A return already exists for this production issue. ' +
        'Create a new production issue for additional returns.',
      );
    }

    const returnedW = WeightUtil.from(dto.returnedWeight.value, dto.returnedWeight.unit);

    const itemsTotal = dto.items.reduce((sum, item) => {
      const w = WeightUtil.from(item.grossWeight.value, item.grossWeight.unit);
      return sum + w.gram;
    }, 0);

    const returnedGram = returnedW.gram;
    if (Math.abs(itemsTotal - returnedGram) > WEIGHT_EPSILON) {
      throw new BadRequestException(
        `Sum of item weights (${itemsTotal.toFixed(4)}g) does not match ` +
        `returnedWeight (${returnedGram.toFixed(4)}g). ` +
        `Difference: ${Math.abs(itemsTotal - returnedGram).toFixed(4)}g`,
      );
    }

    // issuedGram = raw metal + source items (already combined on the issue record)
    const issuedGram = Number(issue.issuedWeightGram);

    if (returnedGram > issuedGram) {
      throw new BadRequestException('Returned weight cannot exceed issued weight');
    }

    // Calculate kharchar (wastage)
    const kharcharGram = issuedGram - returnedW.gram;
    const kharcharW    = WeightUtil.fromGram(kharcharGram);

    // Check tolerance — absolute gram override takes precedence when set
    const maxAllowedWaste = order.toleranceGram != null
      ? Number(order.toleranceGram)
      : (issuedGram * Number(order.tolerancePct)) / 100;
    const withinTolerance = kharcharGram <= maxAllowedWaste + WEIGHT_EPSILON;

    // Determine origin: REMAKE when source items exist, KARIGAR otherwise
    const hasSourceItems = issue.sourceItems.length > 0;
    const stockOrigin: 'REMAKE' | 'KARIGAR' = hasSourceItems ? 'REMAKE' : 'KARIGAR';

    const duplicateReturnMessage =
      'A return already exists for this production issue. ' +
      'Create a new production issue for additional returns.';

    return this.prisma.$transaction(async (tx) => {
      // 1. Create production return record
      let productionReturn;
      try {
        productionReturn = await tx.productionReturn.create({
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
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          throw new ConflictException(duplicateReturnMessage);
        }
        throw error;
      }

      // 2. Create stock item for each finished piece
      const createdStockItemIds: string[] = [];

      for (const item of dto.items) {
        const itemW = WeightUtil.from(item.grossWeight.value, item.grossWeight.unit);

        const productionItem = await tx.productionItem.create({
          data: {
            productionReturnId: productionReturn.id,
            description:        item.description,
            grossWeightGram:    itemW.gram,
            grossWeightTola:    itemW.tola,
            grossWeightLal:     itemW.lal,
          },
        });

        const stockItem = await this.createStockItemFromProduction(tx, {
          origin:           stockOrigin,
          categoryId:       await this.getDefaultCategoryId(tx),
          metalTypeId:      issue.metalTypeId,
          weightGram:       itemW.gram,
          productionItemId: productionItem.id,
          status:           withinTolerance ? 'IN_STOCK' : 'UNDER_DISPUTE',
          name:             item.description,
        });

        createdStockItemIds.push(stockItem.id);
      }

      // 3. If over tolerance → auto-create dispute
      let dispute = null;
      if (!withinTolerance) {
        const excessGram = kharcharGram - maxAllowedWaste;
        const excessW    = WeightUtil.fromGram(excessGram);

        dispute = await tx.karigarDispute.create({
          data: {
            karigarId:         order.karigarId,
            productionOrderId: dto.productionOrderId,
            productionIssueId: dto.productionIssueId,
            metalTypeId:       issue.metalTypeId,
            excessWeightGram:  excessW.gram,
            excessWeightTola:  excessW.tola,
            excessWeightLal:   excessW.lal,
            status:            'PENDING',
          },
        });
      }

      // 4. If this was a remake job, flip source items → REMADE and link to
      //    the first returned piece (best-effort pointer for quick UI display).
      //    V1 limitation: if multiple new pieces are returned, all source items
      //    point to the first piece. Use ProductionIssueSourceItem ↔
      //    ProductionReturn as the authoritative traceability record.
      if (hasSourceItems && createdStockItemIds.length > 0) {
        const firstNewStockItemId = createdStockItemIds[0];

        for (const sourceItem of issue.sourceItems) {
          await tx.stockItem.update({
            where: { id: sourceItem.stockItemId },
            data: {
              status:               'REMADE',
              remadeIntoStockItemId: firstNewStockItemId,
            },
          });
        }
      }

      return {
        productionReturn: {
          ...productionReturn,
          returnedWeight: WeightUtil.forBill(returnedW.gram),
          kharcharWeight: WeightUtil.forBill(kharcharW.gram),
          withinTolerance,
          tolerancePct: Number(order.tolerancePct),
          toleranceGram: order.toleranceGram != null ? Number(order.toleranceGram) : null,
          maxAllowedWasteGram: maxAllowedWaste.toFixed(4),
        },
        dispute,
        stockItemsCreated: dto.items.length,
        origin:            stockOrigin,
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
        metalType:       { select: { id: true, name: true } },
        line: {
          select: { id: true, description: true },
        },
        productionIssue: {
          select: { id: true, issuedAt: true },
        },
      },
    });
  }

  /**
   * Resolve a dispute — owner sets deduction amount (cash) or carry forward as metal owed.
   * Marks dispute as RESOLVED.
   * Cash deduction is applied manually in the next KarigarPayment.
   */
  async resolveDispute(disputeId: string, dto: ResolveDisputeDto, userId: string) {
    const dispute = await this.prisma.karigarDispute.findUnique({
      where: { id: disputeId },
    });
    if (!dispute) throw new NotFoundException(`Dispute ${disputeId} not found`);
    if (dispute.status === 'RESOLVED') {
      throw new ConflictException('Dispute is already resolved');
    }

    const resolutionType = dto.resolutionType ?? 'CASH_DEDUCTION';

    if (resolutionType === 'METAL_CARRYFORWARD') {
      if (!dispute.metalTypeId) {
        throw new BadRequestException(
          "This dispute predates metal-type tracking and can't be carried forward as metal — resolve with a cash deduction instead.",
        );
      }
    } else if (dto.deductionNpr === undefined || dto.deductionNpr === null) {
      throw new BadRequestException('deductionNpr is required for CASH_DEDUCTION');
    }

    return this.prisma.$transaction(async (tx) => {
      if (resolutionType === 'METAL_CARRYFORWARD') {
        const excessGram = Number(dispute.excessWeightGram);
        await tx.karigarMetalBalance.upsert({
          where: {
            karigarId_metalTypeId: {
              karigarId:   dispute.karigarId,
              metalTypeId: dispute.metalTypeId!,
            },
          },
          create: {
            karigarId:   dispute.karigarId,
            metalTypeId: dispute.metalTypeId!,
            balanceGram: excessGram,
          },
          update: {
            balanceGram: { increment: excessGram },
          },
        });
      }

      const resolved = await tx.karigarDispute.update({
        where: { id: disputeId },
        data:  {
          resolutionType,
          deductionNpr:     resolutionType === 'CASH_DEDUCTION' ? dto.deductionNpr : null,
          resolutionNotes:  dto.resolutionNotes,
          status:           'RESOLVED',
          resolvedAt:       new Date(),
          resolvedByUserId: userId,
        },
      });

      // Lift UNDER_DISPUTE stock only for this dispute's issue (legacy: whole order).
      const productionItems = await tx.productionItem.findMany({
        where: {
          productionReturn: dispute.productionIssueId
            ? { productionIssueId: dispute.productionIssueId }
            : { productionOrderId: dispute.productionOrderId },
        },
        select: { id: true },
      });

      if (productionItems.length > 0) {
        await tx.stockItem.updateMany({
          where: {
            productionItemId: { in: productionItems.map(pi => pi.id) },
            status:           'UNDER_DISPUTE',
          },
          data: { status: 'IN_STOCK' },
        });
      }

      return resolved;
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

    const lines = order.lines?.map((line: any) => this.formatProductionOrderLine(line)) ?? [];
    const metalPools = order.metalPools?.map((pool: any) => ({
      id:                pool.id,
      metalTypeId:       pool.metalTypeId,
      metalType:         pool.metalType,
      pooledSurplusGram: Number(pool.pooledSurplusGram),
    })) ?? [];

    return {
      ...order,
      lines,
      metalPools,
      weightSummary: {
        totalIssued:   WeightUtil.forBill(totalIssuedGram),
        totalReturned: WeightUtil.forBill(totalReturnedGram),
        totalKharchar: WeightUtil.forBill(Math.max(0, totalIssuedGram - totalReturnedGram)),
      },
    };
  }

  private formatProductionOrderLine(line: any) {
    return {
      id:                      line.id,
      productionOrderId:       line.productionOrderId,
      description:             line.description,
      category:                line.category,
      metalType:               line.metalType,
      karat:                   line.karat,
      expectedWeightGram:      Number(line.expectedWeightGram),
      plannedIssuedWeightGram: Number(line.plannedIssuedWeightGram),
      status:                  line.status,
      allowedLossGram:         line.allowedLossGram != null
        ? Number(line.allowedLossGram)
        : null,
      issue: line.productionIssue
        ? {
            id:                 line.productionIssue.id,
            issuedWeightGram:   Number(line.productionIssue.issuedWeightGram),
            rateAtIssuePerGram: Number(line.productionIssue.rateAtIssuePerGram),
            issuedAt:           line.productionIssue.issuedAt,
          }
        : null,
      actualWeightGram: line.actualWeightGram != null
        ? Number(line.actualWeightGram)
        : null,
      lineLossGram: line.lineLossGram != null ? Number(line.lineLossGram) : null,
      lineSurplusGram: line.lineSurplusGram != null
        ? Number(line.lineSurplusGram)
        : null,
      lineDeficitGram: line.lineDeficitGram != null
        ? Number(line.lineDeficitGram)
        : null,
      disputeId:          line.disputeId,
      stockItemId:        line.stockItemId,
      productionIssueId:  line.productionIssueId,
      productionReturnId: line.productionReturnId,
      ...(line.productionOrder
        ? { productionOrder: line.productionOrder }
        : {}),
      createdAt: line.createdAt,
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

  private async createStockItemFromProduction(
    tx: Prisma.TransactionClient,
    params: {
      origin: 'REMAKE' | 'KARIGAR';
      categoryId: string;
      metalTypeId: string;
      karat?: number | null;
      weightGram: number;
      productionItemId: string;
      status: 'IN_STOCK' | 'UNDER_DISPUTE';
      name?: string | null;
    },
  ) {
    const itemW = WeightUtil.fromGram(params.weightGram);
    const entryRate = await tx.dailyRate.findFirst({
      where:   { isCurrent: true },
      orderBy: { effectiveDate: 'desc' },
    });
    const sku = await this.skuService.generateSku(params.origin, tx);

    return tx.stockItem.create({
      data: {
        sku,
        name:             params.name?.trim() || undefined,
        origin:           params.origin,
        categoryId:       params.categoryId,
        metalTypeId:      params.metalTypeId,
        karat:            params.karat ?? undefined,
        grossWeightGram:  itemW.gram,
        grossWeightTola:  itemW.tola,
        grossWeightLal:   itemW.lal,
        entryRateId:      entryRate?.id,
        productionItemId: params.productionItemId,
        status:           params.status,
      },
    });
  }
}
