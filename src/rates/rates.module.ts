import { Module } from '@nestjs/common';
import { RatesService } from './rates.service';
import { RatesController } from './rates.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports:     [PrismaModule],
  controllers: [RatesController],
  providers:   [RatesService],
  exports:     [RatesService],
})
export class RatesModule {}
