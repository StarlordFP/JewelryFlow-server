// src/audit/dto/audit.dto.ts

import { IsOptional, IsString, IsInt, Min, IsIn, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export type AuditAction = 'RATE_CHANGE' | 'SALE' | 'RETURN' | 'EXCHANGE' | 'ALL';

export class AuditQueryDto {
  @ApiPropertyOptional({
    description: 'Filter by action type',
    enum: ['RATE_CHANGE', 'SALE', 'RETURN', 'EXCHANGE', 'ALL'],
    default: 'ALL',
  })
  @IsOptional()
  @IsIn(['RATE_CHANGE', 'SALE', 'RETURN', 'EXCHANGE', 'ALL'])
  action?: string = 'ALL';

  @ApiPropertyOptional({ description: 'Filter by the user who performed the action' })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({ description: 'Start date (ISO date string)', example: '2026-01-01' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'End date (ISO date string)', example: '2026-12-31' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ description: 'Page number (default: 1)', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Items per page (default: 50)', default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 50;
}

export class TransactionAuditQueryDto {
  @ApiPropertyOptional({ description: 'Filter by bill number' })
  @IsOptional()
  @IsString()
  billNumber?: string;

  @ApiPropertyOptional({ description: 'Filter by actor user id' })
  @IsOptional()
  @IsString()
  actorId?: string;

  @ApiPropertyOptional({ description: 'Start date (ISO date string)', example: '2026-01-01' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'End date (ISO date string)', example: '2026-12-31' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ description: 'Max results (default: 50)', default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 50;
}
