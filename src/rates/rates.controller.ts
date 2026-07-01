import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { RatesService } from './rates.service';
import { RatesFetchService } from './rates-fetch.service';
import {
  SetDailyRateDto,
  RateHistoryQueryDto,
  SetGoldRatesDto,
  DerivePreviewQueryDto,
  ConfirmRatesDto,
  PatchRatesSettingsDto,
} from './dto/rates.dto';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/roles.decorator';

@ApiTags('Rates')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller('rates')
export class RatesController {
  constructor(
    private readonly ratesService: RatesService,
    private readonly fetchService: RatesFetchService,
  ) {}

  /**
   * POST /rates/gold
   * Set gold rates for all karat types derived from 24K base rate.
   * Roles: OWNER, MANAGER
   */
  @Post('gold')
  @Roles('OWNER', 'MANAGER')
  setGoldRates(
    @CurrentUser('id') userId: string,
    @Body() dto: SetGoldRatesDto,
  ) {
    return this.ratesService.setGoldRatesFrom24K(userId, dto);
  }

  /**
   * POST /rates
   * Set today's buy and sell rate for a metal type.
   * Old rate auto-expires. Derives per-tola and per-lal automatically.
   * Roles: OWNER, MANAGER
   */
  @Post()
  @Roles('OWNER', 'MANAGER')
  setRate(
    @CurrentUser('id') userId: string,
    @Body() dto: SetDailyRateDto,
  ) {
    return this.ratesService.setRate(userId, dto);
  }

  /**
   * POST /rates/confirm
   * Confirm fetch-derived rates (gold karats + silver) with optional per-row overrides.
   */
  @Post('confirm')
  @Roles('OWNER', 'MANAGER')
  confirmRates(
    @CurrentUser('id') userId: string,
    @Body() dto: ConfirmRatesDto,
  ) {
    return this.ratesService.confirmRates(userId, dto);
  }

  /**
   * GET /rates/derive-preview
   * Preview derived shop rates from fine gold + pure silver base rates.
   */
  @Get('derive-preview')
  @Roles('OWNER', 'MANAGER')
  derivePreview(@Query() query: DerivePreviewQueryDto) {
    return this.ratesService.derivePreview(
      query.fineGoldSellPerGram,
      query.pureSilverSellPerGram,
    );
  }

  /**
   * GET /rates/fetch/latest
   * Latest fetched rate snapshot (any status).
   */
  @Get('fetch/latest')
  @Roles('OWNER', 'MANAGER')
  getLatestFetch() {
    return this.fetchService.getLatestSnapshot();
  }

  /**
   * POST /rates/fetch/run
   * Manually trigger a fetch from FENEGOSIDA.
   */
  @Post('fetch/run')
  @HttpCode(HttpStatus.OK)
  @Roles('OWNER', 'MANAGER')
  runFetch() {
    return this.fetchService.runFetch(true);
  }

  /**
   * GET /rates/settings
   * Global buy discount and per-metal overrides.
   */
  @Get('settings')
  @Roles('OWNER', 'MANAGER')
  getSettings() {
    return this.ratesService.getSettings();
  }

  /**
   * PATCH /rates/settings
   * Update global buy discount or per-metal override.
   */
  @Patch('settings')
  @Roles('OWNER', 'MANAGER')
  patchSettings(@Body() dto: PatchRatesSettingsDto) {
    return this.ratesService.patchSettings(dto);
  }

  /**
   * GET /rates/today
   * Get all current rates — one per metal type.
   * Used on dashboard every morning.
   */
  @Get('today')
  @Roles('OWNER', 'MANAGER', 'STAFF')
  getTodaysRates() {
    return this.ratesService.getTodaysRates();
  }

  /**
   * GET /rates/today/:metalTypeId
   * Get current rate for a specific metal type.
   */
  @Get('today/:metalTypeId')
  @Roles('OWNER', 'MANAGER', 'STAFF')
  getCurrentRate(@Param('metalTypeId') metalTypeId: string) {
    return this.ratesService.getCurrentRate(metalTypeId);
  }

  /**
   * GET /rates/history
   * Rate history — all past rates, newest first.
   * Filter by metalTypeId and date range.
   */
  @Get('history')
  @Roles('OWNER', 'MANAGER')
  getHistory(@Query() query: RateHistoryQueryDto) {
    return this.ratesService.getRateHistory(query);
  }

  @Get('metal-types')
  @Roles('OWNER', 'MANAGER', 'STAFF')
  getMetalTypes() {
    return this.ratesService.getMetalTypes();
  }
}
