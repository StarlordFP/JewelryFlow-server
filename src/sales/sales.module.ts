import { Module } from '@nestjs/common';
import { SalesService } from './sales.service';
import { SalesController } from './sales.controller';
import { BillNumberService } from './bill-number.service';
import { PrismaModule } from '../prisma/prisma.module';
import { StockModule } from '../stock/stock.module';

@Module({
  imports:     [PrismaModule, StockModule],
  controllers: [SalesController],
  providers:   [SalesService, BillNumberService],
  exports:     [SalesService],
})
export class SalesModule {}
