import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SalesService } from './sales.service';
import {
  CreateSellDto,
  CreateReturnDto,
  CreateBuybackDto,
  CreateOldGoldDto,
  CreateExchangeDto,
  AddPaymentDto,
  SalesQueryDto,
} from './dto/sales.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/roles.decorator';

@ApiTags('Sales')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('sales')
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  // ── SELL ──────────────────────────────────────────────────────────────────

  /**
   * POST /sales/sell
   * Create a SELL transaction.
   * Multiple items per bill, jerty/jyala overridable per item.
   * Returns both ownerBill and customerBill views.
   */
  @Post('sell')
  @Roles('OWNER', 'MANAGER', 'STAFF')
  createSell(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateSellDto,
  ) {
    return this.salesService.createSell(userId, dto);
  }

  // ── RETURN ────────────────────────────────────────────────────────────────

  /**
   * POST /sales/return
   * Create a RETURN transaction.
   * Partial returns allowed — select which items from original bill.
   * Must be within 7 days of original sale.
   * Refund calculated at today's buy rate.
   */
  @Post('return')
  @Roles('OWNER', 'MANAGER', 'STAFF')
  createReturn(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateReturnDto,
  ) {
    return this.salesService.createReturn(userId, dto);
  }

  // ── EXCHANGE ──────────────────────────────────────────────────────────────

  /**
   * POST /sales/exchange
   * Create an EXCHANGE transaction.
   * Customer brings item(s) back + cash difference → takes new item(s).
   * Items in valued at buy rate, items out at sell rate.
   * Old gold accepted as items in.
   */
  @Post('exchange')
  @Roles('OWNER', 'MANAGER', 'STAFF')
  createExchange(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateExchangeDto,
  ) {
    return this.salesService.createExchange(userId, dto);
  }

  // ── BUY_BACK ──────────────────────────────────────────────────────────────

  /**
   * POST /sales/buyback
   * Shop buys back a previously sold item from customer.
   * Rate is manually entered by owner (may differ from standard buy rate).
   * Payment via cash, cheque, or online.
   */
  @Post('buyback')
  @Roles('OWNER', 'MANAGER')
  createBuyback(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateBuybackDto,
  ) {
    return this.salesService.createBuyback(userId, dto);
  }

  // ── OLD_GOLD ──────────────────────────────────────────────────────────────

  /**
   * POST /sales/old-gold
   * Customer brings old gold (not originally from this shop).
   * Valued at buy rate entered by owner.
   */
  @Post('old-gold')
  @Roles('OWNER', 'MANAGER')
  createOldGold(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateOldGoldDto,
  ) {
    return this.salesService.createOldGold(userId, dto);
  }

  // ── PAYMENT ───────────────────────────────────────────────────────────────

  /**
   * POST /sales/:id/payment
   * Record an additional payment against an existing transaction.
   * Used for partial payment settlements.
   */
  @Post(':id/payment')
  @HttpCode(HttpStatus.OK)
  @Roles('OWNER', 'MANAGER', 'STAFF')
  addPayment(
    @Param('id') id: string,
    @Body() dto: AddPaymentDto,
  ) {
    return this.salesService.addPayment(id, dto);
  }

  // ── READ ──────────────────────────────────────────────────────────────────

  /**
   * GET /sales
   * List transactions with filters:
   * txType, customerId, date range, hasBalance (unpaid), search (bill number/customer)
   */
  @Get()
  @Roles('OWNER', 'MANAGER', 'STAFF')
  list(@Query() query: SalesQueryDto) {
    return this.salesService.listTransactions(query);
  }

  /**
   * GET /sales/:id
   * Full transaction detail with ownerBill and customerBill views.
   */
  @Get(':id')
  @Roles('OWNER', 'MANAGER', 'STAFF')
  findOne(@Param('id') id: string) {
    return this.salesService.getTransaction(id);
  }

  /**
   * GET /sales/bill/:billNumber
   * Look up transaction by bill number (e.g. BILL-0042).
   */
  @Get('bill/:billNumber')
  @Roles('OWNER', 'MANAGER', 'STAFF')
  findByBillNumber(@Param('billNumber') billNumber: string) {
    return this.salesService.getTransactionByBillNumber(billNumber);
  }
}
