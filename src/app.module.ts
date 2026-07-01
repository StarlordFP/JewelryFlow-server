import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
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
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { DashboardModule } from './dashboard/dashboard.module';
import { LedgerModule } from './ledger/ledger.module';
import { AuditModule } from './audit/audit.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),

    ThrottlerModule.forRoot([
      {
        name:  'default',
        ttl:   60_000,
        limit: 100,
      },
    ]),

    PassportModule.register({ defaultStrategy: 'jwt' }),

    JwtModule.registerAsync({
      imports:    [ConfigModule],
      inject:     [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret:      config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: '15m' },
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
    DashboardModule,
    LedgerModule,
    AuditModule,
  ],

  providers: [
    { provide: APP_FILTER,       useClass: HttpExceptionFilter },
    { provide: APP_INTERCEPTOR,  useClass: TransformInterceptor },

    // ── Global guards — order matters ────────────────────────────────────────
    // ThrottlerGuard runs first — rate limit before auth
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // JwtAuthGuard runs second — auth on everything unless @Public()
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}