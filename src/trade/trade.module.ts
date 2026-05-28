import { Module } from '@nestjs/common';
import { TradeService } from './trade.service';
import { TradeController, TradePartyController } from './trade.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { StockModule } from '../stock/stock.module';

@Module({
  imports: [PrismaModule, StockModule],
  controllers: [TradePartyController, TradeController],
  providers: [TradeService],
  exports: [TradeService],
})
export class TradeModule {}
