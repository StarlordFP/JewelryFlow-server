import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { BillNumberService } from './bill-number.service';
import { WeightUtil } from '../common/utils/weight.util';
import { Decimal } from '@prisma/client/runtime/library';
import {
  CreateSellDto,
  CreateReturnDto,
  CreateBuybackDto,
  CreateOldGoldDto,
  CreateExchangeDto,
  AddPaymentDto,
  SalesQueryDto,
} from './dto/sales.dto';

const RETURN_WINDOW_DAYS = 7;

@Injectable()
export class SalesService {
  constructor(
    private readonly prisma:       PrismaService,
    private readonly stockService: StockService,
    private readonly billNumber:   BillNumberService,
  ) {}

  // ════════════════════════════════════════════════════════════════════════════
  //  SELL
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Create a SELL transaction.
   *
   * Flow:
   * 1. Validate all stock items are IN_STOCK
   * 2. Get today's sell rate (current DailyRate)
   * 3. Calculate price for each item (via StockService.calculatePrice)
   * 4. Create Transaction + TransactionLines atomically
   * 5. Mark each StockItem as SOLD
   * 6. Record payment, calculate balance
   */
  async createSell(userId: string, dto: CreateSellDto) {
    const { customerId, items, payment, notes } = dto;

    // ── Get today's sell rate ─────────────────────────────────────────────────
    // We'll use the first item's metal type to find today's rate
    const firstItem = await this.prisma.stockItem.findUnique({
      where:   { id: items[0].stockItemId },
      include: { metalType: true, addons: true },
    });
    if (!firstItem) throw new NotFoundException(`StockItem ${items[0].stockItemId} not found`);

    const dailyRate = await this.getCurrentSellRate(firstItem.metalTypeId!);

    return this.prisma.$transaction(async (tx) => {
      const billNum = await this.billNumber.generate(tx);
      let subTotal  = new Decimal(0);
      const lineData: any[] = [];

      // ── Price each item ───────────────────────────────────────────────────
      for (const lineDto of items) {
        const stockItem = await tx.stockItem.findUnique({
          where:   { id: lineDto.stockItemId },
          include: { metalType: true, addons: true },
        });

        if (!stockItem) {
          throw new NotFoundException(`StockItem ${lineDto.stockItemId} not found`);
        }
        if (stockItem.status !== 'IN_STOCK' && stockItem.status !== 'RESERVED') {
          throw new ConflictException(
            `StockItem ${stockItem.sku} is ${stockItem.status} — cannot be sold`,
          );
        }

        // Get rate for this item's metal type
        const itemRate = stockItem.metalTypeId === firstItem.metalTypeId
          ? dailyRate
          : await this.getCurrentSellRate(stockItem.metalTypeId!);

        // Calculate price with optional bill-time overrides
        const pricing = this.stockService.calculatePrice(stockItem, itemRate, {
          jertyOverride: lineDto.jertyOverride,
          jyalaOverride: lineDto.jyalaOverride,
        });

        subTotal = subTotal.plus(pricing.grandTotalNpr);

        lineData.push({
          stockItemId:    stockItem.id,
          grossWeightGram: Number(stockItem.grossWeightGram),
          jertyGram:       parseFloat(pricing.jertyWeight.raw.gram.toFixed(4)),
          billableGram:    parseFloat(pricing.billableWeight.raw.gram.toFixed(4)),
          ratePerGram:     itemRate.sellRatePerGram,
          metalValueNpr:   pricing.metalValueNpr,
          jyalaNpr:        pricing.jyalaCustomerView,
          makingChargeNpr: pricing.jyalaOwnerView.makingCharge,
          stoneChargeNpr:  pricing.jyalaOwnerView.stoneCharge,
          motiChargeNpr:   pricing.jyalaOwnerView.motiCharge,
          malaChargeNpr:   pricing.jyalaOwnerView.malaCharge,
          otherChargeNpr:  pricing.jyalaOwnerView.otherCharge,
          luxuryTaxNpr:    pricing.luxuryTaxNpr,
          vatNpr:          pricing.vatNpr,
          addonValueNpr:   pricing.addonValueNpr,
          lineTotalNpr:    pricing.grandTotalNpr,
        });
      }

      const grandTotal  = subTotal;
      const paidAmount  = new Decimal(payment.amountNpr);
      const balance     = grandTotal.minus(paidAmount);

      // ── Create transaction ────────────────────────────────────────────────
      const txn = await tx.transaction.create({
        data: {
          billNumber:    billNum,
          txType:        'SELL',
          customerId,
          createdByUserId: userId,
          dailyRateId:   dailyRate.id,
          subTotalNpr:   subTotal,
          grandTotalNpr: grandTotal,
          paidAmountNpr: paidAmount,
          balanceNpr:    balance,
          paymentMethod: payment.method,
          returnDeadline: new Date(Date.now() + RETURN_WINDOW_DAYS * 86400000),
          notes,
          lines: {
            create: lineData,
          },
          payments: {
            create: {
              amountNpr: paidAmount,
              method:    payment.method,
              reference: payment.reference,
              notes:     payment.notes,
            },
          },
        },
        include: this.fullTxInclude(),
      });

      // ── Mark stock items as SOLD ──────────────────────────────────────────
      await tx.stockItem.updateMany({
        where: { id: { in: items.map((i) => i.stockItemId) } },
        data:  { status: 'SOLD' },
      });

      return this.formatTxResponse(txn);
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  RETURN
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Create a RETURN transaction.
   *
   * Rules:
   * - Must be within 7 days of original sale
   * - Partial returns allowed (select which items)
   * - Refund calculated at today's buy rate
   * - Stock items go back to IN_STOCK
   */
  async createReturn(userId: string, dto: CreateReturnDto) {
    const { originalTxId, items, refund, notes } = dto;

    const originalTx = await this.prisma.transaction.findUnique({
      where:   { id: originalTxId },
      include: { lines: true },
    });

    if (!originalTx) throw new NotFoundException(`Transaction ${originalTxId} not found`);
    if (originalTx.txType !== 'SELL') {
      throw new BadRequestException('Can only return items from a SELL transaction');
    }

    // ── Check return window ───────────────────────────────────────────────────
    if (originalTx.returnDeadline && new Date() > originalTx.returnDeadline) {
      throw new BadRequestException(
        `Return window expired. Returns must be made within ${RETURN_WINDOW_DAYS} days of purchase.`,
      );
    }

    // ── Validate items belong to original transaction ─────────────────────────
    const originalItemIds = originalTx.lines.map((l) => l.stockItemId);
    for (const item of items) {
      if (!originalItemIds.includes(item.stockItemId)) {
        throw new BadRequestException(
          `StockItem ${item.stockItemId} is not part of transaction ${originalTxId}`,
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const billNum = await this.billNumber.generate(tx);
      let refundTotal = new Decimal(0);
      const lineData: any[] = [];

      for (const returnItem of items) {
        const stockItem = await tx.stockItem.findUnique({
          where:   { id: returnItem.stockItemId },
          include: { metalType: true, addons: true },
        });

        if (!stockItem) throw new NotFoundException(`StockItem ${returnItem.stockItemId} not found`);

        // Get today's buy rate for refund calculation
        const buyRate = await this.getCurrentBuyRate(stockItem.metalTypeId!);

        const pricing = this.stockService.calculatePrice(stockItem, {
          ...buyRate,
          // Use buy rate for return valuation
          sellRatePerGram: buyRate.buyRatePerGram,
        });

        refundTotal = refundTotal.plus(pricing.grandTotalNpr);

        lineData.push({
          stockItemId:     stockItem.id,
          grossWeightGram: Number(stockItem.grossWeightGram),
          jertyGram:       Number(stockItem.jertyGram),
          billableGram:    Number(stockItem.grossWeightGram) + Number(stockItem.jertyGram),
          ratePerGram:     buyRate.buyRatePerGram,
          metalValueNpr:   pricing.metalValueNpr,
          jyalaNpr:        pricing.jyalaCustomerView,
          makingChargeNpr: pricing.jyalaOwnerView.makingCharge,
          stoneChargeNpr:  pricing.jyalaOwnerView.stoneCharge,
          motiChargeNpr:   pricing.jyalaOwnerView.motiCharge,
          malaChargeNpr:   pricing.jyalaOwnerView.malaCharge,
          otherChargeNpr:  pricing.jyalaOwnerView.otherCharge,
          luxuryTaxNpr:    pricing.luxuryTaxNpr,
          vatNpr:          pricing.vatNpr,
          addonValueNpr:   pricing.addonValueNpr,
          lineTotalNpr:    pricing.grandTotalNpr,
        });
      }

      const txn = await tx.transaction.create({
        data: {
          billNumber:      billNum,
          txType:          'RETURN',
          customerId:      originalTx.customerId,
          createdByUserId: userId,
          relatedTxId:     originalTxId,
          subTotalNpr:     refundTotal,
          grandTotalNpr:   refundTotal,
          paidAmountNpr:   refundTotal, // full refund
          balanceNpr:      new Decimal(0),
          paymentMethod:   refund.method,
          notes,
          lines: { create: lineData },
          payments: {
            create: {
              amountNpr: refundTotal,
              method:    refund.method,
              reference: refund.reference,
              notes:     refund.notes,
            },
          },
        },
        include: this.fullTxInclude(),
      });

      // ── Return stock items to IN_STOCK ────────────────────────────────────
      await tx.stockItem.updateMany({
        where: { id: { in: items.map((i) => i.stockItemId) } },
        data:  { status: 'IN_STOCK' },
      });

      return this.formatTxResponse(txn);
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  EXCHANGE
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Create an EXCHANGE transaction.
   *
   * Flow:
   * - Items IN (returned by customer) → valued at today's buy rate
   * - Items OUT (taken by customer) → priced at today's sell rate
   * - Cash difference = OUT total - IN total
   * - Two linked transactions created (one RETURN-like, one SELL-like)
   * - Paired via exchangeGroupId
   */
  async createExchange(userId: string, dto: CreateExchangeDto) {
    const { customerId, itemsIn, itemsOut, payment, notes } = dto;
    const exchangeGroupId = `EXG-${Date.now()}`;

    return this.prisma.$transaction(async (tx) => {
      let inTotal  = new Decimal(0);
      let outTotal = new Decimal(0);

      // ── Value items coming IN (at buy rate) ───────────────────────────────
      const inLineData: any[] = [];

      for (const inItem of itemsIn) {
        if (inItem.stockItemId) {
          // Shop item being returned
          const stockItem = await tx.stockItem.findUnique({
            where:   { id: inItem.stockItemId },
            include: { metalType: true, addons: true },
          });
          if (!stockItem) throw new NotFoundException(`StockItem ${inItem.stockItemId} not found`);

          const buyRate = await this.getCurrentBuyRate(stockItem.metalTypeId!);
          const pricing = this.stockService.calculatePrice(stockItem, {
            ...buyRate,
            sellRatePerGram: buyRate.buyRatePerGram,
          });

          inTotal = inTotal.plus(pricing.grandTotalNpr);
          inLineData.push(this.buildLineData(stockItem, buyRate.buyRatePerGram, pricing));

          await tx.stockItem.update({
            where: { id: inItem.stockItemId },
            data:  { status: 'RETURNED' },
          });

        } else if (inItem.oldGoldWeight && inItem.oldGoldMetalTypeId) {
          // Old gold — weighed and valued at buy rate
          const buyRate   = await this.getCurrentBuyRate(inItem.oldGoldMetalTypeId);
          const weightVal = WeightUtil.from(inItem.oldGoldWeight.value, inItem.oldGoldWeight.unit);
          const metalVal  = weightVal.gram * Number(buyRate.buyRatePerGram);

          inTotal = inTotal.plus(metalVal);
          inLineData.push({
            stockItemId:     null,
            grossWeightGram: weightVal.gram,
            jertyGram:       0,
            billableGram:    weightVal.gram,
            ratePerGram:     buyRate.buyRatePerGram,
            metalValueNpr:   metalVal.toFixed(2),
            jyalaNpr:        '0.00',
            makingChargeNpr: '0.00',
            stoneChargeNpr:  '0.00',
            motiChargeNpr:   '0.00',
            malaChargeNpr:   '0.00',
            otherChargeNpr:  '0.00',
            luxuryTaxNpr:    '0.00',
            vatNpr:          '0.00',
            addonValueNpr:   '0.00',
            lineTotalNpr:    metalVal.toFixed(2),
          });
        }
      }

      // ── Price items going OUT (at sell rate) ──────────────────────────────
      const outLineData: any[] = [];

      for (const outItem of itemsOut) {
        const stockItem = await tx.stockItem.findUnique({
          where:   { id: outItem.stockItemId },
          include: { metalType: true, addons: true },
        });
        if (!stockItem) throw new NotFoundException(`StockItem ${outItem.stockItemId} not found`);
        if (stockItem.status !== 'IN_STOCK' && stockItem.status !== 'RESERVED') {
          throw new ConflictException(`StockItem ${stockItem.sku} is not available`);
        }

        const sellRate = await this.getCurrentSellRate(stockItem.metalTypeId!);
        const pricing  = this.stockService.calculatePrice(stockItem, sellRate, {
          jertyOverride: outItem.jertyOverride,
          jyalaOverride: outItem.jyalaOverride,
        });

        outTotal = outTotal.plus(pricing.grandTotalNpr);
        outLineData.push(this.buildLineData(stockItem, sellRate.sellRatePerGram, pricing));

        await tx.stockItem.update({
          where: { id: outItem.stockItemId },
          data:  { status: 'SOLD' },
        });
      }

      // ── Cash difference ───────────────────────────────────────────────────
      const cashDiff    = outTotal.minus(inTotal); // positive = customer pays
      const billNum     = await this.billNumber.generate(tx);
      const paidAmount  = new Decimal(payment.amountNpr);
      const balance     = cashDiff.minus(paidAmount);

      const txn = await tx.transaction.create({
        data: {
          billNumber:      billNum,
          txType:          'EXCHANGE',
          customerId,
          createdByUserId: userId,
          exchangeGroupId,
          subTotalNpr:     outTotal,
          grandTotalNpr:   cashDiff,
          paidAmountNpr:   paidAmount,
          balanceNpr:      balance,
          paymentMethod:   payment.method,
          notes,
          lines: {
            create: [
              ...inLineData.filter(l => l.stockItemId).map(l => ({ ...l })),
              ...outLineData,
            ],
          },
          payments: {
            create: {
              amountNpr: paidAmount,
              method:    payment.method,
              reference: payment.reference,
            },
          },
        },
        include: this.fullTxInclude(),
      });

      return {
        ...this.formatTxResponse(txn),
        exchangeSummary: {
          itemsInValueNpr:  inTotal.toFixed(2),
          itemsOutValueNpr: outTotal.toFixed(2),
          cashDifferenceNpr: cashDiff.toFixed(2),
          customerPays: cashDiff.greaterThan(0),
        },
      };
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  BUY_BACK
  // ════════════════════════════════════════════════════════════════════════════

  async createBuyback(userId: string, dto: CreateBuybackDto) {
    const { customerId, relatedSaleTxId, weight, metalTypeId, buyRatePerGram, payment, notes } = dto;

    const weightVal = WeightUtil.from(weight.value, weight.unit);
    const totalNpr  = weightVal.gram * buyRatePerGram;

    return this.prisma.$transaction(async (tx) => {
      const billNum    = await this.billNumber.generate(tx);
      const paidAmount = new Decimal(payment.amountNpr);

      const txn = await tx.transaction.create({
        data: {
          billNumber:      billNum,
          txType:          'BUY_BACK',
          customerId,
          createdByUserId: userId,
          relatedTxId:     relatedSaleTxId,
          subTotalNpr:     totalNpr,
          grandTotalNpr:   totalNpr,
          paidAmountNpr:   paidAmount,
          balanceNpr:      new Decimal(totalNpr).minus(paidAmount),
          paymentMethod:   payment.method,
          notes,
          payments: {
            create: {
              amountNpr: paidAmount,
              method:    payment.method,
              reference: payment.reference,
            },
          },
          buybackRecord: {
            create: {
              customerId:      customerId,
              relatedSaleTxId,
              metalWeightGram: weightVal.gram,
              metalWeightTola: weightVal.tola,
              metalWeightLal:  weightVal.lal,
              buyRatePerGram,
              totalNpr,
            },
          },
        },
        include: this.fullTxInclude(),
      });

      return this.formatTxResponse(txn);
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  OLD_GOLD
  // ════════════════════════════════════════════════════════════════════════════

  async createOldGold(userId: string, dto: CreateOldGoldDto) {
    const { customerId, weight, metalTypeId, buyRatePerGram, payment, notes } = dto;

    const weightVal = WeightUtil.from(weight.value, weight.unit);
    const totalNpr  = weightVal.gram * buyRatePerGram;

    return this.prisma.$transaction(async (tx) => {
      const billNum    = await this.billNumber.generate(tx);
      const paidAmount = new Decimal(payment.amountNpr);

      const txn = await tx.transaction.create({
        data: {
          billNumber:      billNum,
          txType:          'OLD_GOLD',
          customerId,
          createdByUserId: userId,
          subTotalNpr:     totalNpr,
          grandTotalNpr:   totalNpr,
          paidAmountNpr:   paidAmount,
          balanceNpr:      new Decimal(totalNpr).minus(paidAmount),
          paymentMethod:   payment.method,
          notes,
          payments: {
            create: {
              amountNpr: paidAmount,
              method:    payment.method,
              reference: payment.reference,
            },
          },
          buybackRecord: {
            create: {
              customerId,
              metalWeightGram: weightVal.gram,
              metalWeightTola: weightVal.tola,
              metalWeightLal:  weightVal.lal,
              buyRatePerGram,
              totalNpr,
            },
          },
        },
        include: this.fullTxInclude(),
      });

      return this.formatTxResponse(txn);
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  PAYMENT
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Record an additional payment against an existing transaction.
   * Updates paidAmountNpr and balanceNpr on the transaction.
   */
  async addPayment(txId: string, dto: AddPaymentDto) {
    const txn = await this.prisma.transaction.findUnique({ where: { id: txId } });
    if (!txn) throw new NotFoundException(`Transaction ${txId} not found`);

    if (txn.balanceNpr.equals(0)) {
      throw new BadRequestException('This transaction is already fully paid');
    }

    const newPaid   = new Decimal(txn.paidAmountNpr).plus(dto.payment.amountNpr);
    const newBalance = new Decimal(txn.grandTotalNpr).minus(newPaid);

    if (newBalance.lessThan(0)) {
      throw new BadRequestException(
        `Payment of NPR ${dto.payment.amountNpr} exceeds remaining balance of NPR ${txn.balanceNpr}`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.paymentRecord.create({
        data: {
          transactionId: txId,
          amountNpr:     dto.payment.amountNpr,
          method:        dto.payment.method,
          reference:     dto.payment.reference,
          notes:         dto.payment.notes,
        },
      });

      return tx.transaction.update({
        where: { id: txId },
        data:  { paidAmountNpr: newPaid, balanceNpr: newBalance },
        include: this.fullTxInclude(),
      });
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  READ
  // ════════════════════════════════════════════════════════════════════════════

  async listTransactions(query: SalesQueryDto) {
    const { txType, customerId, from, to, hasBalance, search, page = 1, limit = 20 } = query;
    const skip  = (page - 1) * limit;
    const where: any = {};

    if (txType)     where.txType     = txType;
    if (customerId) where.customerId = customerId;
    if (hasBalance) where.balanceNpr = { gt: 0 };

    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to)   where.createdAt.lte = new Date(to);
    }

    if (search) {
      where.OR = [
        { billNumber: { contains: search, mode: 'insensitive' } },
        { customer:   { name: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.transaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take:    limit,
        include: {
          customer:  { select: { id: true, name: true, phoneHint: true } },
          createdBy: { select: { id: true, name: true } },
          _count:    { select: { lines: true } },
        },
      }),
      this.prisma.transaction.count({ where }),
    ]);

    return {
      data: items,
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    };
  }

  async getTransaction(id: string) {
    const txn = await this.prisma.transaction.findUnique({
      where:   { id },
      include: this.fullTxInclude(),
    });
    if (!txn) throw new NotFoundException(`Transaction ${id} not found`);
    return this.formatTxResponse(txn);
  }

  async getTransactionByBillNumber(billNumber: string) {
    const txn = await this.prisma.transaction.findUnique({
      where:   { billNumber },
      include: this.fullTxInclude(),
    });
    if (!txn) throw new NotFoundException(`Bill ${billNumber} not found`);
    return this.formatTxResponse(txn);
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  HELPERS
  // ════════════════════════════════════════════════════════════════════════════

  private async getCurrentSellRate(metalTypeId: string) {
    const rate = await this.prisma.dailyRate.findFirst({
      where:   { metalTypeId, isCurrent: true },
      orderBy: { effectiveDate: 'desc' },
    });
    if (!rate) {
      throw new BadRequestException(
        `No current daily rate found for this metal. Please set today's rate first.`,
      );
    }
    return rate;
  }

  private async getCurrentBuyRate(metalTypeId: string) {
    const rate = await this.prisma.dailyRate.findFirst({
      where:   { metalTypeId, isCurrent: true },
      orderBy: { effectiveDate: 'desc' },
    });
    if (!rate) {
      throw new BadRequestException(
        `No current daily rate found for this metal. Please set today's rate first.`,
      );
    }
    return rate;
  }

  private buildLineData(stockItem: any, ratePerGram: any, pricing: any) {
    return {
      stockItemId:     stockItem.id,
      grossWeightGram: Number(stockItem.grossWeightGram),
      jertyGram:       parseFloat(pricing.jertyWeight.raw.gram.toFixed(4)),
      billableGram:    parseFloat(pricing.billableWeight.raw.gram.toFixed(4)),
      ratePerGram,
      metalValueNpr:   pricing.metalValueNpr,
      jyalaNpr:        pricing.jyalaCustomerView,
      makingChargeNpr: pricing.jyalaOwnerView.makingCharge,
      stoneChargeNpr:  pricing.jyalaOwnerView.stoneCharge,
      motiChargeNpr:   pricing.jyalaOwnerView.motiCharge,
      malaChargeNpr:   pricing.jyalaOwnerView.malaCharge,
      otherChargeNpr:  pricing.jyalaOwnerView.otherCharge,
      luxuryTaxNpr:    pricing.luxuryTaxNpr,
      vatNpr:          pricing.vatNpr,
      addonValueNpr:   pricing.addonValueNpr,
      lineTotalNpr:    pricing.grandTotalNpr,
    };
  }

  private fullTxInclude() {
    return {
      customer:      { select: { id: true, name: true, phoneHint: true } },
      createdBy:     { select: { id: true, name: true } },
      dailyRate:     true,
      lines:         {
        include: {
          stockItem: {
            include: {
              category:  { select: { id: true, name: true } },
              metalType: { select: { id: true, name: true } },
            },
          },
        },
      },
      payments:      true,
      buybackRecord: true,
      relatedTx:     { select: { id: true, billNumber: true, txType: true } },
    };
  }

  /**
   * Format transaction response with:
   * - owner bill (full jyala breakdown per line)
   * - customer bill (jyala as single line)
   * - weight display in all three units
   */
  private formatTxResponse(txn: any) {
    if (!txn) return txn;

    const ownerLines    = txn.lines?.map((line: any) => ({
      ...line,
      weight: WeightUtil.forBill(Number(line.grossWeightGram)),
      jyalaOwnerView: {
        makingCharge: line.makingChargeNpr,
        stoneCharge:  line.stoneChargeNpr,
        motiCharge:   line.motiChargeNpr,
        malaCharge:   line.malaChargeNpr,
        otherCharge:  line.otherChargeNpr,
        total:        line.jyalaNpr,
      },
    }));

    const customerLines = txn.lines?.map((line: any) => ({
      sku:          line.stockItem?.sku,
      category:     line.stockItem?.category?.name,
      metalType:    line.stockItem?.metalType?.name,
      weight:       WeightUtil.forBill(Number(line.grossWeightGram)),
      metalValue:   line.metalValueNpr,
      jyala:        line.jyalaNpr,         // single line — no breakdown
      luxuryTax:    line.luxuryTaxNpr,
      vat:          line.vatNpr,
      lineTotal:    line.lineTotalNpr,
    }));

    return {
      ...txn,
      ownerBill: {
        billNumber:   txn.billNumber,
        date:         txn.createdAt,
        customer:     txn.customer,
        lines:        ownerLines,
        subTotal:     txn.subTotalNpr,
        grandTotal:   txn.grandTotalNpr,
        paid:         txn.paidAmountNpr,
        balance:      txn.balanceNpr,
        payments:     txn.payments,
      },
      customerBill: {
        billNumber:   txn.billNumber,
        date:         txn.createdAt,
        customer:     txn.customer,
        lines:        customerLines,
        subTotal:     txn.subTotalNpr,
        grandTotal:   txn.grandTotalNpr,
        paid:         txn.paidAmountNpr,
        balance:      txn.balanceNpr,
      },
    };
  }
}
