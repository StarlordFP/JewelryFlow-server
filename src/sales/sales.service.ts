import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { StockSkuService } from '../stock/stock-sku.service';
import { BillNumberService } from './bill-number.service';
import { WeightUtil, WeightValue } from '../common/utils/weight.util';
import { GRAMS_PER_TOLA } from '../common/constants/weight.constants';
import { Decimal } from '@prisma/client/runtime/library';
import { randomBytes, createHash } from 'crypto';
import { writeTransactionAudit } from '../audit/write-transaction-audit';
import { applyBillRounding, resolveRoundingUnit } from '../common/utils/bill-rounding.util';
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
  private readonly logger = new Logger(SalesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stockService: StockService,
    private readonly skuService: StockSkuService,
    private readonly billNumber: BillNumberService,
  ) { }

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
    const {
      customerId,
      newCustomerName,
      newCustomerPhone,
      newCustomerAddress,
      items,
      payment,
      notes,
    } = dto;

    return this.prisma.$transaction(async (tx) => {
      const actor = await tx.user.findUnique({
        where: { id: userId },
        select: { name: true },
      });
      const actorName = actor?.name;

      let resolvedCustomerId = customerId;

      if (!resolvedCustomerId && newCustomerName) {
        let phoneHash = undefined;
        let phoneHint = undefined;

        if (newCustomerPhone) {
          const normalised = newCustomerPhone.replace(/[\s\-()]/g, '');
          phoneHash = createHash('sha256').update(normalised).digest('hex');
          const digits = normalised.replace(/\D/g, '');
          phoneHint = `****${digits.slice(-4)}`;

          const existingCustomer = await tx.customer.findUnique({
            where: { phoneHash },
          });

          if (existingCustomer) {
            resolvedCustomerId = existingCustomer.id;
          } else {
            const customer = await tx.customer.create({
              data: {
                name: newCustomerName,
                phoneHash,
                phoneHint,
                address: newCustomerAddress,
              },
            });
            resolvedCustomerId = customer.id;
          }
        } else {
          const customer = await tx.customer.create({
            data: {
              name: newCustomerName,
              address: newCustomerAddress,
            },
          });
          resolvedCustomerId = customer.id;
        }
      }

      const billNum = await this.billNumber.generate(tx);
      let subTotal = new Decimal(0);
      const lineData: any[] = [];

      // ── Batch fetch all stock items in one query ──────────────────────────
      const stockItemIds = items.map(i => i.stockItemId);
      const stockItems = await tx.stockItem.findMany({
        where: { id: { in: stockItemIds } },
        include: {
          metalType: true,
          addons:    true,
          productionItem: {
            include: {
              productionReturn: {
                include: {
                  productionIssue: true,
                },
              },
            },
          },
        },
      });

      // Validate all items were found
      const foundIds = stockItems.map(s => s.id);
      const missing = stockItemIds.filter(id => !foundIds.includes(id));
      if (missing.length) {
        throw new NotFoundException(`StockItems not found: ${missing.join(', ')}`);
      }

      // ── Explicit UNDER_DISPUTE guard ─────────────────────────────────────
      const underDispute = stockItems.filter(s => s.status === 'UNDER_DISPUTE');
      if (underDispute.length > 0) {
        throw new ConflictException(
          `Items under dispute cannot be sold: ${underDispute.map(s => s.sku).join(', ')}. ` +
          `Resolve the karigar dispute first (PATCH /karigar-disputes/:id/resolve).`,
        );
      }

      // ── Atomic conditional update to mark items as SOLD ──────────────────
      // Closes the race window entirely by ensuring items are only updated
      // if they are currently IN_STOCK or RESERVED.
      const soldResult = await tx.stockItem.updateMany({
        where: {
          id:     { in: stockItemIds },
          status: { in: ['IN_STOCK', 'RESERVED'] },
        },
        data: { status: 'SOLD' },
      });

      if (soldResult.count !== stockItemIds.length) {
        throw new ConflictException(
          'One or more stock items have already been sold or reserved. Please review your selection.',
        );
      }

      // ── Batch fetch all required rates (one per unique metalTypeId) ───────
      const metalTypeIds = [...new Set(stockItems.map(s => s.metalTypeId).filter(Boolean))] as string[];
      const rates = await tx.dailyRate.findMany({
        where: { metalTypeId: { in: metalTypeIds }, isCurrent: true },
      });

      // Map metalTypeId → rate for O(1) lookup
      const rateMap = new Map(rates.map(r => [r.metalTypeId, r]));

      // Validate all rates exist for items that need them
      for (const metalTypeId of metalTypeIds) {
        const needsTodayRate = stockItems.some(s =>
          s.metalTypeId === metalTypeId &&
          (s.origin !== 'KARIGAR' || !s.productionItem?.productionReturn?.productionIssue?.rateAtIssuePerGram)
        );
        if (needsTodayRate && !rateMap.has(metalTypeId)) {
          throw new BadRequestException(
            `No current daily rate found for metal ${metalTypeId}. Please set today's rate first.`,
          );
        }
      }

      // ── Price each item ───────────────────────────────────────────────────
      // Build a map of stockItemId → lineDto for override lookup
      const lineDtoMap = new Map(items.map(i => [i.stockItemId, i]));

      for (const stockItem of stockItems) {
        const lineDto = lineDtoMap.get(stockItem.id)!;

        // Update stock item with overrides
        const updateData: any = {};
        if (lineDto.jertyOverride) {
          const jertyW = WeightUtil.from(lineDto.jertyOverride.value, lineDto.jertyOverride.unit);
          updateData.jertyGram = jertyW.gram;
          updateData.jertyTola = jertyW.tola;
          updateData.jertyLal = jertyW.lal;
        }

        // Check if lineDto has jyalaBreakdown (we need to update sales.dto.ts too!)
        if (lineDto.jyalaBreakdown) {
          const jyala = {
            making: lineDto.jyalaBreakdown.makingChargeNpr ?? Number(stockItem.makingChargeNpr),
            stone: lineDto.jyalaBreakdown.stoneChargeNpr ?? Number(stockItem.stoneChargeNpr),
            moti: lineDto.jyalaBreakdown.motiChargeNpr ?? Number(stockItem.motiChargeNpr),
            mala: lineDto.jyalaBreakdown.malaChargeNpr ?? Number(stockItem.malaChargeNpr),
            other: lineDto.jyalaBreakdown.otherChargeNpr ?? Number(stockItem.otherChargeNpr),
          };
          updateData.makingChargeNpr = jyala.making;
          updateData.stoneChargeNpr = jyala.stone;
          updateData.motiChargeNpr = jyala.moti;
          updateData.malaChargeNpr = jyala.mala;
          updateData.otherChargeNpr = jyala.other;
          updateData.totalJyalaNpr = jyala.making + jyala.stone + jyala.moti + jyala.mala + jyala.other;
        } else if (lineDto.jyalaOverride != null) {
          // If only jyalaOverride is provided, we can't update the breakdown, just the total?
          // Or maybe we should just use it in calculatePrice
        }

        if (lineDto.applyLuxuryTax !== undefined) {
          updateData.applyLuxuryTax = lineDto.applyLuxuryTax;
        }

        if (lineDto.applyVat !== undefined) {
          updateData.applyVat = lineDto.applyVat;
        }

        if (Object.keys(updateData).length > 0) {
          await tx.stockItem.update({
            where: { id: stockItem.id },
            data: updateData,
          });
        }

        // Resolve rate: historical for KARIGAR, today's for everything else
        let itemRate: any = null;
        if (stockItem.origin === 'KARIGAR') {
          const issueRate = stockItem.productionItem?.productionReturn?.productionIssue?.rateAtIssuePerGram;
          if (issueRate) {
            itemRate = {
              sellRatePerGram: issueRate,
              ratePerGram:     issueRate,
            };
          } else {
            console.warn(`Warning: failed to resolve historical rate for karigar stock item ${stockItem.id}. Using today's rate.`);
            itemRate = rateMap.get(stockItem.metalTypeId!)!;
          }
        } else {
          itemRate = rateMap.get(stockItem.metalTypeId!)!;
        }

        const pricing = await this.stockService.calculatePrice(stockItem, itemRate, lineDto);

        subTotal = subTotal.plus(new Decimal(pricing.grandTotalNpr));

        // Record the actual rate used on the line so the bill is self-evidencing.
        const rateUsedPerGram =
          itemRate?.sellRatePerGram ?? itemRate?.ratePerGram ?? 0;

        lineData.push({
          stockItemId: stockItem.id,
          grossWeightGram: Number(stockItem.grossWeightGram),
          jertyGram: parseFloat(pricing.jertyWeight.raw.gram.toFixed(4)),
          billableGram: parseFloat(pricing.billableWeight.raw.gram.toFixed(4)),
          ratePerGram: rateUsedPerGram,
          metalValueNpr: pricing.metalValueNpr,
          jyalaNpr: pricing.jyalaCustomerView,
          makingChargeNpr: pricing.jyalaOwnerView.makingCharge,
          stoneChargeNpr: pricing.jyalaOwnerView.stoneCharge,
          motiChargeNpr: pricing.jyalaOwnerView.motiCharge,
          malaChargeNpr: pricing.jyalaOwnerView.malaCharge,
          otherChargeNpr: pricing.jyalaOwnerView.otherCharge,
          luxuryTaxNpr: pricing.luxuryTaxNpr,
          vatNpr: pricing.vatNpr,
          addonValueNpr: pricing.addonValueNpr,
          lineTotalNpr: pricing.grandTotalNpr,
        });
      }

      const discountNpr = new Decimal(0);
      const preRoundingPayable = subTotal.minus(discountNpr);
      const roundingUnit = resolveRoundingUnit(stockItems.map((s) => s.metalType));
      const rounding = applyBillRounding(preRoundingPayable, roundingUnit);
      const grandTotal = rounding.roundedTotal;
      const roundingNpr = rounding.roundingNpr;
      const paidAmount = new Decimal(payment.amountNpr);

      if (paidAmount.greaterThan(grandTotal.mul(2))) {
        throw new BadRequestException(
          `Payment amount (NPR ${paidAmount.toFixed(2)}) is more than twice the ` +
          `grand total (NPR ${grandTotal.toFixed(2)}). Please verify the amount.`,
        );
      }

      const balance = grandTotal.minus(paidAmount);

      // ── Create transaction ────────────────────────────────────────────────
      // primaryRate is the DailyRate record linked on the transaction header for
      // reference / audit. KARIGAR items use their historical rate stored on the
      // line; the header rate is informational only (null if all items are karigar).
      const primaryRate = rateMap.size > 0
        ? rateMap.get(stockItems.find(s => s.origin !== 'KARIGAR')?.metalTypeId ?? '')
          ?? rateMap.values().next().value
        : null;

      // ── Snapshot customer details onto the invoice ────────────────────────
      const custSnapshot = await this.resolveCustomerSnapshot(
        tx, resolvedCustomerId, newCustomerName, newCustomerPhone, newCustomerAddress,
      );

      const txn = await tx.transaction.create({
        data: {
          billNumber: billNum,
          txType: 'SELL',
          customerId: resolvedCustomerId,
          ...custSnapshot,
          createdByUserId: userId,
          dailyRateId: primaryRate?.id ?? null,
          subTotalNpr: subTotal,
          discountNpr,
          roundingNpr,
          grandTotalNpr: grandTotal,
          paidAmountNpr: paidAmount,
          balanceNpr: balance,
          paymentMethod: payment.method,
          returnDeadline: new Date(Date.now() + RETURN_WINDOW_DAYS * 86400000),
          notes,
          lines: { create: lineData },
          payments: {
            create: {
              amountNpr: paidAmount,
              method: payment.method,
              reference: payment.reference,
              notes: payment.notes,
            },
          },
        },
        include: this.fullTxInclude(),
      });

      await writeTransactionAudit(tx, this.logger, {
        entityId: txn.id,
        billNumber: billNum,
        action: 'CREATED',
        actorId: userId,
        actorName,
        after: {
          subTotalNpr: subTotal.toFixed(2),
          discountNpr: discountNpr.toFixed(2),
          roundingNpr: roundingNpr.toFixed(2),
          grandTotalNpr: grandTotal.toFixed(2),
          txType: 'SELL',
          itemCount: lineData.length,
        },
      });

      if (roundingNpr.gt(0)) {
        await writeTransactionAudit(tx, this.logger, {
          entityId: txn.id,
          billNumber: billNum,
          action: 'ROUNDING_APPLIED',
          actorId: userId,
          actorName,
          after: {
            unit: roundingUnit,
            preRoundingTotal: preRoundingPayable.toFixed(2),
            roundingNpr: roundingNpr.toFixed(2),
            roundedTotal: grandTotal.toFixed(2),
          },
        });
      }

      // (Stock items were already atomically marked SOLD at step 5)

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

    if (!items?.length) {
      throw new BadRequestException('At least one item must be selected for return');
    }

    const originalTx = await this.prisma.transaction.findUnique({
      where: { id: originalTxId },
      include: { lines: true },
    });

    if (!originalTx) throw new NotFoundException(`Transaction ${originalTxId} not found`);
    if (originalTx.txType !== 'SELL') {
      throw new BadRequestException('Can only return items from a SELL transaction');
    }

    const originalItemIds = originalTx.lines
      .map((l) => l.stockItemId)
      .filter(Boolean) as string[];
    for (const item of items) {
      if (!originalItemIds.includes(item.stockItemId)) {
        throw new BadRequestException(
          `StockItem ${item.stockItemId} is not part of transaction ${originalTxId}`,
        );
      }
    }

    const returnedStockItemIds = items.map((i) => i.stockItemId);

    return this.prisma.$transaction(async (tx) => {
      const actor = await tx.user.findUnique({
        where: { id: userId },
        select: { name: true },
      });
      const actorName = actor?.name;

      const freshOriginal = await tx.transaction.findUnique({
        where: { id: originalTxId },
        include: { lines: true },
      });

      if (!freshOriginal || freshOriginal.txType !== 'SELL') {
        throw new BadRequestException('Can only return items from a SELL transaction');
      }

      const returnDeadline = this.resolveReturnDeadline(freshOriginal);
      if (new Date() > returnDeadline) {
        throw new BadRequestException(
          'Return window expired — items can only be returned within 7 days of purchase.',
        );
      }

      const billNum = await this.billNumber.generate(tx);
      let refundTotal = new Decimal(0);
      const lineData: any[] = [];

      const custSnapshot = {
        customerName:    freshOriginal.customerName   ?? null,
        customerPhone:   freshOriginal.customerPhone  ?? null,
        customerAddress: freshOriginal.customerAddress ?? null,
      };

      for (const returnItem of items) {
        const stockItem = await tx.stockItem.findUnique({
          where: { id: returnItem.stockItemId },
          include: { metalType: true, addons: true },
        });

        if (!stockItem) throw new NotFoundException(`StockItem ${returnItem.stockItemId} not found`);

        const buyRate = await this.getCurrentBuyRateInTx(tx, stockItem.metalTypeId!);

        const pricing = await this.stockService.calculatePrice(stockItem, {
          ...buyRate,
          sellRatePerGram: buyRate.buyRatePerGram,
        });

        refundTotal = refundTotal.plus(pricing.grandTotalNpr);

        lineData.push({
          stockItemId: stockItem.id,
          grossWeightGram: Number(stockItem.grossWeightGram),
          jertyGram: Number(stockItem.jertyGram),
          billableGram: Number(stockItem.grossWeightGram) + Number(stockItem.jertyGram),
          ratePerGram: buyRate.buyRatePerGram,
          metalValueNpr: pricing.metalValueNpr,
          jyalaNpr: pricing.jyalaCustomerView,
          makingChargeNpr: pricing.jyalaOwnerView.makingCharge,
          stoneChargeNpr: pricing.jyalaOwnerView.stoneCharge,
          motiChargeNpr: pricing.jyalaOwnerView.motiCharge,
          malaChargeNpr: pricing.jyalaOwnerView.malaCharge,
          otherChargeNpr: pricing.jyalaOwnerView.otherCharge,
          luxuryTaxNpr: pricing.luxuryTaxNpr,
          vatNpr: pricing.vatNpr,
          addonValueNpr: pricing.addonValueNpr,
          lineTotalNpr: pricing.grandTotalNpr,
        });
      }

      const txn = await tx.transaction.create({
        data: {
          billNumber: billNum,
          txType: 'RETURN',
          customerId: freshOriginal.customerId,
          ...custSnapshot,
          createdByUserId: userId,
          relatedTxId: originalTxId,
          subTotalNpr: refundTotal,
          grandTotalNpr: refundTotal,
          paidAmountNpr: refundTotal,
          balanceNpr: new Decimal(0),
          paymentMethod: refund.method,
          notes,
          lines: { create: lineData },
          payments: {
            create: {
              amountNpr: refundTotal,
              method: refund.method,
              reference: refund.reference,
              notes: refund.notes,
            },
          },
        },
        include: this.fullTxInclude(),
      });

      const stockResult = await tx.stockItem.updateMany({
        where: { id: { in: returnedStockItemIds }, status: 'SOLD' },
        data: { status: 'IN_STOCK' },
      });

      if (stockResult.count !== returnedStockItemIds.length) {
        throw new ConflictException(
          'One or more items are not in SOLD status and cannot be returned.',
        );
      }

      await writeTransactionAudit(tx, this.logger, {
        entityId: txn.id,
        billNumber: billNum,
        action: 'RETURNED',
        actorId: userId,
        actorName,
        after: { refundNpr: refundTotal.toFixed(2) },
        metadata: { relatedBillNumber: freshOriginal.billNumber },
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
    const { customerId, itemsIn, itemsOut, payment, notes, relatedTxId } = dto;
    const exchangeGroupId = `EXG-${randomBytes(8).toString('hex')}`;

    return this.prisma.$transaction(async (tx) => {
      const actor = await tx.user.findUnique({
        where: { id: userId },
        select: { name: true },
      });
      const actorName = actor?.name;

      let relatedBillNumber: string | null = null;
      if (relatedTxId) {
        const related = await tx.transaction.findUnique({
          where: { id: relatedTxId },
          select: { billNumber: true },
        });
        relatedBillNumber = related?.billNumber ?? null;
      }

      let inTotal = new Decimal(0);
      let outTotal = new Decimal(0);
      const inLineData: any[] = [];

      const shopItemsIn = itemsIn.filter((i) => i.stockItemId);
      const oldGoldItemsIn = itemsIn.filter(
        (i) => !i.stockItemId && i.oldGoldWeight && i.oldGoldMetalTypeId,
      );

      const inItemIds = shopItemsIn.map((i) => i.stockItemId) as string[];
      const inStockItems = inItemIds.length
        ? await tx.stockItem.findMany({
            where: { id: { in: inItemIds } },
            include: { metalType: true, addons: true },
          })
        : [];

      const inFoundIds = inStockItems.map((s) => s.id);
      const inMissing = inItemIds.filter((id) => !inFoundIds.includes(id));
      if (inMissing.length) {
        throw new NotFoundException(`StockItems not found: ${inMissing.join(', ')}`);
      }

      const inReturnedResult = await tx.stockItem.updateMany({
        where: {
          id: { in: inItemIds },
          status: 'SOLD',
        },
        data: { status: 'IN_STOCK' },
      });

      if (inItemIds.length && inReturnedResult.count !== inItemIds.length) {
        throw new ConflictException(
          'One or more incoming items cannot be returned — they are not in SOLD status.',
        );
      }

      const inMetalTypeIds = [
        ...new Set(inStockItems.map((s) => s.metalTypeId).filter(Boolean)),
      ] as string[];
      const inRates = await tx.dailyRate.findMany({
        where: { metalTypeId: { in: inMetalTypeIds }, isCurrent: true },
      });
      const inRateMap = new Map(inRates.map((r) => [r.metalTypeId, r]));

      for (const stockItem of inStockItems) {
        const buyRate = inRateMap.get(stockItem.metalTypeId!);
        if (!buyRate) {
          throw new BadRequestException(
            `No current rate for metal ${stockItem.metalTypeId}. Please set today's rate first.`,
          );
        }

        const pricing = await this.stockService.calculatePrice(stockItem, {
          ...buyRate,
          sellRatePerGram: buyRate.buyRatePerGram,
        });

        inTotal = inTotal.plus(pricing.grandTotalNpr);
        inLineData.push(this.buildLineData(stockItem, buyRate.buyRatePerGram, pricing));
      }

      // Old-gold-in: weight-only lines with no stockItemId (customer metal not from shop stock).
      for (const inItem of oldGoldItemsIn) {
        const buyRate = await this.getCurrentBuyRateInTx(tx, inItem.oldGoldMetalTypeId!);
        const weightVal = WeightUtil.from(inItem.oldGoldWeight!.value, inItem.oldGoldWeight!.unit);
        const metalVal = weightVal.gram * Number(buyRate.buyRatePerGram);

        inTotal = inTotal.plus(metalVal);
        inLineData.push({
          stockItemId: null,
          grossWeightGram: weightVal.gram,
          jertyGram: 0,
          billableGram: weightVal.gram,
          ratePerGram: buyRate.buyRatePerGram,
          metalValueNpr: metalVal.toFixed(2),
          jyalaNpr: '0.00',
          makingChargeNpr: '0.00',
          stoneChargeNpr: '0.00',
          motiChargeNpr: '0.00',
          malaChargeNpr: '0.00',
          otherChargeNpr: '0.00',
          luxuryTaxNpr: '0.00',
          vatNpr: '0.00',
          addonValueNpr: '0.00',
          lineTotalNpr: metalVal.toFixed(2),
        });
      }

      const outLineData: any[] = [];
      const outItemIds = itemsOut.map((i) => i.stockItemId);

      const outStockItems = await tx.stockItem.findMany({
        where: { id: { in: outItemIds } },
        include: { metalType: true, addons: true },
      });

      const outFoundIds = outStockItems.map((s) => s.id);
      const outMissing = outItemIds.filter((id) => !outFoundIds.includes(id));
      if (outMissing.length) {
        throw new NotFoundException(`StockItems not found: ${outMissing.join(', ')}`);
      }

      const outSoldResult = await tx.stockItem.updateMany({
        where: {
          id: { in: outItemIds },
          status: { in: ['IN_STOCK', 'RESERVED'] },
        },
        data: { status: 'SOLD' },
      });

      if (outSoldResult.count !== outItemIds.length) {
        throw new ConflictException(
          'One or more outgoing items are no longer available. Please review your selection.',
        );
      }

      const outMetalTypeIds = [
        ...new Set(outStockItems.map((s) => s.metalTypeId).filter(Boolean)),
      ] as string[];
      const outRates = await tx.dailyRate.findMany({
        where: { metalTypeId: { in: outMetalTypeIds }, isCurrent: true },
      });
      const outRateMap = new Map(outRates.map((r) => [r.metalTypeId, r]));

      for (const metalTypeId of outMetalTypeIds) {
        if (!outRateMap.has(metalTypeId)) {
          throw new BadRequestException(
            `No current daily rate found for metal ${metalTypeId}. Please set today's rate first.`,
          );
        }
      }

      const outLineDtoMap = new Map(itemsOut.map((i) => [i.stockItemId, i]));

      for (const stockItem of outStockItems) {
        const sellRate = outRateMap.get(stockItem.metalTypeId!)!;
        const outItem = outLineDtoMap.get(stockItem.id)!;

        const pricing = await this.stockService.calculatePrice(stockItem, sellRate, {
          jertyOverride: outItem.jertyOverride,
          jyalaOverride: outItem.jyalaOverride,
        });

        outTotal = outTotal.plus(pricing.grandTotalNpr);
        outLineData.push(this.buildLineData(stockItem, sellRate.sellRatePerGram, pricing));
      }

      const cashDiff = outTotal.minus(inTotal);
      const billNum = await this.billNumber.generate(tx);
      const paidAmount = new Decimal(payment.amountNpr);
      const balance = cashDiff.minus(paidAmount);

      const custSnapshot = await this.resolveCustomerSnapshot(tx, customerId);

      const txn = await tx.transaction.create({
        data: {
          billNumber: billNum,
          txType: 'EXCHANGE',
          customerId,
          ...custSnapshot,
          createdByUserId: userId,
          relatedTxId: relatedTxId ?? null,
          exchangeGroupId,
          subTotalNpr: outTotal,
          grandTotalNpr: cashDiff,
          paidAmountNpr: paidAmount,
          balanceNpr: balance,
          paymentMethod: payment.method,
          notes,
          lines: {
            create: [...inLineData, ...outLineData],
          },
          payments: {
            create: {
              amountNpr: paidAmount,
              method: payment.method,
              reference: payment.reference,
            },
          },
        },
        include: this.fullTxInclude(),
      });

      await writeTransactionAudit(tx, this.logger, {
        entityId: txn.id,
        billNumber: billNum,
        action: 'EXCHANGED',
        actorId: userId,
        actorName,
        after: { netNpr: cashDiff.toFixed(2) },
        metadata: { relatedBillNumber },
      });

      return {
        ...this.formatTxResponse(txn),
        exchangeSummary: {
          itemsInValueNpr: inTotal.toFixed(2),
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
    const totalNpr = weightVal.gram * buyRatePerGram;

    return this.prisma.$transaction(async (tx) => {
      const [actor, metalType] = await Promise.all([
        tx.user.findUnique({ where: { id: userId }, select: { name: true } }),
        tx.metalType.findUnique({ where: { id: metalTypeId }, select: { name: true } }),
      ]);
      const actorName = actor?.name;

      const billNum = await this.billNumber.generate(tx);
      const paidAmount = new Decimal(payment.amountNpr);
      const custSnapshot = await this.resolveCustomerSnapshot(tx, customerId);

      const stockItem = await this.createOldGoldStockItem(tx, {
        metalTypeId,
        weight: weightVal,
      });

      const lineData = this.buildWeightPurchaseLineData(
        stockItem.id,
        weightVal,
        buyRatePerGram,
        totalNpr,
      );

      const txn = await tx.transaction.create({
        data: {
          billNumber: billNum,
          txType: 'BUY_BACK',
          customerId,
          ...custSnapshot,
          createdByUserId: userId,
          relatedTxId: relatedSaleTxId,
          subTotalNpr: totalNpr,
          grandTotalNpr: totalNpr,
          paidAmountNpr: paidAmount,
          balanceNpr: new Decimal(totalNpr).minus(paidAmount),
          paymentMethod: payment.method,
          notes,
          lines: { create: [lineData] },
          payments: {
            create: {
              amountNpr: paidAmount,
              method: payment.method,
              reference: payment.reference,
            },
          },
          buybackRecord: {
            create: {
              customerId,
              relatedSaleTxId,
              stockItemId: stockItem.id,
              metalTypeId,
              metalWeightGram: weightVal.gram,
              metalWeightTola: weightVal.tola,
              metalWeightLal: weightVal.lal,
              buyRatePerGram,
              totalNpr,
            },
          },
        },
        include: this.fullTxInclude(),
      });

      await writeTransactionAudit(tx, this.logger, {
        entityId: txn.id,
        billNumber: billNum,
        action: 'BUYBACK',
        actorId: userId,
        actorName,
        after: {
          metalType: metalType?.name ?? metalTypeId,
          weightGram: weightVal.gram,
          paidNpr: paidAmount.toFixed(2),
        },
      });

      return {
        ...this.formatTxResponse(txn),
        createdStockItem: this.formatCreatedStockItem(stockItem),
      };
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  OLD_GOLD
  // ════════════════════════════════════════════════════════════════════════════

  async createOldGold(userId: string, dto: CreateOldGoldDto) {
    const { customerId, weight, metalTypeId, buyRatePerGram, payment, notes } = dto;

    const weightVal = WeightUtil.from(weight.value, weight.unit);
    const totalNpr = weightVal.gram * buyRatePerGram;

    return this.prisma.$transaction(async (tx) => {
      const [actor, metalType] = await Promise.all([
        tx.user.findUnique({ where: { id: userId }, select: { name: true } }),
        tx.metalType.findUnique({ where: { id: metalTypeId }, select: { name: true } }),
      ]);
      const actorName = actor?.name;

      const billNum = await this.billNumber.generate(tx);
      const paidAmount = new Decimal(payment.amountNpr);
      const custSnapshot = await this.resolveCustomerSnapshot(tx, customerId);

      const stockItem = await this.createOldGoldStockItem(tx, {
        metalTypeId,
        weight: weightVal,
      });

      const lineData = this.buildWeightPurchaseLineData(
        stockItem.id,
        weightVal,
        buyRatePerGram,
        totalNpr,
      );

      const txn = await tx.transaction.create({
        data: {
          billNumber: billNum,
          txType: 'OLD_GOLD',
          customerId,
          ...custSnapshot,
          createdByUserId: userId,
          subTotalNpr: totalNpr,
          grandTotalNpr: totalNpr,
          paidAmountNpr: paidAmount,
          balanceNpr: new Decimal(totalNpr).minus(paidAmount),
          paymentMethod: payment.method,
          notes,
          lines: { create: [lineData] },
          payments: {
            create: {
              amountNpr: paidAmount,
              method: payment.method,
              reference: payment.reference,
            },
          },
          buybackRecord: {
            create: {
              customerId,
              stockItemId: stockItem.id,
              metalTypeId,
              metalWeightGram: weightVal.gram,
              metalWeightTola: weightVal.tola,
              metalWeightLal: weightVal.lal,
              buyRatePerGram,
              totalNpr,
            },
          },
        },
        include: this.fullTxInclude(),
      });

      await writeTransactionAudit(tx, this.logger, {
        entityId: txn.id,
        billNumber: billNum,
        action: 'OLD_GOLD',
        actorId: userId,
        actorName,
        after: {
          metalType: metalType?.name ?? metalTypeId,
          weightGram: weightVal.gram,
          paidNpr: paidAmount.toFixed(2),
        },
      });

      return {
        ...this.formatTxResponse(txn),
        createdStockItem: this.formatCreatedStockItem(stockItem),
      };
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  PAYMENT
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Record an additional payment against an existing transaction.
   * Updates paidAmountNpr and balanceNpr on the transaction.
   */
  async addPayment(userId: string, txId: string, dto: AddPaymentDto) {
    return this.prisma.$transaction(async (tx) => {
      const actor = await tx.user.findUnique({
        where: { id: userId },
        select: { name: true },
      });
      const actorName = actor?.name;

      // Re-read inside transaction so concurrent payments
      // see each other's writes before checking balance
      const txn = await tx.transaction.findUnique({ where: { id: txId } });
      if (!txn) throw new NotFoundException(`Transaction ${txId} not found`);

      if (txn.balanceNpr.equals(0)) {
        throw new BadRequestException('This transaction is already fully paid');
      }

      const newPaid = new Decimal(txn.paidAmountNpr).plus(dto.payment.amountNpr);
      const newBalance = new Decimal(txn.grandTotalNpr).minus(newPaid);

      if (newBalance.lessThan(0)) {
        throw new BadRequestException(
          `Payment of NPR ${dto.payment.amountNpr} exceeds remaining balance of NPR ${txn.balanceNpr}`,
        );
      }

      await tx.paymentRecord.create({
        data: {
          transactionId: txId,
          amountNpr: dto.payment.amountNpr,
          method: dto.payment.method,
          reference: dto.payment.reference,
          notes: dto.payment.notes,
        },
      });

      const updated = await tx.transaction.update({
        where: { id: txId },
        data: { paidAmountNpr: newPaid, balanceNpr: newBalance },
        include: this.fullTxInclude(),
      });

      await writeTransactionAudit(tx, this.logger, {
        entityId: txId,
        billNumber: txn.billNumber,
        action: 'PAYMENT_ADDED',
        actorId: userId,
        actorName,
        after: {
          amountNpr: dto.payment.amountNpr,
          method: dto.payment.method,
          newBalance: newBalance.toFixed(2),
        },
      });

      return updated;
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  READ
  // ════════════════════════════════════════════════════════════════════════════

  async listTransactions(query: SalesQueryDto) {
    const { txType, customerId, from, to, hasBalance, search, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;
    const where: any = {};

    if (txType) where.txType = txType;
    if (customerId) where.customerId = customerId;
    if (hasBalance) where.balanceNpr = { gt: 0 };

    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    if (search) {
      where.OR = [
        { billNumber: { contains: search, mode: 'insensitive' } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.transaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          customer: { select: { id: true, name: true, phoneHint: true } },
          createdBy: { select: { id: true, name: true } },
          relatedTx: { select: { id: true, billNumber: true, txType: true } },
          buybackRecord: { select: { relatedSaleTxId: true } },
          _count: { select: { lines: true } },
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
      where: { id },
      include: this.fullTxInclude(),
    });
    if (!txn) throw new NotFoundException(`Transaction ${id} not found`);
    return this.formatTxResponse(txn);
  }

  async getTransactionByBillNumber(billNumber: string) {
    const txn = await this.prisma.transaction.findUnique({
      where: { billNumber },
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
      where: { metalTypeId, isCurrent: true },
      orderBy: { effectiveDate: 'desc' },
    });
    if (!rate) {
      throw new BadRequestException(
        `No current daily rate found for this metal. Please set today's rate first.`,
      );
    }
    return rate;
  }

  private resolveReturnDeadline(sale: { returnDeadline: Date | null; createdAt: Date }): Date {
    if (sale.returnDeadline) {
      return new Date(sale.returnDeadline);
    }
    const deadline = new Date(sale.createdAt);
    deadline.setDate(deadline.getDate() + RETURN_WINDOW_DAYS);
    return deadline;
  }

  private async getOldGoldCategoryId(tx: any): Promise<string> {
    const cat = await tx.itemCategory.upsert({
      where: { name: 'Old Gold' },
      update: {},
      create: { name: 'Old Gold' },
    });
    return cat.id;
  }

  private async createOldGoldStockItem(
    tx: any,
    params: { metalTypeId: string; weight: WeightValue },
  ) {
    const categoryId = await this.getOldGoldCategoryId(tx);
    const entryRate = await tx.dailyRate.findFirst({
      where: { metalTypeId: params.metalTypeId, isCurrent: true },
      orderBy: { effectiveDate: 'desc' },
    });
    const sku = await this.skuService.generateSku('PURCHASED', tx);

    return tx.stockItem.create({
      data: {
        sku,
        origin: 'PURCHASED',
        categoryId,
        metalTypeId: params.metalTypeId,
        grossWeightGram: params.weight.gram,
        grossWeightTola: params.weight.tola,
        grossWeightLal: params.weight.lal,
        entryRateId: entryRate?.id ?? null,
        status: 'IN_STOCK',
      },
    });
  }

  private buildWeightPurchaseLineData(
    stockItemId: string,
    weight: WeightValue,
    buyRatePerGram: number,
    totalNpr: number,
  ) {
    return {
      stockItemId,
      grossWeightGram: weight.gram,
      jertyGram: 0,
      billableGram: weight.gram,
      ratePerGram: buyRatePerGram,
      metalValueNpr: totalNpr,
      jyalaNpr: 0,
      makingChargeNpr: 0,
      stoneChargeNpr: 0,
      motiChargeNpr: 0,
      malaChargeNpr: 0,
      otherChargeNpr: 0,
      luxuryTaxNpr: 0,
      vatNpr: 0,
      addonValueNpr: 0,
      lineTotalNpr: totalNpr,
    };
  }

  private formatCreatedStockItem(stockItem: { id: string; sku: string }) {
    return {
      id: stockItem.id,
      sku: stockItem.sku,
      category: 'Old Gold',
    };
  }

  private async getCurrentBuyRateInTx(tx: any, metalTypeId: string) {
    const rate = await tx.dailyRate.findFirst({
      where: { metalTypeId, isCurrent: true },
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
      where: { metalTypeId, isCurrent: true },
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
      stockItemId: stockItem.id,
      grossWeightGram: Number(stockItem.grossWeightGram),
      jertyGram: parseFloat(pricing.jertyWeight.raw.gram.toFixed(4)),
      billableGram: parseFloat(pricing.billableWeight.raw.gram.toFixed(4)),
      ratePerGram,
      metalValueNpr: pricing.metalValueNpr,
      jyalaNpr: pricing.jyalaCustomerView,
      makingChargeNpr: pricing.jyalaOwnerView.makingCharge,
      stoneChargeNpr: pricing.jyalaOwnerView.stoneCharge,
      motiChargeNpr: pricing.jyalaOwnerView.motiCharge,
      malaChargeNpr: pricing.jyalaOwnerView.malaCharge,
      otherChargeNpr: pricing.jyalaOwnerView.otherCharge,
      luxuryTaxNpr: pricing.luxuryTaxNpr,
      vatNpr: pricing.vatNpr,
      addonValueNpr: pricing.addonValueNpr,
      lineTotalNpr: pricing.grandTotalNpr,
    };
  }

  private fullTxInclude() {
    return {
      customer: { select: { id: true, name: true, phoneHint: true, address: true } },
      createdBy: { select: { id: true, name: true } },
      dailyRate: {
        include: { metalType: { select: { id: true, name: true } } },
      },
      lines: {
        include: {
          stockItem: {
            include: {
              category: { select: { id: true, name: true } },
              metalType: { select: { id: true, name: true } },
            },
          },
        },
      },
      payments: true,
      buybackRecord: true,
      relatedTx: { select: { id: true, billNumber: true, txType: true } },
    };
  }

  /**
   * Fetch and return a snapshot of customer details to be stored on each transaction.
   * For new customers (provided inline), we use the supplied values directly.
   * For existing customers referenced by ID, we look up the DB.
   * Returns { customerName, customerPhone, customerAddress } or all nulls.
   */
  private async resolveCustomerSnapshot(
    tx: any,
    customerId?: string | null,
    newCustomerName?: string,
    newCustomerPhone?: string,
    newCustomerAddress?: string,
  ): Promise<{ customerName: string | null; customerPhone: string | null; customerAddress: string | null }> {
    // If inline new customer fields are given, prefer them
    if (!customerId && newCustomerName) {
      const normalised = newCustomerPhone?.replace(/[\s\-()]/g, '') ?? '';
      const digits = normalised.replace(/\D/g, '');
      const phoneHint = newCustomerPhone ? `****${digits.slice(-4)}` : null;
      return {
        customerName:    newCustomerName,
        customerPhone:   phoneHint,
        customerAddress: newCustomerAddress ?? null,
      };
    }

    if (!customerId) {
      return { customerName: null, customerPhone: null, customerAddress: null };
    }

    const customer = await tx.customer.findUnique({
      where: { id: customerId },
      select: { name: true, phoneHint: true, address: true },
    });

    if (!customer) {
      return { customerName: null, customerPhone: null, customerAddress: null };
    }

    return {
      customerName:    customer.name,
      customerPhone:   customer.phoneHint ?? null,
      customerAddress: customer.address   ?? null,
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

    const ownerLines = txn.lines?.map((line: any) => ({
      ...line,
      weight: WeightUtil.forBill(Number(line.grossWeightGram)),
      jyalaOwnerView: {
        makingCharge: line.makingChargeNpr,
        stoneCharge: line.stoneChargeNpr,
        motiCharge: line.motiChargeNpr,
        malaCharge: line.malaChargeNpr,
        otherCharge: line.otherChargeNpr,
        total: line.jyalaNpr,
      },
    }));

    const customerLines = txn.lines?.map((line: any) => {
      const grossGram = Number(line.grossWeightGram);
      const jertyGram = Number(line.jertyGram);
      const billableGram = Number(line.billableGram);
      const metalValue = Number(line.metalValueNpr);
      const jyala = Number(line.jyalaNpr);
      const addonValue = Number(line.addonValueNpr ?? 0);
      const luxuryTax = Number(line.luxuryTaxNpr);
      const vat = Number(line.vatNpr);
      const tax = luxuryTax + vat;
      const amount = metalValue + jyala + addonValue;
      const itemName =
        line.stockItem?.name?.trim() ||
        [line.stockItem?.category?.name, line.stockItem?.metalType?.name]
          .filter(Boolean)
          .join(' ') ||
        'Item';

      return {
        itemName,
        sku: line.stockItem?.sku,
        category: line.stockItem?.category?.name,
        metalType: line.stockItem?.metalType?.name,
        ratePerGram: line.ratePerGram,
        grossWeight: WeightUtil.forBill(grossGram),
        jertyWeight: WeightUtil.forBill(jertyGram),
        totalWeight: WeightUtil.forBill(billableGram),
        weight: WeightUtil.forBill(grossGram), // backwards compatibility
        metalValue: line.metalValueNpr,
        jyala: line.jyalaNpr,
        amount: amount.toFixed(2),
        discount: '0.00',
        tax: tax.toFixed(2),
        luxuryTax: line.luxuryTaxNpr,
        vat: line.vatNpr,
        lineTotal: line.lineTotalNpr,
      };
    });

    const billTaxTotal = txn.lines?.reduce(
      (sum: number, line: any) =>
        sum + Number(line.luxuryTaxNpr) + Number(line.vatNpr),
      0,
    ) ?? 0;

    const resolvedBillCustomer = txn.customer
      ? {
          ...txn.customer,
          name: txn.customerName ?? txn.customer.name,
          phoneHint: txn.customerPhone ?? txn.customer.phoneHint,
          address: txn.customerAddress ?? txn.customer.address,
        }
      : txn.customerName
      ? {
          id: txn.customerId ?? null,
          name: txn.customerName,
          phoneHint: txn.customerPhone,
          address: txn.customerAddress,
        }
      : null;

    return {
      ...txn,
      type: txn.txType,   // consumer-friendly alias
      ownerBill: {
        billNumber: txn.billNumber,
        date: txn.createdAt,
        customer: resolvedBillCustomer,
        lines: ownerLines,
        subTotal: txn.subTotalNpr,
        grandTotal: txn.grandTotalNpr,
        rounding: txn.roundingNpr,
        paid: txn.paidAmountNpr,
        balance: txn.balanceNpr,
        payments: txn.payments,
      },
      customerBill: {
        billNumber: txn.billNumber,
        date: txn.createdAt,
        customer: resolvedBillCustomer,
        rates: this.buildBillRates(txn),
        rateDate: txn.dailyRate?.effectiveDate ?? txn.createdAt,
        lines: customerLines,
        subTotal: txn.subTotalNpr,
        discount: txn.discountNpr,
        rounding: txn.roundingNpr,
        tax: billTaxTotal.toFixed(2),
        grandTotal: txn.grandTotalNpr,
        paid: txn.paidAmountNpr,
        balance: txn.balanceNpr,
      },
    };
  }

  /** Unique sell rates applied on this bill (per metal), from line snapshots or header daily rate. */
  private buildBillRates(txn: any) {
    const seen = new Map<string, {
      metalType: string;
      ratePerGram: unknown;
      ratePerTola: string;
      effectiveDate?: Date;
    }>();

    for (const line of txn.lines ?? []) {
      const rateGram = Number(line.ratePerGram);
      if (!rateGram) continue;
      const metal = line.stockItem?.metalType?.name ?? 'Metal';
      const key = `${metal}:${rateGram.toFixed(2)}`;
      if (!seen.has(key)) {
        seen.set(key, {
          metalType: metal,
          ratePerGram: line.ratePerGram,
          ratePerTola: (rateGram * GRAMS_PER_TOLA).toFixed(2),
        });
      }
    }

    if (seen.size === 0 && txn.dailyRate) {
      const dr = txn.dailyRate;
      return [{
        metalType: dr.metalType?.name ?? 'Metal',
        ratePerGram: dr.sellRatePerGram,
        ratePerTola: dr.sellRatePerTola,
        effectiveDate: dr.effectiveDate,
      }];
    }

    return Array.from(seen.values());
  }
}
