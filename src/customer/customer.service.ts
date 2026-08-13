import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
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
  //  CRUD
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Create a customer.
   * Phone uniqueness is enforced on the plaintext phone column.
   */
  async create(dto: CreateCustomerDto) {
    const data: any = {
      name: dto.name,
      address: dto.address,
      notes: dto.notes,
    };

    if (dto.phone) {
      const normalised = dto.phone.trim();

      // Check uniqueness before insert for a clear error message
      const existing = await this.prisma.customer.findFirst({
        where: { phone: normalised },
      });
      if (existing) {
        throw new ConflictException(
          `A customer with phone ${normalised} already exists`,
        );
      }

      data.phone = normalised;
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
        { phone: { contains: search } },
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
          phone: true,
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
        phone: true,
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
   * Lookup by raw phone number — plain string match.
   */
  async findByPhone(dto: PhoneLookupDto) {
    const normalised = dto.phone.trim();

    const customer = await this.prisma.customer.findFirst({
      where: { phone: normalised },
      select: {
        id: true,
        name: true,
        phone: true,
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

    // Phone update: plain string uniqueness check
    if (dto.phone !== undefined) {
      if (dto.phone) {
        const normalised = dto.phone.trim();

        const conflict = await this.prisma.customer.findFirst({
          where: { phone: normalised, NOT: { id } },
        });
        if (conflict) {
          throw new ConflictException(
            `Another customer already uses phone ${normalised}`,
          );
        }

        data.phone = normalised;
      } else {
        // Allow clearing the phone number
        data.phone = null;
      }
    }

    return this.prisma.customer.update({
      where: { id },
      data,
      select: {
        id: true,
        name: true,
        phone: true,
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
