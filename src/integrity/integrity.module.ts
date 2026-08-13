import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { IntegrityCheckService } from '../common/integrity/integrity-check.service';
import { IntegrityCheckScheduler } from '../common/integrity/integrity-check.scheduler';
import { IntegrityAdminController } from './integrity-admin.controller';

@Module({
  imports: [PrismaModule],
  controllers: [IntegrityAdminController],
  providers: [IntegrityCheckService, IntegrityCheckScheduler],
  exports: [IntegrityCheckService],
})
export class IntegrityModule {}
