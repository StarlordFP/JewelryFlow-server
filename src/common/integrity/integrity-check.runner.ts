import { PrismaClient } from '@prisma/client';

export type CheckSeverity = 'PASS' | 'WARN' | 'FAIL';

export interface IntegrityCheckResult {
  checkName: string;
  severity: CheckSeverity;
  message: string;
}

export const CRITICAL_TABLES = [
  'transactions',
  'stock_items',
  'customers',
  'karigars',
  'production_orders',
  'daily_rates',
  'audit_logs',
] as const;

export type CriticalTable = (typeof CRITICAL_TABLES)[number];

export type RowCountBaseline = Partial<Record<CriticalTable, number>>;

const TABLE_LABELS: Record<CriticalTable, string> = {
  transactions: 'transactions',
  stock_items: 'stock_items',
  customers: 'customers',
  karigars: 'karigars',
  production_orders: 'production_orders',
  daily_rates: 'daily_rates',
  audit_logs: 'audit_logs',
};

async function getRowCounts(prisma: PrismaClient): Promise<Record<CriticalTable, number>> {
  const [
    transactions,
    stock_items,
    customers,
    karigars,
    production_orders,
    daily_rates,
    audit_logs,
  ] = await Promise.all([
    prisma.transaction.count(),
    prisma.stockItem.count(),
    prisma.customer.count(),
    prisma.karigar.count(),
    prisma.productionOrder.count(),
    prisma.dailyRate.count(),
    prisma.auditLog.count(),
  ]);

  return {
    transactions,
    stock_items,
    customers,
    karigars,
    production_orders,
    daily_rates,
    audit_logs,
  };
}

function rowCountChecks(
  counts: Record<CriticalTable, number>,
  baseline?: RowCountBaseline,
): IntegrityCheckResult[] {
  return CRITICAL_TABLES.map((table) => {
    const current = counts[table];
    const base = baseline?.[table];

    if (base === undefined) {
      return {
        checkName: `${table}_row_count`,
        severity: 'PASS',
        message: `${TABLE_LABELS[table]} — ${current} rows (no baseline)`,
      };
    }

    const change = current - base;
    if (change < 0) {
      return {
        checkName: `${table}_row_count`,
        severity: 'WARN',
        message: `${TABLE_LABELS[table]} — ${current} rows (baseline: ${base}, change: ${change})`,
      };
    }

    return {
      checkName: `${table}_row_count`,
      severity: 'PASS',
      message: `${TABLE_LABELS[table]} — ${current} rows (baseline: ${base}, change: ${change >= 0 ? `+${change}` : change})`,
    };
  });
}

export async function runIntegrityChecks(
  prisma: PrismaClient,
  baseline?: RowCountBaseline,
): Promise<IntegrityCheckResult[]> {
  const results: IntegrityCheckResult[] = [];
  const counts = await getRowCounts(prisma);
  results.push(...rowCountChecks(counts, baseline));

  const [
    missingBillNumber,
    sellNullStock,
    inStockOnSell,
    orphanedSold,
    overpaidBills,
    duplicateCurrentRates,
    orphanedAudit,
    brokenStockFk,
    brokenMetalFk,
    billSeqGap,
    karatSeqIssues,
  ] = await Promise.all([
    prisma.transaction.count({ where: { billNumber: '' } }),
    prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*)::bigint AS count
      FROM transaction_lines tl
      JOIN transactions t ON t.id = tl."transactionId"
      WHERE t."txType" = 'SELL' AND tl."stockItemId" IS NULL
    `.then((r) => Number(r[0].count)),
    prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(DISTINCT si.id)::bigint AS count
      FROM stock_items si
      JOIN transaction_lines tl ON tl."stockItemId" = si.id
      JOIN transactions t ON t.id = tl."transactionId"
      WHERE si.status = 'IN_STOCK' AND t."txType" = 'SELL'
    `.then((r) => Number(r[0].count)),
    prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*)::bigint AS count
      FROM stock_items si
      WHERE si.status = 'SOLD'
        AND NOT EXISTS (
          SELECT 1 FROM transaction_lines tl WHERE tl."stockItemId" = si.id
        )
    `.then((r) => Number(r[0].count)),
    prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*)::bigint AS count
      FROM transactions
      WHERE "grandTotalNpr" < "paidAmountNpr" - 0.01
    `.then((r) => Number(r[0].count)),
    prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*)::bigint AS count
      FROM (
        SELECT "metalTypeId"
        FROM daily_rates
        WHERE "isCurrent" = true
        GROUP BY "metalTypeId"
        HAVING COUNT(*) > 1
      ) dup
    `.then((r) => Number(r[0].count)),
    prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*)::bigint AS count
      FROM audit_logs al
      WHERE al."entityType" = 'Transaction'
        AND NOT EXISTS (
          SELECT 1 FROM transactions t WHERE t.id = al."entityId"
        )
    `.then((r) => Number(r[0].count)),
    prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*)::bigint AS count
      FROM transaction_lines tl
      WHERE tl."stockItemId" IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM stock_items si WHERE si.id = tl."stockItemId"
        )
    `.then((r) => Number(r[0].count)),
    prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*)::bigint AS count
      FROM stock_items si
      WHERE NOT EXISTS (
        SELECT 1 FROM metal_types mt WHERE mt.id = si."metalTypeId"
      )
    `.then((r) => Number(r[0].count)),
    checkBillSequenceGap(prisma, counts.transactions),
    checkKaratSequenceIntegrity(prisma),
  ]);

  results.push(
    missingBillNumber === 0
      ? { checkName: 'missing_bill_number', severity: 'PASS', message: 'No transactions with missing billNumber' }
      : { checkName: 'missing_bill_number', severity: 'FAIL', message: `${missingBillNumber} transactions with missing billNumber` },
  );

  results.push(
    sellNullStock === 0
      ? { checkName: 'sell_null_stock_item', severity: 'PASS', message: 'No SELL transactions with null stockItemId' }
      : { checkName: 'sell_null_stock_item', severity: 'FAIL', message: `${sellNullStock} SELL transaction lines with null stockItemId` },
  );

  results.push(
    inStockOnSell === 0
      ? { checkName: 'in_stock_on_sell', severity: 'PASS', message: 'No IN_STOCK items appearing on SELL lines' }
      : { checkName: 'in_stock_on_sell', severity: 'FAIL', message: `${inStockOnSell} stock items show IN_STOCK but appear in SELL lines` },
  );

  results.push(
    orphanedSold === 0
      ? { checkName: 'orphaned_sold_stock', severity: 'PASS', message: 'No orphaned SOLD stock items' }
      : { checkName: 'orphaned_sold_stock', severity: 'FAIL', message: `${orphanedSold} SOLD stock items not linked to any transaction line` },
  );

  results.push(
    overpaidBills === 0
      ? { checkName: 'overpaid_bills', severity: 'PASS', message: 'No overpaid bills (grandTotal < paidAmount)' }
      : { checkName: 'overpaid_bills', severity: 'FAIL', message: `${overpaidBills} transactions where grandTotalNpr < paidAmountNpr - 0.01` },
  );

  results.push(
    duplicateCurrentRates === 0
      ? { checkName: 'duplicate_current_rates', severity: 'PASS', message: 'No duplicate isCurrent daily rates per metal type' }
      : { checkName: 'duplicate_current_rates', severity: 'FAIL', message: `${duplicateCurrentRates} metal types have multiple isCurrent=true daily rates` },
  );

  results.push(
    orphanedAudit === 0
      ? { checkName: 'orphaned_transaction_audit', severity: 'PASS', message: 'No orphaned Transaction audit log entries' }
      : { checkName: 'orphaned_transaction_audit', severity: 'FAIL', message: `${orphanedAudit} audit log entries reference deleted transactions` },
  );

  results.push(
    brokenStockFk === 0
      ? { checkName: 'broken_stock_item_fk', severity: 'PASS', message: 'No transaction lines with missing stock items' }
      : { checkName: 'broken_stock_item_fk', severity: 'FAIL', message: `${brokenStockFk} transaction lines reference non-existent stock items` },
  );

  results.push(
    brokenMetalFk === 0
      ? { checkName: 'broken_metal_type_fk', severity: 'PASS', message: 'No stock items with missing metal types' }
      : { checkName: 'broken_metal_type_fk', severity: 'FAIL', message: `${brokenMetalFk} stock items reference non-existent metal types` },
  );

  results.push(billSeqGap);
  results.push(...karatSeqIssues);

  return results;
}

async function checkBillSequenceGap(
  prisma: PrismaClient,
  txCount: number,
): Promise<IntegrityCheckResult> {
  const [maxBillRow] = await prisma.$queryRaw<[{ max_seq: number | null }]>`
    SELECT MAX(CAST(SUBSTRING("billNumber" FROM 6) AS INT)) AS max_seq
    FROM transactions
    WHERE "billNumber" LIKE 'BILL-%'
  `;
  const [seqRow] = await prisma.$queryRaw<[{ last_value: bigint }]>`
    SELECT last_value FROM bill_number_seq
  `;

  const maxBillSeq = maxBillRow?.max_seq ?? 0;
  const seqValue = Number(seqRow?.last_value ?? 0);
  const gapFromSeq = seqValue - txCount;
  const gapFromMax = maxBillSeq - txCount;

  if (gapFromSeq > 20 || gapFromMax > 20) {
    return {
      checkName: 'bill_number_sequence_gap',
      severity: 'WARN',
      message: `Bill number gaps detected (tx count: ${txCount}, max bill seq: ${maxBillSeq}, sequence: ${seqValue})`,
    };
  }

  return {
    checkName: 'bill_number_sequence_gap',
    severity: 'PASS',
    message: `Bill number sequence OK (tx count: ${txCount}, max: ${maxBillSeq}, seq: ${seqValue})`,
  };
}

async function checkKaratSequenceIntegrity(
  prisma: PrismaClient,
): Promise<IntegrityCheckResult[]> {
  const mismatches = await prisma.$queryRaw<
    { category_id: string; metal_type_id: string; actual_count: bigint; last_seq: number }[]
  >`
    SELECT
      cks."categoryId" AS category_id,
      cks."metalTypeId" AS metal_type_id,
      cks."lastSeq" AS last_seq,
      COUNT(si.id)::bigint AS actual_count
    FROM category_karat_sequences cks
    LEFT JOIN stock_items si
      ON si."categoryId" = cks."categoryId"
     AND si."metalTypeId" = cks."metalTypeId"
    GROUP BY cks."categoryId", cks."metalTypeId", cks."lastSeq"
    HAVING cks."lastSeq" < COUNT(si.id)
  `;

  if (mismatches.length === 0) {
    return [{
      checkName: 'category_karat_sequence',
      severity: 'PASS',
      message: 'CategoryKaratSequence counters match stock item counts',
    }];
  }

  return mismatches.map((m) => ({
    checkName: 'category_karat_sequence',
    severity: 'WARN',
    message: `Sequence reset? category ${m.category_id} / metal ${m.metal_type_id}: lastSeq=${m.last_seq}, actual=${Number(m.actual_count)}`,
  }));
}

export function formatCheckLine(result: IntegrityCheckResult): string {
  const icon = result.severity === 'PASS' ? '✅ PASS' : result.severity === 'WARN' ? '⚠️  WARN' : '❌ FAIL';
  return `${icon}: ${result.message}`;
}

export function hasIntegrityIssues(results: IntegrityCheckResult[]): boolean {
  return results.some((r) => r.severity === 'WARN' || r.severity === 'FAIL');
}

export async function fetchCurrentRowCounts(prisma: PrismaClient): Promise<Record<CriticalTable, number>> {
  return getRowCounts(prisma);
}
