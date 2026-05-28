import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * StockSkuService — generates unique, human-readable SKUs for StockItems.
 *
 * Format:  {ORIGIN_PREFIX}-{YYYYMMDD}-{SEQUENCE}
 * Examples:
 *   TRD-20260315-0001   ← origin=TRADE
 *   KAR-20260315-0042   ← origin=KARIGAR
 *   PUR-20260315-0007   ← origin=PURCHASED
 *
 * The sequence resets daily per origin prefix.
 * Safe inside Prisma $transaction (accepts a tx client).
 */
@Injectable()
export class StockSkuService {
  constructor(private readonly prisma: PrismaService) {}

  private prefix(origin: 'TRADE' | 'KARIGAR' | 'PURCHASED'): string {
    return { TRADE: 'TRD', KARIGAR: 'KAR', PURCHASED: 'PUR' }[origin];
  }

  async generateSku(
    origin: 'TRADE' | 'KARIGAR' | 'PURCHASED',
    tx?: any, // accepts prisma $transaction client
  ): Promise<string> {
    const client = tx ?? this.prisma;
    const pre = this.prefix(origin);

    const today = new Date();
    const datePart = today.toISOString().slice(0, 10).replace(/-/g, '');  // YYYYMMDD
    const skuPrefix = `${pre}-${datePart}-`;

    // Count existing SKUs with this prefix to derive the next sequence number
    const count = await client.stockItem.count({
      where: { sku: { startsWith: skuPrefix } },
    });

    const seq = String(count + 1).padStart(4, '0');
    return `${skuPrefix}${seq}`;
  }
}
