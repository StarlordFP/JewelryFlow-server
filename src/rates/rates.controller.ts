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
import { RatesService } from './rates.service';
import { SetDailyRateDto, RateHistoryQueryDto } from './dto/rates.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/roles.decorator';

@ApiTags('Rates')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('rates')
export class RatesController {
  constructor(private readonly ratesService: RatesService) {}

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
  return this.ratesService.getMetalTypes()
}

}
