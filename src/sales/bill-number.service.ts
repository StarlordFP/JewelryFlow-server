import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * BillNumberService
 *
 * Generates sequential bill numbers: BILL-000001, BILL-000002 …
 * Never resets — strictly sequential across all time.
 * Safe inside prisma.$transaction — accepts a tx client.
 *
 * Implementation: PostgreSQL sequence `bill_number_seq`
 *
 * WHY a sequence instead of count()+1:
 *  - count()+1 is NOT atomic: two concurrent requests read the same count,
 *    both generate the same bill number → unique constraint violation.
 *  - count()+1 breaks permanently if any transaction is ever deleted
 *    (count shrinks, new numbers collide with existing bills).
 *  - nextval() is atomic at the database level — guaranteed unique under
 *    any concurrency, never repeats, never breaks on row deletion.
 *
 * Migration: prisma/migrations/20260530000001_add_bill_number_sequence/migration.sql
 */
@Injectable()
export class BillNumberService {
  constructor(private readonly prisma: PrismaService) {}

  async generate(tx?: any): Promise<string> {
    const client = tx ?? this.prisma;

    // nextval() is atomic — the DB increments and returns the value in a
    // single operation. No two callers ever receive the same number.
    const result = await client.$queryRaw<[{ nextval: bigint }]>`
      SELECT nextval('bill_number_seq')
    `;

    const seq = String(Number(result[0].nextval)).padStart(6, '0');
    return `BILL-${seq}`;
  }
}
