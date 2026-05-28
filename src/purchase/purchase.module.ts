import { Module } from '@nestjs/common';
import { PurchaseService } from './purchase.service';
import { SupplierController, PurchaseOrderController } from './purchase.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { StockModule } from '../stock/stock.module';

@Module({
  imports:     [PrismaModule, StockModule],
  controllers: [SupplierController, PurchaseOrderController],
  providers:   [PurchaseService],
  exports:     [PurchaseService],
})
export class PurchaseModule {}
