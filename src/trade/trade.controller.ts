import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { TradeService } from './trade.service';
import {
  CreateTradePartyDto,
  UpdateTradePartyDto,
  CreateTradeDto,
  UpdateTradeStatusDto,
  TradePartyQueryDto,
  TradeQueryDto,
} from './dto/trade.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

// ─── TRADE PARTY CONTROLLER ──────────────────────────────────────────────────

@ApiTags('Trade Parties')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('trade-parties')
export class TradePartyController {
  constructor(private readonly tradeService: TradeService) {}

  /**
   * POST /trade-parties
   * Create a new trade party (supplier).
   * Roles: OWNER, MANAGER
   */
  @Post()
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Create a new trade party', description: 'Create a supplier/trade party who gives raw metal and receives finished pieces.' })
  @ApiResponse({ status: 201, description: 'Trade party created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  create(@Body() dto: CreateTradePartyDto) {
    return this.tradeService.createTradeParty(dto);
  }

  /**
   * GET /trade-parties
   * List trade parties with optional search & pagination.
   * Roles: OWNER, MANAGER, STAFF
   */
  @Get()
  @Roles('OWNER', 'MANAGER', 'STAFF')
  @ApiOperation({ summary: 'List all trade parties', description: 'Get paginated list with optional search filter' })
  @ApiResponse({ status: 200, description: 'Trade parties retrieved successfully' })
  list(@Query() query: TradePartyQueryDto) {
    return this.tradeService.listTradeParties(query);
  }

  /**
   * GET /trade-parties/:id/summary
   * Lifetime stats: total metal given, items received, cash adjustments.
   */
  @Get(':id/summary')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Get trade party summary', description: 'Lifetime statistics for total metal given, items received, and cash adjustments' })
  @ApiParam({ name: 'id', description: 'Trade party ID' })
  @ApiResponse({ status: 200, description: 'Summary retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Trade party not found' })
  summary(@Param('id') id: string) {
    return this.tradeService.getTradePartySummary(id);
  }

  /**
   * GET /trade-parties/:id
   * Get single trade party with recent trades.
   */
  @Get(':id')
  @Roles('OWNER', 'MANAGER', 'STAFF')
  @ApiOperation({ summary: 'Get trade party details', description: 'Get single trade party with recent trades' })
  @ApiParam({ name: 'id', description: 'Trade party ID' })
  @ApiResponse({ status: 200, description: 'Trade party retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Trade party not found' })
  findOne(@Param('id') id: string) {
    return this.tradeService.getTradeParty(id);
  }

  /**
   * PATCH /trade-parties/:id
   * Update name, phone, address, or isActive.
   */
  @Patch(':id')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Update trade party', description: 'Update trade party details' })
  @ApiParam({ name: 'id', description: 'Trade party ID' })
  @ApiResponse({ status: 200, description: 'Trade party updated successfully' })
  @ApiResponse({ status: 404, description: 'Trade party not found' })
  update(@Param('id') id: string, @Body() dto: UpdateTradePartyDto) {
    return this.tradeService.updateTradeParty(id, dto);
  }

  /**
   * DELETE /trade-parties/:id
   * Soft-deactivate. Blocked if PENDING trades exist.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @Roles('OWNER')
  @ApiOperation({ summary: 'Deactivate trade party', description: 'Soft-deactivate a trade party. Blocked if PENDING trades exist.' })
  @ApiParam({ name: 'id', description: 'Trade party ID' })
  @ApiResponse({ status: 200, description: 'Trade party deactivated successfully' })
  @ApiResponse({ status: 409, description: 'Trade party has pending trades' })
  deactivate(@Param('id') id: string) {
    return this.tradeService.deactivateTradeParty(id);
  }
}

// ─── TRADE CONTROLLER ────────────────────────────────────────────────────────

@ApiTags('Trades')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('trades')
export class TradeController {
  constructor(private readonly tradeService: TradeService) {}

  /**
   * POST /trades
   * Create a trade (raw metal given → finished items received).
   * Atomically creates Trade + TradeItems + StockItems (origin=TRADE).
   * Roles: OWNER, MANAGER
   */
  @Post()
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Create a new trade', description: 'Create a trade transaction: raw metal given → finished items received. Atomically creates Trade + TradeItems + StockItems.' })
  @ApiResponse({ status: 201, description: 'Trade created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid input or validation failed' })
  @ApiResponse({ status: 404, description: 'Trade party or metal type not found' })
  create(@CurrentUser('id') userId: string, @Body() dto: CreateTradeDto) {
    return this.tradeService.createTrade(userId, dto);
  }

  /**
   * GET /trades
   * List trades with filters: tradePartyId, status, date range.
   */
  @Get()
  @Roles('OWNER', 'MANAGER', 'STAFF')
  @ApiOperation({ summary: 'List all trades', description: 'Get paginated list of trades with optional filters (party, status, date range)' })
  @ApiResponse({ status: 200, description: 'Trades retrieved successfully' })
  list(@Query() query: TradeQueryDto) {
    return this.tradeService.listTrades(query);
  }

  /**
   * GET /trades/:id
   * Full trade detail with trade party, items, and linked stock items.
   */
  @Get(':id')
  @Roles('OWNER', 'MANAGER', 'STAFF')
  @ApiOperation({ summary: 'Get trade details', description: 'Get full trade detail with trade party, items, and linked stock items' })
  @ApiParam({ name: 'id', description: 'Trade ID' })
  @ApiResponse({ status: 200, description: 'Trade retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Trade not found' })
  findOne(@Param('id') id: string) {
    return this.tradeService.getTrade(id);
  }

  /**
   * PATCH /trades/:id/status
   * Transition PENDING → COMPLETED or PENDING → CANCELLED.
   * Cancellation scraps all IN_STOCK items from the trade.
   */
  @Patch(':id/status')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Update trade status', description: 'Transition PENDING → COMPLETED or PENDING → CANCELLED. Cancellation scraps all IN_STOCK items.' })
  @ApiParam({ name: 'id', description: 'Trade ID' })
  @ApiResponse({ status: 200, description: 'Trade status updated successfully' })
  @ApiResponse({ status: 404, description: 'Trade not found' })
  @ApiResponse({ status: 409, description: 'Trade status cannot be changed' })
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateTradeStatusDto,
  ) {
    return this.tradeService.updateTradeStatus(id, dto);
  }
}