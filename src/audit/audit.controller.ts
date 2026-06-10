// src/audit/audit.controller.ts

import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { AuditService } from './audit.service';
import { AuditQueryDto } from './dto/audit.dto';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('Audit')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles('OWNER')
@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  /**
   * GET /api/v1/audit
   * Roles: OWNER
   */
  @Get()
  @ApiOperation({
    summary: 'Get basic audit log',
    description:
      'Queries daily rate changes, sales, returns, and exchanges, ' +
      'merges them, sorts by timestamp descending, and returns a paginated list of audit events. ' +
      'Access is restricted to the OWNER role.',
  })
  @ApiResponse({
    status: 200,
    description: 'Audit log retrieved successfully',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - User does not have OWNER role',
  })
  getAuditLog(@Query() query: AuditQueryDto) {
    return this.auditService.getAuditLog(query);
  }
}
