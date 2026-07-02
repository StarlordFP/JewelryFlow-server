// src/audit/audit.controller.ts

import { Controller, Get, Query, Param, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { AuditService } from './audit.service';
import { AuditQueryDto, TransactionAuditQueryDto } from './dto/audit.dto';
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

  /**
   * GET /api/v1/audit/transactions
   * Roles: OWNER, MANAGER
   */
  @Get('transactions')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Query transaction audit log entries' })
  getTransactionAuditLogs(@Query() query: TransactionAuditQueryDto) {
    return this.auditService.getTransactionAuditLogs(query);
  }

  /**
   * GET /api/v1/audit/transactions/:billNumber
   * Roles: OWNER, MANAGER
   */
  @Get('transactions/:billNumber')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Chronological audit history for one bill' })
  getTransactionAuditByBillNumber(@Param('billNumber') billNumber: string) {
    return this.auditService.getTransactionAuditByBillNumber(billNumber);
  }
}
