import { Module } from '@nestjs/common';
import { KarigarService } from './karigar.service';
import {
  KarigarController,
  ProductionOrderController,
  ProductionOrderLineController,
  ProductionIssueController,
  ProductionReturnController,
  KarigarPaymentController,
  KarigarDisputeController,
} from './karigar.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { StockModule } from '../stock/stock.module';

@Module({
  imports:     [PrismaModule, StockModule],
  controllers: [
    KarigarController,
    ProductionOrderController,
    ProductionOrderLineController,
    ProductionIssueController,
    ProductionReturnController,
    KarigarPaymentController,
    KarigarDisputeController,
  ],
  providers: [KarigarService],
  exports:   [KarigarService],
})
export class KarigarModule {}
