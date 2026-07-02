// src/audit/audit.service.ts

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditQueryDto, TransactionAuditQueryDto } from './dto/audit.dto';

// ─── Types ───────────────────────────────────────────────────────────────────

export type AuditActionType = 'RATE_CHANGE' | 'SALE' | 'RETURN' | 'EXCHANGE' | 'ALL';

export interface AuditEvent {
  id:          string;
  action:      string;
  description: string;
  entityType:  'DailyRate' | 'Transaction' | 'StockItem';
  entityId:    string;
  performedBy: { id: string; name: string } | null;
  timestamp:   string;
  metadata:    Record<string, unknown>;
  _sortDate:   Date;  // internal sort key — stripped before response
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  // ════════════════════════════════════════════════════════════════════════════
  //  AUDIT LOG
  // ════════════════════════════════════════════════════════════════════════════

  async getAuditLog(query: AuditQueryDto) {
    const { action = 'ALL', userId, from, to, page = 1, limit = 50 } = query;

    const dateGte = from ? new Date(from) : undefined;
    const dateLte = to   ? new Date(to)   : undefined;

    // Determine which sources to fetch
    const fetchRates    = action === 'ALL' || action === 'RATE_CHANGE';
    const fetchSells    = action === 'ALL' || action === 'SALE';
    const fetchReturn   = action === 'ALL' || action === 'RETURN';
    const fetchExchange = action === 'ALL' || action === 'EXCHANGE';

    // ── Fetch all active sources in parallel ─────────────────────────────────
    const [rateRecords, sellTxs, returnTxs, exchangeTxs] = await Promise.all([
      // RATE_CHANGE ← DailyRate records
      fetchRates
        ? this.prisma.dailyRate.findMany({
            where: {
              ...(userId ? { updatedByUserId: userId } : {}),
              ...(dateGte || dateLte
                ? {
                    effectiveDate: {
                      ...(dateGte ? { gte: dateGte } : {}),
                      ...(dateLte ? { lte: dateLte } : {}),
                    },
                  }
                : {}),
            },
            include: {
              metalType: { select: { id: true, name: true } },
              updatedBy: { select: { id: true, name: true } },
            },
          })
        : Promise.resolve([]),

      // SALE ← Transaction where txType=SELL
      fetchSells
        ? this.prisma.transaction.findMany({
            where: {
              txType: 'SELL',
              ...(userId ? { createdByUserId: userId } : {}),
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
              createdBy: { select: { id: true, name: true } },
              customer:  { select: { name: true } },
              _count:    { select: { lines: true } },
            },
          })
        : Promise.resolve([]),

      // RETURN ← Transaction where txType=RETURN
      fetchReturn
        ? this.prisma.transaction.findMany({
            where: {
              txType: 'RETURN',
              ...(userId ? { createdByUserId: userId } : {}),
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
              createdBy: { select: { id: true, name: true } },
              customer:  { select: { name: true } },
            },
          })
        : Promise.resolve([]),

      // EXCHANGE ← Transaction where txType=EXCHANGE
      fetchExchange
        ? this.prisma.transaction.findMany({
            where: {
              txType: 'EXCHANGE',
              ...(userId ? { createdByUserId: userId } : {}),
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
              createdBy: { select: { id: true, name: true } },
              customer:  { select: { name: true } },
            },
          })
        : Promise.resolve([]),
    ]);

    // TODO: STOCK_STATUS audit requires an AuditLog table in schema
    // Add model AuditLog { id, entityType, entityId, action, oldValue,
    //   newValue, performedByUserId, createdAt } and log status changes
    // in StockService.updateStockStatus()

    // ── Map to AuditEvent ────────────────────────────────────────────────────
    const events: AuditEvent[] = [];

    // RATE_CHANGE
    for (const rate of rateRecords) {
      events.push({
        id:          rate.id,
        action:      'RATE_CHANGE',
        description: `Set ${rate.metalType.name} sell rate to NPR ${Number(rate.sellRatePerTola).toFixed(2)}/tola`,
        entityType:  'DailyRate',
        entityId:    rate.id,
        performedBy: rate.updatedBy ? { id: rate.updatedBy.id, name: rate.updatedBy.name } : null,
        timestamp:   rate.effectiveDate.toISOString(),
        metadata: {
          metalTypeName:   rate.metalType.name,
          sellRatePerTola: Number(rate.sellRatePerTola).toFixed(2),
          sellRatePerGram: Number(rate.sellRatePerGram).toFixed(2),
          buyRatePerTola:  Number(rate.buyRatePerTola).toFixed(2),
          buyRatePerGram:  Number(rate.buyRatePerGram).toFixed(2),
          isCurrent:       rate.isCurrent,
        },
        _sortDate: rate.effectiveDate,
      });
    }

    // SALE
    for (const tx of sellTxs) {
      events.push({
        id:          tx.id,
        action:      'SALE',
        description: `Sale ${tx.billNumber} — NPR ${Number(tx.grandTotalNpr).toFixed(2)}`,
        entityType:  'Transaction',
        entityId:    tx.id,
        performedBy: tx.createdBy ? { id: tx.createdBy.id, name: tx.createdBy.name } : null,
        timestamp:   tx.createdAt.toISOString(),
        metadata: {
          billNumber:    tx.billNumber,
          grandTotalNpr: Number(tx.grandTotalNpr).toFixed(2),
          paidAmountNpr: Number(tx.paidAmountNpr).toFixed(2),
          balanceNpr:    Number(tx.balanceNpr).toFixed(2),
          customerName:  tx.customer?.name ?? null,
          itemCount:     tx._count.lines,
        },
        _sortDate: tx.createdAt,
      });
    }

    // RETURN
    for (const tx of returnTxs) {
      events.push({
        id:          tx.id,
        action:      'RETURN',
        description: `Return ${tx.billNumber} — NPR ${Number(tx.grandTotalNpr).toFixed(2)}`,
        entityType:  'Transaction',
        entityId:    tx.id,
        performedBy: tx.createdBy ? { id: tx.createdBy.id, name: tx.createdBy.name } : null,
        timestamp:   tx.createdAt.toISOString(),
        metadata: {
          billNumber:    tx.billNumber,
          grandTotalNpr: Number(tx.grandTotalNpr).toFixed(2),
          relatedTxId:   tx.relatedTxId ?? null,
          customerName:  tx.customer?.name ?? null,
        },
        _sortDate: tx.createdAt,
      });
    }

    // EXCHANGE
    for (const tx of exchangeTxs) {
      events.push({
        id:          tx.id,
        action:      'EXCHANGE',
        description: `Exchange ${tx.billNumber} — NPR ${Number(tx.grandTotalNpr).toFixed(2)}`,
        entityType:  'Transaction',
        entityId:    tx.id,
        performedBy: tx.createdBy ? { id: tx.createdBy.id, name: tx.createdBy.name } : null,
        timestamp:   tx.createdAt.toISOString(),
        metadata: {
          billNumber:      tx.billNumber,
          grandTotalNpr:   Number(tx.grandTotalNpr).toFixed(2),
          exchangeGroupId: tx.exchangeGroupId ?? null,
          customerName:    tx.customer?.name ?? null,
        },
        _sortDate: tx.createdAt,
      });
    }

    // ── Sort by timestamp descending ─────────────────────────────────────────
    events.sort((a, b) => b._sortDate.getTime() - a._sortDate.getTime());

    // ── Paginate in-memory ───────────────────────────────────────────────────
    const total = events.length;
    const pages = Math.ceil(total / limit);
    const skip  = (page - 1) * limit;
    const paged = events.slice(skip, skip + limit);

    // Strip internal sort key
    const data = paged.map(({ _sortDate: _d, ...rest }) => rest);

    return {
      data,
      meta: { total, page, limit, pages },
    };
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  TRANSACTION AUDIT LOG (append-only AuditLog table)
  // ════════════════════════════════════════════════════════════════════════════

  async getTransactionAuditLogs(query: TransactionAuditQueryDto) {
    const { billNumber, from, to, actorId, limit = 50 } = query;

    const where: {
      entityType: string;
      billNumber?: string;
      actorId?: string;
      createdAt?: { gte?: Date; lte?: Date };
    } = { entityType: 'Transaction' };

    if (billNumber) where.billNumber = billNumber;
    if (actorId) where.actorId = actorId;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    const data = await this.prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return { data };
  }

  async getTransactionAuditByBillNumber(billNumber: string) {
    const data = await this.prisma.auditLog.findMany({
      where: { entityType: 'Transaction', billNumber },
      orderBy: { createdAt: 'asc' },
    });

    return { data };
  }
}
