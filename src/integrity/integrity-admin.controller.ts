import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { IntegrityCheckService } from '../common/integrity/integrity-check.service';

@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles('OWNER')
@Controller('admin')
export class IntegrityAdminController {
  constructor(private readonly integrityService: IntegrityCheckService) {}

  /**
   * GET /api/v1/admin/integrity-alerts
   * Returns unresolved data-integrity alerts for the owner.
   */
  @Get('integrity-alerts')
  @ApiOperation({ summary: 'List active data integrity alerts (OWNER only)' })
  listIntegrityAlerts() {
    return this.integrityService.listActiveAlerts();
  }
}
