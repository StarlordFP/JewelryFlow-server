import { Logger } from '@nestjs/common';
import { writeTransactionAudit } from './write-transaction-audit';

describe('writeTransactionAudit', () => {
  const logger = new Logger('test');

  it('swallows auditLog.create errors and does not rethrow', async () => {
    const tx = {
      auditLog: {
        create: jest.fn().mockRejectedValue(new Error('audit db down')),
      },
    } as any;

    await expect(
      writeTransactionAudit(tx, logger, {
        entityId: 'tx-1',
        billNumber: 'BILL-000001',
        action: 'CREATED',
        actorId: 'user-1',
      }),
    ).resolves.toBeUndefined();

    expect(tx.auditLog.create).toHaveBeenCalled();
  });
});
