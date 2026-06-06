import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');

  app.setGlobalPrefix('api/v1');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // ── CORS — driven by env, not hardcoded ──────────────────────────────────
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') ?? [];
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // ── Swagger — dev only, never expose in production ───────────────────────
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('JewelryFlow ERP API')
      .setDescription(
        'Complete API for JewelryFlow ERP — a jewelry shop management system.\n\n' +
        '## Modules\n' +
        '- **Customers** — Register, search, lookup by phone (hashed), transaction history & lifetime summary\n' +
        '- **Stock** — Inventory management with jerty/jyala pricing, addons, price preview, and suggestions\n' +
        '- **Trade Parties** — Supplier (karigar/trade party) management with lifetime stats\n' +
        '- **Trades** — Raw metal ↔ finished item trade transactions with status lifecycle\n\n' +
        '## Authentication\n' +
        'All endpoints require a JWT Bearer token. Include it in the `Authorization` header as `Bearer <token>`.\n\n' +
        '## Roles\n' +
        '- `OWNER` — Full access\n' +
        '- `MANAGER` — Most operations except deactivation of trade parties\n' +
        '- `STAFF` — Read-only + customer registration + price preview',
       )
      .setVersion('1.0')
      .addBearerAuth()
      .addTag('Auth', 'Authentication and user management')
      .addTag('Customers', 'Customer registration, lookup, transaction history & summary')
      .addTag('Stock', 'Inventory management — add, update, status, price preview & suggestions')
      .addTag('Purchase', 'Supplier management, purchase orders, and receiving stock')
      .addTag('Karigar', 'Karigar production orders, returns, payments, and disputes')
      .addTag('Sales', 'Sales transactions, returns, exchanges, buybacks, and payments')
      .addTag('Rates', 'Daily metal rates and rate history')
      .addTag('Trade Parties', 'Supplier / trade party management')
      .addTag('Trades', 'Raw metal ↔ finished item trade transactions')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document);
    logger.log(`📚 Swagger docs available at http://localhost:${process.env.PORT ?? 4000}/docs`);
  }

  const port = process.env.PORT ?? 4000;
  await app.listen(port);
  logger.log(`JewelryFlow API running on http://localhost:${port}/api/v1`);
}

bootstrap();