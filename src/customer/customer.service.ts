import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { WeightUtil } from '../common/utils/weight.util';
import {
  CreateCustomerDto,
  UpdateCustomerDto,
  CustomerQueryDto,
  PhoneLookupDto,
} from './dto/customer.dto';

@Injectable()
export class CustomerService {
  constructor(private readonly prisma: PrismaService) {}

  // ════════════════════════════════════════════════════════════════════════════
  //  PHONE HELPERS
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Normalise + hash a raw phone number.
   * Strips spaces, dashes, and brackets before hashing so
   * "+977-9841 123456" and "9841123456" hash identically.
   */
  private normalisePhone(raw: string): string {
    return raw.replace(/[\s\-()]/g, '');
  }

  private hashPhone(normalised: string): string {
    return createHash('sha256').update(normalised).digest('hex');
  }

  /** Returns last 4 digits for display ("****1234") */
  private phoneHint(normalised: string): string {
    const digits = normalised.replace(/\D/g, '');
    return `****${digits.slice(-4)}`;
  }

  private preparePhoneFields(raw: string) {
    const normalised = this.normalisePhone(raw);
    return {
      phoneHash: this.hashPhone(normalised),
      phoneHint: this.phoneHint(normalised),
    };
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  CRUD
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Create a customer.
   * Phone uniqueness is enforced on the SHA-256 hash column.
   */
  async create(dto: CreateCustomerDto) {
    const data: any = {
      name: dto.name,
      address: dto.address,
      notes: dto.notes,
    };

    if (dto.phone) {
      const fields = this.preparePhoneFields(dto.phone);

      // Check uniqueness before insert for a clear error message
      const existing = await this.prisma.customer.findUnique({
        where: { phoneHash: fields.phoneHash },
      });
      if (existing) {
        throw new ConflictException(
          `A customer with phone ending in ${fields.phoneHint} already exists`,
        );
      }

      data.phoneHash = fields.phoneHash;
      data.phoneHint = fields.phoneHint;
    }

    return this.prisma.customer.create({ data });
  }

  async list(query: CustomerQueryDto) {
    const { search, isActive, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (isActive !== undefined) where.isActive = isActive;

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { phoneHint: { contains: search } },
      ];
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({
        where,
        orderBy: { name: 'asc' },
        skip,
        take: limit,
        select: {
          id: true,
          name: true,
          phoneHint: true,  // never return phoneHash
          address: true,
          notes: true,
          isActive: true,
          createdAt: true,
          _count: { select: { transactions: true } },
        },
      }),
      this.prisma.customer.count({ where }),
    ]);

    return {
      data: items,
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    };
  }

  async findById(id: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        phoneHint: true,
        address: true,
        notes: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { transactions: true, buybackRecords: true } },
      },
    });

    if (!customer) throw new NotFoundException(`Customer ${id} not found`);
    return customer;
  }

  /**
   * Lookup by raw phone number.
   * Hashes the input and queries on phoneHash for a constant-time comparison.
   */
  async findByPhone(dto: PhoneLookupDto) {
    const { phoneHash } = this.preparePhoneFields(dto.phone);

    const customer = await this.prisma.customer.findUnique({
      where: { phoneHash },
      select: {
        id: true,
        name: true,
        phoneHint: true,
        address: true,
        isActive: true,
        createdAt: true,
      },
    });

    if (!customer) throw new NotFoundException('No customer found with that phone number');
    return customer;
  }

  async update(id: string, dto: UpdateCustomerDto) {
    await this.findOrThrow(id);

    const data: any = {};

    if (dto.name) data.name = dto.name;
    if (dto.address !== undefined) data.address = dto.address;
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    // Phone update: re-hash the new number, check uniqueness
    if (dto.phone) {
      const fields = this.preparePhoneFields(dto.phone);

      const conflict = await this.prisma.customer.findFirst({
        where: { phoneHash: fields.phoneHash, NOT: { id } },
      });
      if (conflict) {
        throw new ConflictException(
          `Another customer already uses phone ending in ${fields.phoneHint}`,
        );
      }

      data.phoneHash = fields.phoneHash;
      data.phoneHint = fields.phoneHint;
    }

    return this.prisma.customer.update({
      where: { id },
      data,
      select: {
        id: true,
        name: true,
        phoneHint: true,
        address: true,
        notes: true,
        isActive: true,
        updatedAt: true,
      },
    });
  }

  /**
   * Deactivate (soft-delete). Does NOT block based on transaction history
   * since transactions are immutable historical records.
   */
  async deactivate(id: string) {
    await this.findOrThrow(id);
    return this.prisma.customer.update({
      where: { id },
      data: { isActive: false },
      select: { id: true, name: true, isActive: true },
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  CUSTOMER LEDGER / HISTORY
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Full purchase history for a customer: transactions + buybacks.
   * Paginated, newest first.
   */
  async getTransactionHistory(
    id: string,
    page = 1,
    limit = 20,
  ) {
    await this.findOrThrow(id);

    const skip = (page - 1) * limit;

    const [transactions, total] = await this.prisma.$transaction([
      this.prisma.transaction.findMany({
        where: { customerId: id },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          relatedTx: { select: { id: true, billNumber: true, txType: true } },
        },
      }),
      this.prisma.transaction.count({ where: { customerId: id } }),
    ]);

    return {
      data: transactions,
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    };
  }

  /**
   * Past SELL bills for a customer with line-item detail (read-only).
   * Newest first, grouped by transaction/bill.
   */
  async getPastSales(id: string) {
    await this.findOrThrow(id);

    const transactions = await this.prisma.transaction.findMany({
      where: { customerId: id, txType: 'SELL' },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        billNumber: true,
        createdAt: true,
        lines: {
          include: {
            stockItem: {
              include: {
                category: { select: { name: true } },
                metalType: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });

    return {
      transactions: transactions.map((tx) => ({
        id: tx.id,
        billNumber: tx.billNumber,
        createdAt: tx.createdAt,
        lines: tx.lines.map((line) => {
          const description =
            line.stockItem?.name?.trim() ||
            [line.stockItem?.category?.name, line.stockItem?.metalType?.name]
              .filter(Boolean)
              .join(' ') ||
            'Item';

          return {
            lineId: line.id,
            stockItemId: line.stockItemId,
            description,
            metalTypeId: line.stockItem?.metalType?.id ?? null,
            metalTypeName: line.stockItem?.metalType?.name ?? null,
            weight: WeightUtil.forBill(Number(line.grossWeightGram)),
            ratePerGram: Number(line.ratePerGram),
          };
        }),
      })),
    };
  }

  /**
   * Lifetime value summary for a customer.
   * Aggregates transaction counts by type.
   */
  async getCustomerSummary(id: string) {
    await this.findOrThrow(id);

    const [txCount, buybackCount] = await this.prisma.$transaction([
      this.prisma.transaction.count({ where: { customerId: id } }),
      this.prisma.buybackRecord.count({ where: { customerId: id } }),
    ]);

    return {
      customerId: id,
      totalTransactions: txCount,
      totalBuybacks: buybackCount,
    };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private async findOrThrow(id: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id } });
    if (!customer) throw new NotFoundException(`Customer ${id} not found`);
    return customer;
  }
}
