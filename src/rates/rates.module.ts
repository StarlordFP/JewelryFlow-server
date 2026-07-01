import { Module } from '@nestjs/common';
import { RatesService } from './rates.service';
import { RatesController } from './rates.controller';
import { RatesFetchService } from './rates-fetch.service';
import { RatesFetchScheduler } from './rates-fetch.scheduler';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports:     [PrismaModule],
  controllers: [RatesController],
  providers:   [RatesService, RatesFetchService, RatesFetchScheduler],
  exports:     [RatesService],
})
export class RatesModule {}
