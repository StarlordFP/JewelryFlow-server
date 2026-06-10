// src/ledger/ledger.module.ts

import { Module } from '@nestjs/common';
import { LedgerController } from './ledger.controller';
import { LedgerService } from './ledger.service';

/**
 * LedgerModule — no external imports needed.
 * PrismaModule is @Global so PrismaService is injected directly.
 */
@Module({
  controllers: [LedgerController],
  providers:   [LedgerService],
})
export class LedgerModule {}
