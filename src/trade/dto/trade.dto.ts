import {
  IsString,
  IsOptional,
  IsBoolean,
  IsNumber,
  IsArray,
  ValidateNested,
  MinLength,
  MaxLength,
  Matches,
  IsPositive,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PartialType } from '@nestjs/swagger';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WeightInput } from '../../common/pipes/parse-positive-int.pipe';
import { WeightValue } from '../../common/utils/weight.util';

// ─── WEIGHT INPUT ─────────────────────────────────────────────────────────────

export class WeightInputDto implements WeightInput {
  @ApiProperty({ description: 'Weight value', example: 11.664 })
  @IsNumber()
  @IsPositive()
  value: number;

  @ApiProperty({ description: 'Weight unit', enum: ['gram', 'tola', 'lal'], example: 'gram' })
  @IsString()
  @IsIn(['gram', 'tola', 'lal'])
  unit: 'gram' | 'tola' | 'lal';
}

// ─── TRADE PARTY ─────────────────────────────────────────────────────────────

export class CreateTradePartyDto {
  @ApiProperty({ description: 'Trade party name', example: 'Sharma Jewelers', minLength: 2, maxLength: 120 })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string;

  @ApiPropertyOptional({ description: 'Phone number', example: '+977-9841234567' })
  @IsOptional()
  @IsString()
  @Matches(/^[0-9+\-\s()]{7,20}$/, { message: 'Invalid phone format' })
  phone?: string;

  @ApiPropertyOptional({ description: 'Physical address', example: 'Kathmandu, Nepal' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;
}

export class UpdateTradePartyDto extends PartialType(CreateTradePartyDto) {
  @ApiPropertyOptional({ description: 'Active status', example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// ─── TRADE ITEM ───────────────────────────────────────────────────────────────

export class CreateTradeItemDto {
  @ApiProperty({ description: 'Item description', example: 'Gold bracelet with diamond', minLength: 2, maxLength: 200 })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  description: string;

  @ApiProperty({ description: 'Gross weight of the finished item', type: WeightInputDto })
  @ValidateNested()
  @Type(() => WeightInputDto)
  grossWeight: WeightInputDto;

  @ApiPropertyOptional({ description: 'Item category ID', example: 'clp123xyz' })
  @IsOptional()
  @IsString()
  categoryId?: string;
}

// ─── TRADE ───────────────────────────────────────────────────────────────────

export class CreateTradeDto {
  @ApiProperty({ description: 'Trade party ID (supplier)', example: 'clp123xyz' })
  @IsString()
  tradePartyId: string;

  @ApiProperty({ description: 'Weight of raw metal given to trade party', type: WeightInputDto })
  @ValidateNested()
  @Type(() => WeightInputDto)
  givenWeight: WeightInputDto;

  @ApiProperty({ description: 'Metal type ID (e.g., Gold 22K, Silver)', example: 'clp456abc' })
  @IsString()
  givenMetalTypeId: string;

  @ApiProperty({ description: 'Rate per gram at time of trade (NPR)', example: '3500.50' })
  @IsString()
  rateAtTradePerGram: string;

  @ApiPropertyOptional({ description: 'Cash adjustment (positive = shop pays extra)', example: '500' })
  @IsOptional()
  @IsString()
  cashAdjustment?: string;

  @ApiPropertyOptional({ description: 'Additional notes', example: 'High purity gold' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ApiProperty({ description: 'Array of finished items received', type: [CreateTradeItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateTradeItemDto)
  tradeItems: CreateTradeItemDto[];
}

export class UpdateTradeStatusDto {
  @ApiProperty({ description: 'New status', enum: ['COMPLETED', 'CANCELLED'], example: 'COMPLETED' })
  @IsString()
  @IsIn(['COMPLETED', 'CANCELLED'])
  status: 'COMPLETED' | 'CANCELLED';

  @ApiPropertyOptional({ description: 'Status update notes', example: 'Trade completed successfully' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

// ─── QUERY / FILTER ──────────────────────────────────────────────────────────

export class TradePartyQueryDto {
  @ApiPropertyOptional({ description: 'Search by name or phone' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Filter by active status' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Page number', example: 1, default: 1 })
  @IsOptional()
  page?: number;

  @ApiPropertyOptional({ description: 'Items per page', example: 20, default: 20 })
  @IsOptional()
  limit?: number;
}

export class TradeQueryDto {
  @ApiPropertyOptional({ description: 'Filter by trade party ID' })
  @IsOptional()
  @IsString()
  tradePartyId?: string;

  @ApiPropertyOptional({ description: 'Filter by trade status', enum: ['PENDING', 'COMPLETED', 'CANCELLED'] })
  @IsOptional()
  @IsString()
  @IsIn(['PENDING', 'COMPLETED', 'CANCELLED'])
  status?: 'PENDING' | 'COMPLETED' | 'CANCELLED';

  @ApiPropertyOptional({ description: 'From date (ISO format)', example: '2026-04-01' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ description: 'To date (ISO format)', example: '2026-04-30' })
  @IsOptional()
  @IsString()
  to?: string;

  @ApiPropertyOptional({ description: 'Page number', example: 1, default: 1 })
  @IsOptional()
  page?: number;

  @ApiPropertyOptional({ description: 'Items per page', example: 20, default: 20 })
  @IsOptional()
  limit?: number;
}