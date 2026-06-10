import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('Dashboard')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  /**
   * GET /dashboard
   * Returns all data needed for the dashboard in one call.
   * Runs all queries in parallel for performance.
   */
  @Get()
  @Roles('OWNER', 'MANAGER', 'STAFF')
  @ApiOperation({
    summary: 'Get dashboard data',
    description: 'Returns today stats, current rates, stock snapshot, recent transactions and pending items in one call',
  })
  getDashboard() {
    return this.dashboardService.getDashboard();
  }
}