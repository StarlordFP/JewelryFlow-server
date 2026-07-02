import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { deriveKaratSuffix, formatCategoryKaratSku } from './sku-suffix.util';

type OriginSku = 'TRADE' | 'KARIGAR' | 'PURCHASED' | 'REMAKE';

/**
 * StockSkuService — generates unique SKUs for StockItems.
 *
 * Origin-based (unchanged): {ORIGIN_PREFIX}-{YYYYMMDD}-{SEQUENCE}
 * Category-karat (DIRECT manual entry): {SHORTCODE}-{SEQUENCE}-{KARAT_SUFFIX}
 */
@Injectable()
export class StockSkuService {
  constructor(private readonly prisma: PrismaService) {}

  private prefix(origin: OriginSku): string {
    return { TRADE: 'TRD', KARIGAR: 'KAR', PURCHASED: 'PUR', REMAKE: 'RMK' }[origin];
  }

  /** Legacy origin-based SKU — used by purchase, trade, karigar, sales buyback. */
  async generateSku(origin: OriginSku, tx?: any): Promise<string> {
    const client = tx ?? this.prisma;
    const pre = this.prefix(origin);

    const today = new Date();
    const datePart = today.toISOString().slice(0, 10).replace(/-/g, '');
    const skuPrefix = `${pre}-${datePart}-`;

    const count = await client.stockItem.count({
      where: { sku: { startsWith: skuPrefix } },
    });

    const seq = String(count + 1).padStart(4, '0');
    return `${skuPrefix}${seq}`;
  }

  /**
   * Category-karat SKU for DIRECT manual / bulk entry.
   * Must run inside the same $transaction as StockItem.create.
   */
  async generateCategoryKaratSku(
    categoryId: string,
    metalTypeId: string,
    tx: any,
  ): Promise<string> {
    const category = await tx.itemCategory.findUnique({
      where: { id: categoryId },
    });
    if (!category) {
      throw new NotFoundException(`Category ${categoryId} not found`);
    }

    const metalType = await tx.metalType.findUnique({
      where: { id: metalTypeId },
    });
    if (!metalType) {
      throw new NotFoundException(`MetalType ${metalTypeId} not found`);
    }

    const seqRow = await tx.categoryKaratSequence.upsert({
      where: {
        categoryId_metalTypeId: { categoryId, metalTypeId },
      },
      create: { categoryId, metalTypeId, lastSeq: 1 },
      update: { lastSeq: { increment: 1 } },
    });

    const karatSuffix = deriveKaratSuffix(metalType.name);
    return formatCategoryKaratSku(category.shortCode, seqRow.lastSeq, karatSuffix);
  }

  /** Read-only preview — does not increment sequence. */
  async previewCategoryKaratSku(
    categoryId: string,
    metalTypeId: string,
  ): Promise<{ nextSku: string; currentLastSeq: number }> {
    const category = await this.prisma.itemCategory.findUnique({
      where: { id: categoryId },
    });
    if (!category || !category.isActive) {
      throw new NotFoundException(`Category ${categoryId} not found or inactive`);
    }

    const metalType = await this.prisma.metalType.findUnique({
      where: { id: metalTypeId },
    });
    if (!metalType || !metalType.isActive) {
      throw new NotFoundException(`MetalType ${metalTypeId} not found or inactive`);
    }

    const seqRow = await this.prisma.categoryKaratSequence.findUnique({
      where: {
        categoryId_metalTypeId: { categoryId, metalTypeId },
      },
    });

    const currentLastSeq = seqRow?.lastSeq ?? 0;
    const nextSeq = currentLastSeq + 1;
    const karatSuffix = deriveKaratSuffix(metalType.name);

    return {
      nextSku: formatCategoryKaratSku(category.shortCode, nextSeq, karatSuffix),
      currentLastSeq,
    };
  }
}
