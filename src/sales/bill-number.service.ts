import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * BillNumberService
 *
 * Generates sequential bill numbers: BILL-0001, BILL-0002 ...
 * Never resets — strictly sequential across all time.
 * The bill date and daily rate are stored separately on the Transaction.
 *
 * Safe inside prisma.$transaction — accepts a tx client.
 */
@Injectable()
export class BillNumberService {
  constructor(private readonly prisma: PrismaService) {}

  async generate(tx?: any): Promise<string> {
    const client = tx ?? this.prisma;

    // Count existing transactions to derive next number
    const count = await client.transaction.count();
    const seq   = String(count + 1).padStart(4, '0');
    return `BILL-${seq}`;
  }
}
