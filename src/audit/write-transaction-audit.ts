import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export async function writeTransactionAudit(
  tx: Prisma.TransactionClient,
  logger: Logger,
  entry: {
    entityId: string;
    billNumber: string;
    action: string;
    actorId?: string;
    actorName?: string;
    after?: object;
    metadata?: object;
  },
): Promise<void> {
  try {
    await tx.auditLog.create({
      data: {
        entityType: 'Transaction',
        entityId: entry.entityId,
        billNumber: entry.billNumber,
        action: entry.action,
        actorId: entry.actorId,
        actorName: entry.actorName,
        ...(entry.after != null ? { after: entry.after } : {}),
        ...(entry.metadata != null ? { metadata: entry.metadata } : {}),
      },
    });
  } catch (err) {
    logger.error(
      `Failed to write transaction audit (${entry.action}, bill ${entry.billNumber})`,
      err instanceof Error ? err.stack : String(err),
    );
  }
}
