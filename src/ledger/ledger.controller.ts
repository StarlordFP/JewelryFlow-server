// src/ledger/ledger.controller.ts

import { Controller, Get, Query, Param, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
} from '@nestjs/swagger';
import { LedgerService } from './ledger.service';
import { GoldLedgerQueryDto, ProfitReportQueryDto } from './dto/ledger.dto';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('Ledger')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller('ledger')
export class LedgerController {
  constructor(private readonly ledgerService: LedgerService) {}

  /**
   * GET /ledger/gold
   * Unified gold movement ledger across all sources:
   *   PURCHASE_IN, KARIGAR_OUT, KARIGAR_IN,
   *   TRADE_OUT, TRADE_IN, SALE_OUT, RETURN_IN
   *
   * Roles: OWNER, MANAGER
   */
  @Get('gold')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({
    summary: 'Get gold ledger',
    description:
      'Returns a unified, paginated gold movement ledger aggregated from purchases, ' +
      'karigar issues/returns, trades, sales and returns. ' +
      'Positive weights = metal IN; negative weights = metal OUT.',
  })
  @ApiResponse({
    status: 200,
    description: 'Gold ledger retrieved successfully',
  })
  getGoldLedger(@Query() query: GoldLedgerQueryDto) {
    return this.ledgerService.getGoldLedger(query);
  }

  /**
   * GET /ledger/profit
   * Per-sold-line comparison of purchase/entry rate (cost) vs sold rate, with
   * the resulting metal-level profit, plus a summary.
   *
   * Roles: OWNER, MANAGER
   */
  @Get('profit')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({
    summary: 'Get profit / rate-comparison report',
    description:
      'For every sold item line, returns the rate it was acquired at (cost) — ' +
      'from the purchase rate or the stock-entry rate — alongside the rate it was ' +
      'sold at, and the resulting metal-level profit. Includes a summary of total ' +
      'revenue, cost and profit. Profit totals only include lines with a known cost rate.',
  })
  @ApiResponse({ status: 200, description: 'Profit report retrieved successfully' })
  getProfitReport(@Query() query: ProfitReportQueryDto) {
    return this.ledgerService.getProfitReport(query);
  }

  /**
   * GET /ledger/customer/:id
   * Full customer ledger — profile, financial summary, all transactions
   * with their payment breakdowns.
   *
   * Roles: OWNER, MANAGER
   */
  @Get('customer/:id')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({
    summary: 'Get customer ledger',
    description:
      'Returns the customer profile, a financial summary (total purchases, ' +
      'paid, outstanding balance, returns, buybacks) and a full list of all ' +
      'transactions with payment breakdowns, sorted newest first.',
  })
  @ApiParam({ name: 'id', description: 'Customer ID' })
  @ApiResponse({ status: 200, description: 'Customer ledger retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Customer not found' })
  getCustomerLedger(@Param('id') id: string) {
    return this.ledgerService.getCustomerLedger(id);
  }
}
