import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { StockModule } from './stock/stock.module';
import { TradeModule } from './trade/trade.module';
import { CustomerModule } from './customer/customer.module';
import { SalesModule } from './sales/sales.module';
import { RatesModule } from './rates/rates.module';
import { PurchaseModule } from './purchase/purchase.module';
import { KarigarModule } from './karigar/karigar.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    PassportModule.register({ defaultStrategy: 'jwt' }),

    // ── JwtModule.registerAsync — waits for ConfigModule to load ────────────
    // Previously used JwtModule.register({ secret: process.env.JWT_SECRET })
    // which reads the env var at module load time, before ConfigModule has
    // populated process.env — risking secret being undefined in some deploys.
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: '8h' },
      }),
    }),

    PrismaModule,
    StockModule,
    AuthModule,
    TradeModule,
    CustomerModule,
    SalesModule,
    RatesModule,
    PurchaseModule,
    KarigarModule,
  ],

  providers: [
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
  ],
})
export class AppModule {}