import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { Decimal } from '@prisma/client/runtime/library';

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma:        PrismaService,
    private readonly stockService:  StockService,
  ) {}

  async getDashboard() {
    // ── Date boundaries ───────────────────────────────────────────────────────
    const now       = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd  = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);

    // ── Run all queries in parallel ───────────────────────────────────────────
    const [
      todaySells,
      stockSnapshot,
      currentRates,
      recentTransactions,
      pendingPayments,
      pendingPurchaseOrders,
      openDisputes,
      pendingKarigarOrders,
    ] = await Promise.all([

      // 1. Today's SELL transactions
      this.prisma.transaction.findMany({
        where: {
          txType:    'SELL',
          createdAt: { gte: todayStart, lte: todayEnd },
        },
        select: {
          grandTotalNpr: true,
          lines:         { select: { id: true } },
        },
      }),

      // 2. Stock snapshot — count and items for valuation
      this.prisma.stockItem.findMany({
        where:   { status: 'IN_STOCK' },
        select:  {
          id:              true,
          grossWeightGram: true,
          jertyGram:       true,
          totalJyalaNpr:   true,
          applyLuxuryTax:  true,
          applyVat:        true,
          metalTypeId:     true,
          metalType:       { select: { name: true } },
          addons:          { select: { valuationNpr: true } },
        },
      }),

      // 3. Current rates — all metals
      this.prisma.dailyRate.findMany({
        where:   { isCurrent: true },
        include: { metalType: { select: { id: true, name: true } } },
        orderBy: { metalType: { name: 'asc' } },
      }),

      // 4. Recent transactions — last 10
      this.prisma.transaction.findMany({
        orderBy: { createdAt: 'desc' },
        take:    10,
        select:  {
          id:            true,
          billNumber:    true,
          txType:        true,
          grandTotalNpr: true,
          paidAmountNpr: true,
          balanceNpr:    true,
          createdAt:     true,
          customer:      { select: { id: true, name: true } },
        },
      }),

      // 5. Transactions with outstanding balance
      this.prisma.transaction.count({
        where: { balanceNpr: { gt: 0 } },
      }),

      // 6. Pending purchase orders
      this.prisma.purchaseOrder.count({
        where: { status: 'PENDING' },
      }),

      // 7. Open karigar disputes
      this.prisma.karigarDispute.count({
        where: { status: 'PENDING' },
      }),

      // 8. Open production orders
      this.prisma.productionOrder.count({
        where: { status: 'OPEN' },
      }),
    ]);

    // ── Calculate today's sales totals ────────────────────────────────────────
    const todaySalesNpr = todaySells.reduce(
      (sum, tx) => sum + Number(tx.grandTotalNpr),
      0,
    );
    const todayItemsSold = todaySells.reduce(
      (sum, tx) => sum + tx.lines.length,
      0,
    );
    const todayBillCount = todaySells.length;

    // ── Calculate stock value at today's rates ────────────────────────────────
    // Build rate map for O(1) lookup
    const rateMap = new Map(
      currentRates.map(r => [r.metalTypeId, Number(r.sellRatePerGram)])
    );

    let stockValueNpr = 0;
    for (const item of stockSnapshot) {
      const ratePerGram = rateMap.get(item.metalTypeId ?? '') ?? 0;
      const billableGram = Number(item.grossWeightGram) + Number(item.jertyGram);
      const metalValue   = billableGram * ratePerGram;
      const jyala        = Number(item.totalJyalaNpr ?? 0);
      const addonValue   = item.addons.reduce(
        (sum, a) => sum + Number(a.valuationNpr),
        0,
      );
      stockValueNpr += metalValue + jyala + addonValue;
    }

    // ── Format rates response ─────────────────────────────────────────────────
    const formattedRates = currentRates.map(r => ({
      metalType:        r.metalType,
      sellRatePerGram:  Number(r.sellRatePerGram).toFixed(2),
      sellRatePerTola:  Number(r.sellRatePerTola).toFixed(2),
      sellRatePerLal:   Number(r.sellRatePerLal).toFixed(2),
      buyRatePerGram:   Number(r.buyRatePerGram).toFixed(2),
      buyRatePerTola:   Number(r.buyRatePerTola).toFixed(2),
      buyRatePerLal:    Number(r.buyRatePerLal).toFixed(2),
      effectiveDate:    r.effectiveDate,
    }));

    // ── Format recent transactions ────────────────────────────────────────────
    const formattedTransactions = recentTransactions.map(tx => ({
      id:            tx.id,
      billNumber:    tx.billNumber,
      txType:        tx.txType,
      grandTotalNpr: Number(tx.grandTotalNpr).toFixed(2),
      paidAmountNpr: Number(tx.paidAmountNpr).toFixed(2),
      balanceNpr:    Number(tx.balanceNpr).toFixed(2),
      isPaid:        Number(tx.balanceNpr) === 0,
      createdAt:     tx.createdAt,
      customer:      tx.customer,
    }));

    // ── Return everything ─────────────────────────────────────────────────────
    return {
      // Today's performance
      todaySalesNpr:    todaySalesNpr.toFixed(2),
      todayItemsSold,
      todayBillCount,

      // Stock snapshot
      stockItemCount:   stockSnapshot.length,
      stockValueNpr:    stockValueNpr.toFixed(2),

      // Current rates
      currentRates:     formattedRates,
      ratesSetToday:    currentRates.some(r => {
        const rateDate = new Date(r.effectiveDate);
        return rateDate >= todayStart && rateDate <= todayEnd;
      }),

      // Recent activity
      recentTransactions: formattedTransactions,

      // Pending action items — things owner needs to act on
      pendingItems: {
        outstandingPayments:   pendingPayments,
        pendingPurchaseOrders,
        openKarigarDisputes:   openDisputes,
        openProductionOrders:  pendingKarigarOrders,
      },
    };
  }
}