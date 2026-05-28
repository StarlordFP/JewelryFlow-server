import { Module } from '@nestjs/common';
import { StockController } from './stock.controller';
import { StockService } from './stock.service';
import { StockSkuService } from './stock-sku.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [StockController],
  providers: [StockService, StockSkuService],
  exports: [StockService, StockSkuService],
})
export class StockModule {}
