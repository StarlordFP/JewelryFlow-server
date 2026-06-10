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
import { GoldLedgerQueryDto } from './dto/ledger.dto';
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
