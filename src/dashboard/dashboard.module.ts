import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { PrismaModule } from '../prisma/prisma.module';
import { StockModule } from '../stock/stock.module';

@Module({
  imports:     [PrismaModule, StockModule],
  controllers: [DashboardController],
  providers:   [DashboardService],
})
export class DashboardModule {}