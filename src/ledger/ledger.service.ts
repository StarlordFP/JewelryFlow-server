// src/ledger/ledger.service.ts

import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GRAMS_PER_TOLA } from '../common/constants/weight.constants';
import { GoldLedgerQueryDto, ProfitReportQueryDto } from './dto/ledger.dto';

// ─── Types ───────────────────────────────────────────────────────────────────

type MovementType =
  | 'PURCHASE_IN'
  | 'KARIGAR_OUT'
  | 'KARIGAR_IN'
  | 'TRADE_OUT'
  | 'TRADE_IN'
  | 'SALE_OUT'
  | 'RETURN_IN';

interface GoldMovement {
  id: string;
  date: string;
  type: MovementType;
  description: string;
  metalType: { id: string; name: string } | null;
  weightGram: string;   // positive = in, negative = out
  weightTola: string;
  ratePerGram: string | null;
  valueNpr: string | null;
  reference: string;
  createdBy: { id: string; name: string } | null;
  _sortDate: Date;      // internal sort key — stripped before response
}

// Where the cost (buying) rate for a sold item came from
type CostRateSource = 'PURCHASE_RATE' | 'ENTRY_RATE' | 'UNKNOWN';

interface ProfitRow {
  id: string;            // TransactionLine id
  date: string;
  billNumber: string;
  sku: string | null;
  itemName: string | null;
  origin: string | null;
  metalType: { id: string; name: string } | null;
  billableGram: string;
  billableTola: string;
  soldRatePerGram: string;
  costRatePerGram: string | null;
  costRateSource: CostRateSource;
  metalRevenueNpr: string;        // sold rate × billable gram
  metalCostNpr: string | null;    // cost rate × billable gram
  metalProfitNpr: string | null;  // revenue − cost
  createdBy: { id: string; name: string } | null;
  _sortDate: Date;                // internal sort key — stripped before response
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmtW = (g: number) => g.toFixed(4);
const fmtV = (v: number | null) => (v === null ? null : v.toFixed(2));
const toTola = (gram: number) => gram / GRAMS_PER_TOLA;

@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  // ════════════════════════════════════════════════════════════════════════════
  //  GOLD LEDGER
  // ════════════════════════════════════════════════════════════════════════════

  async getGoldLedger(query: GoldLedgerQueryDto) {
    const { metalTypeId, from, to, page = 1, limit = 50 } = query;

    // Build date filter objects
    const dateGte = from ? new Date(from) : undefined;
    const dateLte = to   ? new Date(to)   : undefined;

    // ── Fetch all 7 sources in parallel ─────────────────────────────────────
    const [
      purchaseLines,
      productionIssues,
      productionReturns,
      completedTrades,
      tradeItems,
      sellLines,
      returnLines,
    ] = await Promise.all([

      // 1. PURCHASE_IN — PurchaseOrderLine where PO status=RECEIVED
      //    Note: PurchaseOrderLine has no metalType relation — only metalTypeId scalar
      //    We load all matching lines and resolve metalType name separately
      this.prisma.purchaseOrderLine.findMany({
        where: {
          purchaseOrder: {
            status: 'RECEIVED',
            ...(dateGte || dateLte
              ? {
                  purchaseDate: {
                    ...(dateGte ? { gte: dateGte } : {}),
                    ...(dateLte ? { lte: dateLte } : {}),
                  },
                }
              : {}),
          },
          ...(metalTypeId ? { metalTypeId } : {}),
        },
        include: {
          purchaseOrder: {
            include: {
              supplier: { select: { id: true, name: true } },
              createdBy: { select: { id: true, name: true } },
            },
          },
        },
      }),

      // 2. KARIGAR_OUT — ProductionIssue
      this.prisma.productionIssue.findMany({
        where: {
          ...(metalTypeId ? { metalTypeId } : {}),
          ...(dateGte || dateLte
            ? {
                issuedAt: {
                  ...(dateGte ? { gte: dateGte } : {}),
                  ...(dateLte ? { lte: dateLte } : {}),
                },
              }
            : {}),
        },
        include: {
          metalType:      { select: { id: true, name: true } },
          productionOrder: {
            include: {
              karigar: { select: { id: true, name: true } },
              createdBy: { select: { id: true, name: true } },
            },
          },
        },
      }),

      // 3. KARIGAR_IN — ProductionReturn
      //    Note: ProductionOrder has no createdBy relation in schema
      this.prisma.productionReturn.findMany({
        where: {
          ...(dateGte || dateLte
            ? {
                returnedAt: {
                  ...(dateGte ? { gte: dateGte } : {}),
                  ...(dateLte ? { lte: dateLte } : {}),
                },
              }
            : {}),
          ...(metalTypeId
            ? { productionIssue: { metalTypeId } }
            : {}),
        },
        include: {
          productionIssue: {
            include: {
              metalType: { select: { id: true, name: true } },
            },
          },
          productionOrder: {
            include: {
              karigar: { select: { id: true, name: true } },
              createdBy: { select: { id: true, name: true } },
            },
          },
        },
      }),

      // 4. TRADE_OUT — Trade where status=COMPLETED
      this.prisma.trade.findMany({
        where: {
          status: 'COMPLETED',
          ...(metalTypeId ? { givenMetalTypeId: metalTypeId } : {}),
          ...(dateGte || dateLte
            ? {
                createdAt: {
                  ...(dateGte ? { gte: dateGte } : {}),
                  ...(dateLte ? { lte: dateLte } : {}),
                },
              }
            : {}),
        },
        include: {
          supplier:   { select: { id: true, name: true } },
          givenMetal: { select: { id: true, name: true } },
          createdBy:  { select: { id: true, name: true } },
        },
      }),

      // 5. TRADE_IN — TradeItems from completed trades
      this.prisma.tradeItem.findMany({
        where: {
          trade: {
            status: 'COMPLETED',
            ...(metalTypeId ? { givenMetalTypeId: metalTypeId } : {}),
            ...(dateGte || dateLte
              ? {
                  createdAt: {
                    ...(dateGte ? { gte: dateGte } : {}),
                    ...(dateLte ? { lte: dateLte } : {}),
                  },
                }
              : {}),
          },
        },
        include: {
          trade: {
            include: {
              supplier:   { select: { id: true, name: true } },
              givenMetal: { select: { id: true, name: true } },
              createdBy:  { select: { id: true, name: true } },
            },
          },
        },
      }),

      // 6. SALE_OUT — TransactionLine where txType=SELL
      this.prisma.transactionLine.findMany({
        where: {
          transaction: {
            txType: 'SELL',
            ...(dateGte || dateLte
              ? {
                  createdAt: {
                    ...(dateGte ? { gte: dateGte } : {}),
                    ...(dateLte ? { lte: dateLte } : {}),
                  },
                }
              : {}),
          },
          ...(metalTypeId
            ? { stockItem: { metalTypeId } }
            : {}),
        },
        include: {
          transaction: {
            include: {
              createdBy: { select: { id: true, name: true } },
            },
          },
          stockItem: {
            include: {
              metalType: { select: { id: true, name: true } },
            },
          },
        },
      }),

      // 7. RETURN_IN — TransactionLine where txType=RETURN
      this.prisma.transactionLine.findMany({
        where: {
          transaction: {
            txType: 'RETURN',
            ...(dateGte || dateLte
              ? {
                  createdAt: {
                    ...(dateGte ? { gte: dateGte } : {}),
                    ...(dateLte ? { lte: dateLte } : {}),
                  },
                }
              : {}),
          },
          ...(metalTypeId
            ? { stockItem: { metalTypeId } }
            : {}),
        },
        include: {
          transaction: {
            include: {
              createdBy: { select: { id: true, name: true } },
            },
          },
          stockItem: {
            include: {
              metalType: { select: { id: true, name: true } },
            },
          },
        },
      }),
    ]);

    // ── Resolve metalType names for PurchaseOrderLine (no direct relation) ──
    const metalTypeIds = [
      ...new Set(
        purchaseLines
          .map((l) => l.metalTypeId)
          .filter((id): id is string => !!id),
      ),
    ];
    const metalTypesMap = new Map<string, { id: string; name: string }>();
    if (metalTypeIds.length > 0) {
      const metalTypes = await this.prisma.metalType.findMany({
        where: { id: { in: metalTypeIds } },
        select: { id: true, name: true },
      });
      for (const mt of metalTypes) {
        metalTypesMap.set(mt.id, mt);
      }
    }

    // ── Map each source to GoldMovement ─────────────────────────────────────

    const movements: GoldMovement[] = [];

    // 1. PURCHASE_IN
    for (const line of purchaseLines) {
      const gram = Number(line.grossWeightGram);
      const mt   = line.metalTypeId ? (metalTypesMap.get(line.metalTypeId) ?? null) : null;
      movements.push({
        id:          line.id,
        date:        line.purchaseOrder.purchaseDate.toISOString(),
        type:        'PURCHASE_IN',
        description: `Purchased from ${line.purchaseOrder.supplier.name}`,
        metalType:   mt,
        weightGram:  fmtW(gram),
        weightTola:  fmtW(toTola(gram)),
        ratePerGram: line.rateAtPurchasePerGram
          ? fmtV(Number(line.rateAtPurchasePerGram))
          : null,
        valueNpr:    fmtV(Number(line.priceNpr)),
        reference:   line.purchaseOrderId,
        createdBy:   line.purchaseOrder.createdBy,
        _sortDate:   line.purchaseOrder.purchaseDate,
      });
    }

    // 2. KARIGAR_OUT (negative — going out)
    for (const issue of productionIssues) {
      const gram = Number(issue.issuedWeightGram);
      movements.push({
        id:          issue.id,
        date:        issue.issuedAt.toISOString(),
        type:        'KARIGAR_OUT',
        description: `Issued to ${issue.productionOrder.karigar?.name ?? 'karigar'}`,
        metalType:   issue.metalType,
        weightGram:  fmtW(-gram),
        weightTola:  fmtW(-toTola(gram)),
        ratePerGram: fmtV(Number(issue.rateAtIssuePerGram)),
        valueNpr:    fmtV(Number(issue.rateAtIssuePerGram) * gram),
        reference:   issue.productionOrderId,
        createdBy:   issue.productionOrder.createdBy ?? null,
        _sortDate:   issue.issuedAt,
      });
    }

    // 3. KARIGAR_IN (positive — coming back)
    for (const ret of productionReturns) {
      const gram = Number(ret.returnedWeightGram);
      movements.push({
        id:          ret.id,
        date:        ret.returnedAt.toISOString(),
        type:        'KARIGAR_IN',
        description: `Returned by ${ret.productionOrder.karigar?.name ?? 'karigar'}`,
        metalType:   ret.productionIssue?.metalType ?? null,
        weightGram:  fmtW(gram),
        weightTola:  fmtW(toTola(gram)),
        ratePerGram: null,
        valueNpr:    null,
        reference:   ret.productionOrderId,
        createdBy:   ret.productionOrder.createdBy ?? null,
        _sortDate:   ret.returnedAt,
      });
    }

    // 4. TRADE_OUT (negative — metal given away)
    for (const trade of completedTrades) {
      const gram = Number(trade.givenWeightGram);
      movements.push({
        id:          trade.id,
        date:        trade.createdAt.toISOString(),
        type:        'TRADE_OUT',
        description: `Trade given to ${trade.supplier.name}`,
        metalType:   trade.givenMetal,
        weightGram:  fmtW(-gram),
        weightTola:  fmtW(-toTola(gram)),
        ratePerGram: fmtV(Number(trade.rateAtTradePerGram)),
        valueNpr:    fmtV(Number(trade.rateAtTradePerGram) * gram),
        reference:   trade.id,
        createdBy:   trade.createdBy,
        _sortDate:   trade.createdAt,
      });
    }

    // 5. TRADE_IN (positive — finished items received)
    for (const item of tradeItems) {
      const gram = Number(item.grossWeightGram);
      movements.push({
        id:          item.id,
        date:        item.trade.createdAt.toISOString(),
        type:        'TRADE_IN',
        description: `Trade received from ${item.trade.supplier.name}`,
        metalType:   item.trade.givenMetal,
        weightGram:  fmtW(gram),
        weightTola:  fmtW(toTola(gram)),
        ratePerGram: null,
        valueNpr:    null,
        reference:   item.tradeId,
        createdBy:   item.trade.createdBy,
        _sortDate:   item.trade.createdAt,
      });
    }

    // 6. SALE_OUT (negative — sold)
    for (const line of sellLines) {
      const gram = Number(line.grossWeightGram);
      movements.push({
        id:          line.id,
        date:        line.transaction.createdAt.toISOString(),
        type:        'SALE_OUT',
        description: `Sold — ${line.transaction.billNumber}`,
        metalType:   line.stockItem?.metalType ?? null,
        weightGram:  fmtW(-gram),
        weightTola:  fmtW(-toTola(gram)),
        ratePerGram: fmtV(Number(line.ratePerGram)),
        valueNpr:    fmtV(Number(line.lineTotalNpr)),
        reference:   line.transaction.billNumber,
        createdBy:   line.transaction.createdBy ?? null,
        _sortDate:   line.transaction.createdAt,
      });
    }

    // 7. RETURN_IN (positive — returned)
    for (const line of returnLines) {
      const gram = Number(line.grossWeightGram);
      movements.push({
        id:          line.id,
        date:        line.transaction.createdAt.toISOString(),
        type:        'RETURN_IN',
        description: `Return — ${line.transaction.billNumber}`,
        metalType:   line.stockItem?.metalType ?? null,
        weightGram:  fmtW(gram),
        weightTola:  fmtW(toTola(gram)),
        ratePerGram: fmtV(Number(line.ratePerGram)),
        valueNpr:    fmtV(Number(line.lineTotalNpr)),
        reference:   line.transaction.billNumber,
        createdBy:   line.transaction.createdBy ?? null,
        _sortDate:   line.transaction.createdAt,
      });
    }

    // ── Sort by date descending ──────────────────────────────────────────────
    movements.sort((a, b) => b._sortDate.getTime() - a._sortDate.getTime());

    // ── Summary — calculated from ALL matching records (before pagination) ───
    let totalInGram  = 0;
    let totalOutGram = 0;

    for (const m of movements) {
      const g = parseFloat(m.weightGram);
      if (g > 0) totalInGram  += g;
      else        totalOutGram += Math.abs(g);
    }

    const netGram      = totalInGram - totalOutGram;
    const totalInTola  = toTola(totalInGram);
    const totalOutTola = toTola(totalOutGram);
    const netTola      = toTola(netGram);

    const summary = {
      totalInGram:  fmtW(totalInGram),
      totalOutGram: fmtW(totalOutGram),
      netGram:      fmtW(netGram),
      totalInTola:  fmtW(totalInTola),
      totalOutTola: fmtW(totalOutTola),
      netTola:      fmtW(netTola),
    };

    // ── Paginate (in-memory) ─────────────────────────────────────────────────
    const total = movements.length;
    const pages = Math.ceil(total / limit);
    const skip  = (page - 1) * limit;
    const paged = movements.slice(skip, skip + limit);

    // Strip internal sort key before sending to client
    const data = paged.map(({ _sortDate: _d, ...rest }) => rest);

    return {
      summary,
      data,
      meta: { total, page, limit, pages },
    };
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  CUSTOMER LEDGER
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Full customer ledger:
   *  - Customer profile
   *  - Financial summary (purchases, payments, balance, returns, buybacks)
   *  - All transactions with payment breakdowns, sorted newest first
   */
  async getCustomerLedger(customerId: string) {
    // Fetch customer + all transactions + buybacks in parallel
    const [customer, transactions, buybackRecords] = await Promise.all([

      this.prisma.customer.findUnique({
        where: { id: customerId },
        select: {
          id:        true,
          name:      true,
          phoneHint: true,
          isActive:  true,
          createdAt: true,
        },
      }),

      this.prisma.transaction.findMany({
        where:   { customerId },
        orderBy: { createdAt: 'desc' },
        include: {
          lines:    { select: { id: true } },   // only need count
          payments: {
            select: {
              id:        true,
              amountNpr: true,
              method:    true,
              paidAt:    true,
            },
            orderBy: { paidAt: 'asc' },
          },
        },
      }),

      this.prisma.buybackRecord.findMany({
        where:  { customerId },
        select: { totalNpr: true },
      }),
    ]);

    if (!customer) throw new NotFoundException(`Customer ${customerId} not found`);

    // ── Compute summary ─────────────────────────────────────────────────────
    let totalPurchasesNpr = 0;
    let totalPaidNpr      = 0;
    let totalBalanceNpr   = 0;
    let totalReturnedNpr  = 0;
    let lastTransactionDate: string | null = null;

    for (const tx of transactions) {
      if (tx.txType === 'SELL') {
        totalPurchasesNpr += Number(tx.grandTotalNpr);
      }
      if (tx.txType === 'RETURN') {
        totalReturnedNpr += Number(tx.grandTotalNpr);
      }
      totalPaidNpr    += Number(tx.paidAmountNpr);
      totalBalanceNpr += Number(tx.balanceNpr);
    }

    if (transactions.length > 0) {
      // Already sorted desc — first entry is newest
      lastTransactionDate = transactions[0].createdAt.toISOString();
    }

    const totalBuybackNpr = buybackRecords.reduce(
      (acc, b) => acc + Number(b.totalNpr),
      0,
    );

    // ── Shape transactions for response ─────────────────────────────────────
    const txList = transactions.map((tx) => ({
      id:            tx.id,
      billNumber:    tx.billNumber,
      txType:        tx.txType,
      grandTotalNpr: Number(tx.grandTotalNpr).toFixed(2),
      paidAmountNpr: Number(tx.paidAmountNpr).toFixed(2),
      balanceNpr:    Number(tx.balanceNpr).toFixed(2),
      isPaid:        Number(tx.balanceNpr) === 0,
      itemCount:     tx.lines.length,
      paymentMethod: tx.paymentMethod,
      createdAt:     tx.createdAt.toISOString(),
      payments: tx.payments.map((p) => ({
        id:        p.id,
        amountNpr: Number(p.amountNpr).toFixed(2),
        method:    p.method,
        paidAt:    p.paidAt.toISOString(),
      })),
    }));

    return {
      customer: {
        ...customer,
        createdAt: customer.createdAt.toISOString(),
      },
      summary: {
        totalPurchasesNpr:   totalPurchasesNpr.toFixed(2),
        totalPaidNpr:        totalPaidNpr.toFixed(2),
        totalBalanceNpr:     totalBalanceNpr.toFixed(2),
        totalReturnedNpr:    totalReturnedNpr.toFixed(2),
        totalBuybackNpr:     totalBuybackNpr.toFixed(2),
        transactionCount:    transactions.length,
        lastTransactionDate,
      },
      transactions: txList,
    };
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  PROFIT / RATE-COMPARISON REPORT
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Per-sold-line comparison of the rate the metal was acquired at (cost) versus
   * the rate it was sold at, with the resulting metal-level profit.
   *
   *  - Cost rate priority:
   *      1. PurchaseOrderLine.rateAtPurchasePerGram  (origin = PURCHASED, actual buy rate)
   *      2. StockItem.entryRate.sellRatePerGram        (rate snapshot when item entered stock)
   *      3. null → UNKNOWN (excluded from profit totals)
   *  - Sold rate: TransactionLine.ratePerGram
   *  - Profit is metal-only (jyala / making charges are not part of this comparison).
   *
   * Only SELL transactions are considered.
   */
  async getProfitReport(query: ProfitReportQueryDto) {
    const { metalTypeId, from, to, page = 1, limit = 50 } = query;

    const dateGte = from ? new Date(from) : undefined;
    const dateLte = to   ? new Date(to)   : undefined;

    const sellLines = await this.prisma.transactionLine.findMany({
      where: {
        stockItemId: { not: null },
        transaction: {
          txType: 'SELL',
          ...(dateGte || dateLte
            ? {
                createdAt: {
                  ...(dateGte ? { gte: dateGte } : {}),
                  ...(dateLte ? { lte: dateLte } : {}),
                },
              }
            : {}),
        },
        ...(metalTypeId ? { stockItem: { metalTypeId } } : {}),
      },
      include: {
        transaction: {
          include: { createdBy: { select: { id: true, name: true } } },
        },
        stockItem: {
          include: {
            metalType:         { select: { id: true, name: true } },
            entryRate:         { select: { sellRatePerGram: true } },
            purchaseOrderLine: { select: { rateAtPurchasePerGram: true } },
          },
        },
      },
    });

    // ── Map each sold line to a ProfitRow ─────────────────────────────────────
    const rows: ProfitRow[] = [];

    for (const line of sellLines) {
      const item = line.stockItem;
      if (!item) continue; // guarded by where clause, but keep TS happy

      const billableGram   = Number(line.billableGram);
      const soldRatePerGram = Number(line.ratePerGram);
      const metalRevenueNpr = Number(line.metalValueNpr);

      // Resolve cost rate
      let costRatePerGram: number | null = null;
      let costRateSource: CostRateSource = 'UNKNOWN';

      const purchaseRate = item.purchaseOrderLine?.rateAtPurchasePerGram;
      if (item.origin === 'PURCHASED' && purchaseRate != null) {
        costRatePerGram = Number(purchaseRate);
        costRateSource  = 'PURCHASE_RATE';
      } else if (item.entryRate?.sellRatePerGram != null) {
        costRatePerGram = Number(item.entryRate.sellRatePerGram);
        costRateSource  = 'ENTRY_RATE';
      }

      const metalCostNpr =
        costRatePerGram != null ? costRatePerGram * billableGram : null;
      const metalProfitNpr =
        metalCostNpr != null ? metalRevenueNpr - metalCostNpr : null;

      rows.push({
        id:              line.id,
        date:            line.transaction.createdAt.toISOString(),
        billNumber:      line.transaction.billNumber,
        sku:             item.sku ?? null,
        itemName:        item.name ?? null,
        origin:          item.origin,
        metalType:       item.metalType,
        billableGram:    fmtW(billableGram),
        billableTola:    fmtW(toTola(billableGram)),
        soldRatePerGram: fmtV(soldRatePerGram) as string,
        costRatePerGram: fmtV(costRatePerGram),
        costRateSource,
        metalRevenueNpr: fmtV(metalRevenueNpr) as string,
        metalCostNpr:    fmtV(metalCostNpr),
        metalProfitNpr:  fmtV(metalProfitNpr),
        createdBy:       line.transaction.createdBy ?? null,
        _sortDate:       line.transaction.createdAt,
      });
    }

    // ── Sort by date descending ──────────────────────────────────────────────
    rows.sort((a, b) => b._sortDate.getTime() - a._sortDate.getTime());

    // ── Summary — profit only summed over lines with a known cost ────────────
    let totalMetalRevenueNpr = 0;
    let totalMetalCostNpr    = 0;
    let totalMetalProfitNpr  = 0;
    let linesWithKnownCost   = 0;
    let linesWithUnknownCost = 0;

    for (const r of rows) {
      totalMetalRevenueNpr += parseFloat(r.metalRevenueNpr);
      if (r.metalCostNpr !== null && r.metalProfitNpr !== null) {
        totalMetalCostNpr   += parseFloat(r.metalCostNpr);
        totalMetalProfitNpr += parseFloat(r.metalProfitNpr);
        linesWithKnownCost  += 1;
      } else {
        linesWithUnknownCost += 1;
      }
    }

    const summary = {
      totalMetalRevenueNpr: totalMetalRevenueNpr.toFixed(2),
      totalMetalCostNpr:    totalMetalCostNpr.toFixed(2),
      totalMetalProfitNpr:  totalMetalProfitNpr.toFixed(2),
      totalLines:           rows.length,
      linesWithKnownCost,
      linesWithUnknownCost,
    };

    // ── Paginate (in-memory) ─────────────────────────────────────────────────
    const total = rows.length;
    const pages = Math.ceil(total / limit);
    const skip  = (page - 1) * limit;
    const paged = rows.slice(skip, skip + limit);

    const data = paged.map(({ _sortDate: _d, ...rest }) => rest);

    return {
      summary,
      data,
      meta: { total, page, limit, pages },
    };
  }
}
