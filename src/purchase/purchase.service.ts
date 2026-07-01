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
  CreateSupplierDto,
  UpdateSupplierDto,
  SupplierQueryDto,
  CreatePurchaseOrderDto,
  ReceivePurchaseOrderDto,
  PurchaseOrderQueryDto,
} from './dto/purchase.dto';

@Injectable()
export class PurchaseService {
  constructor(
    private readonly prisma:      PrismaService,
    private readonly skuService:  StockSkuService,
  ) {}

  // ════════════════════════════════════════════════════════════════════════════
  //  SUPPLIER
  // ════════════════════════════════════════════════════════════════════════════

  async createSupplier(dto: CreateSupplierDto) {
    return this.prisma.supplier.create({ data: dto });
  }

  async listSuppliers(query: SupplierQueryDto) {
    const { search, supplierType, isActive, page = 1, limit = 20 } = query;
    const skip  = (page - 1) * limit;
    const where: any = {};

    if (supplierType !== undefined) where.supplierType = supplierType;
    if (isActive     !== undefined) where.isActive     = isActive;
    if (search) {
      where.OR = [
        { name:  { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
      ];
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.supplier.findMany({
        where,
        orderBy: { name: 'asc' },
        skip,
        take:    limit,
        include: { _count: { select: { purchaseOrders: true, trades: true } } },
      }),
      this.prisma.supplier.count({ where }),
    ]);

    return { data: items, meta: { total, page, limit, pages: Math.ceil(total / limit) } };
  }

  async getSupplier(id: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where:   { id },
      include: {
        purchaseOrders: { orderBy: { createdAt: 'desc' }, take: 5 },
        trades:         { orderBy: { createdAt: 'desc' }, take: 5 },
        _count:         { select: { purchaseOrders: true, trades: true } },
      },
    });
    if (!supplier) throw new NotFoundException(`Supplier ${id} not found`);
    return supplier;
  }

  async updateSupplier(id: string, dto: UpdateSupplierDto) {
    await this.findSupplierOrThrow(id);
    return this.prisma.supplier.update({ where: { id }, data: dto });
  }

  async deactivateSupplier(id: string) {
    await this.findSupplierOrThrow(id);

    const pendingCount = await this.prisma.purchaseOrder.count({
      where: { supplierId: id, status: 'PENDING' },
    });
    if (pendingCount > 0) {
      throw new ConflictException('Cannot deactivate supplier with pending purchase orders');
    }

    return this.prisma.supplier.update({
      where: { id },
      data:  { isActive: false },
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  PURCHASE ORDER
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Create a purchase order.
   * Supplier must be DIRECT type.
   * Lines are pre-filled — weight/price editable on receipt.
   */
  async createPurchaseOrder(userId: string, dto: CreatePurchaseOrderDto) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: dto.supplierId },
    });
    if (!supplier) throw new NotFoundException(`Supplier ${dto.supplierId} not found`);
    if (!supplier.isActive) throw new BadRequestException('Supplier is inactive');
    if (supplier.supplierType !== 'DIRECT') {
      throw new BadRequestException(
        'Purchase orders are only for DIRECT suppliers. Use the Trade flow for TRADE suppliers.',
      );
    }

    // Convert weights for each line
    const linesData = dto.lines.map((line) => {
      const grossW = WeightUtil.from(line.grossWeight.value, line.grossWeight.unit);
      const jertyW = line.jertyWeight
        ? WeightUtil.from(line.jertyWeight.value, line.jertyWeight.unit)
        : WeightUtil.fromGram(0);

      return {
        description:     line.description,
        itemName:        line.itemName,
        categoryId:      line.categoryId,
        metalTypeId:     line.metalTypeId,
        karat:           line.karat,
        grossWeightGram: grossW.gram,
        grossWeightTola: grossW.tola,
        grossWeightLal:  grossW.lal,
        jertyGram:       jertyW.gram,
        jertyTola:       jertyW.tola,
        jertyLal:        jertyW.lal,
        priceNpr:        line.priceNpr,
        rateAtPurchasePerGram: line.rateAtPurchasePerGram ?? null,
      };
    });

    const totalNpr = linesData.reduce((sum, l) => sum + l.priceNpr, 0);

    return this.prisma.purchaseOrder.create({
      data: {
        supplierId:      dto.supplierId,
        createdByUserId: userId,
        totalNpr,
        status:          'PENDING',
        notes:           dto.notes,
        purchaseDate: dto.purchaseDate
        ? new Date(`${dto.purchaseDate}T00:00:00.000Z`)
        : new Date(),
        lines:           { create: linesData },
      },
      include: {
        supplier: true,
        lines:    true,
      },
    });
  }

  /**
   * Receive a purchase order — status PENDING → RECEIVED.
   *
   * On receipt:
   * - Line weights/prices can be updated (supplier may vary)
   * - Each line creates one StockItem (origin=PURCHASED)
   * - Total recalculated from actual received prices
   */
  async receivePurchaseOrder(id: string, dto: ReceivePurchaseOrderDto) {
    const po = await this.prisma.purchaseOrder.findUnique({
      where:   { id },
      include: { lines: true },
    });
    if (!po) throw new NotFoundException(`PurchaseOrder ${id} not found`);
    if (po.status !== 'PENDING') {
      throw new ConflictException(`Purchase order is already ${po.status}`);
    }

    // Get today's entry rate for stock items
    const entryRate = await this.prisma.dailyRate.findFirst({
    where:   {
      effectiveDate: { lte: po.purchaseDate },
    },
    orderBy: { effectiveDate: 'desc' },
  });

    return this.prisma.$transaction(async (tx) => {
      let newTotal = new Decimal(0);

      for (const line of po.lines) {
        // Apply any line-level updates from receipt
        const update = dto.lineUpdates?.find((u) => u.lineId === line.id);
        let finalGrossGram = Number(line.grossWeightGram);
        let finalGrossTola = Number(line.grossWeightTola);
        let finalGrossLal  = Number(line.grossWeightLal);
        let finalJertyGram = Number(line.jertyGram);
        let finalJertyTola = Number(line.jertyTola);
        let finalJertyLal  = Number(line.jertyLal);
        let finalPrice     = Number(line.priceNpr);

        if (update) {
          if (update.grossWeight) {
            const w        = WeightUtil.from(update.grossWeight.value, update.grossWeight.unit);
            finalGrossGram = w.gram;
            finalGrossTola = w.tola;
            finalGrossLal  = w.lal;
          }
          if (update.jertyWeight) {
            const w        = WeightUtil.from(update.jertyWeight.value, update.jertyWeight.unit);
            finalJertyGram = w.gram;
            finalJertyTola = w.tola;
            finalJertyLal  = w.lal;
          }
          if (update.priceNpr !== undefined) finalPrice = update.priceNpr;
        }

        newTotal = newTotal.plus(finalPrice);

        // Generate SKU and create stock item
        const sku = await this.skuService.generateSku('PURCHASED', tx);

        const stockItem = await tx.stockItem.create({
          data: {
            sku,
            name:            line.itemName || line.description,
            origin:          'PURCHASED',
            categoryId:      line.categoryId ?? await this.getDefaultCategoryId(tx),
            metalTypeId:     line.metalTypeId,
            karat:           line.karat,
            grossWeightGram: finalGrossGram,
            grossWeightTola: finalGrossTola,
            grossWeightLal:  finalGrossLal,
            jertyGram:       finalJertyGram,
            jertyTola:       finalJertyTola,
            jertyLal:        finalJertyLal,
            entryRateId:     entryRate?.id,
            status:          'IN_STOCK',
          },
        });

        const finalRate = update?.rateAtPurchasePerGram
        ?? Number(line.rateAtPurchasePerGram)   // from order creation
        ?? null;

        // Update line with actual received values + stock item reference
        await tx.purchaseOrderLine.update({
          where: { id: line.id },
          data:  {
            grossWeightGram: finalGrossGram,
            grossWeightTola: finalGrossTola,
            grossWeightLal:  finalGrossLal,
            jertyGram:       finalJertyGram,
            jertyTola:       finalJertyTola,
            jertyLal:        finalJertyLal,
            priceNpr:        finalPrice,
            rateAtPurchasePerGram: finalRate,
            stockItemId:     stockItem.id,
          },
        });
      }

      return tx.purchaseOrder.update({
        where:   { id },
        data:    {
          status:   'RECEIVED',
          totalNpr: newTotal,
          notes:    dto.notes ?? po.notes,
        },
        include: {
          supplier: true,
          lines:    { include: { stockItem: true } },
        },
      });
    });
  }

  async cancelPurchaseOrder(id: string) {
    const po = await this.prisma.purchaseOrder.findUnique({ where: { id } });
    if (!po) throw new NotFoundException(`PurchaseOrder ${id} not found`);
    if (po.status !== 'PENDING') {
      throw new ConflictException(`Only PENDING orders can be cancelled`);
    }

    return this.prisma.purchaseOrder.update({
      where: { id },
      data:  { status: 'CANCELLED' },
    });
  }

  async listPurchaseOrders(query: PurchaseOrderQueryDto) {
    const { supplierId, status, from, to, page = 1, limit = 20 } = query;
    const skip  = (page - 1) * limit;
    const where: any = {};

    if (supplierId) where.supplierId = supplierId;
    if (status)     where.status     = status;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to)   where.createdAt.lte = new Date(to);
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.purchaseOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take:    limit,
        include: {
          supplier:  { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true } },
          _count:    { select: { lines: true } },
        },
      }),
      this.prisma.purchaseOrder.count({ where }),
    ]);

    return { data: items, meta: { total, page, limit, pages: Math.ceil(total / limit) } };
  }

  async getPurchaseOrder(id: string) {
    const po = await this.prisma.purchaseOrder.findUnique({
      where:   { id },
      include: {
        supplier:  true,
        createdBy: { select: { id: true, name: true } },
        lines:     {
          include: {
            stockItem: {
              include: {
                category:  true,
                metalType: true,
                entryRate: true,
              },
            },
          },
        },
      },
    });
    if (!po) throw new NotFoundException(`PurchaseOrder ${id} not found`);
    return po;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private async findSupplierOrThrow(id: string) {
    const s = await this.prisma.supplier.findUnique({ where: { id } });
    if (!s) throw new NotFoundException(`Supplier ${id} not found`);
    return s;
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
