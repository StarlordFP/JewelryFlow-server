import {
  IsString,
  IsNumber,
  IsPositive,
  IsOptional,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SetDailyRateDto {
  /** Metal type ID to set rate for */
  @ApiPropertyOptional({ description: 'Metal type ID to set rate for (defaults to active Silver)', example: 'silver-id' })
  @IsOptional()
  @IsString()
  metalTypeId?: string;

  /**
   * Sell rate per gram in NPR — shop sells jewelry at this rate.
   * Example: 6500.00
   */
  @ApiPropertyOptional({ description: 'Sell rate per gram in NPR', example: 124.31 })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  sellRatePerGram?: number;

  /**
   * Buy rate per gram in NPR — shop buys back gold at this rate.
   * Must be lower than sellRatePerGram.
   * Example: 6200.00
   */
  @ApiPropertyOptional({ description: 'Buy rate per gram in NPR', example: 120.03 })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  buyRatePerGram?: number;

  /**
   * Sell rate per tola in NPR.
   * Example: 120000.00
   */
  @ApiPropertyOptional({ description: 'Sell rate per tola in NPR', example: 1450 })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  sellRatePerTola?: number;

  /**
   * Buy rate per tola in NPR.
   * Example: 118000.00
   */
  @ApiPropertyOptional({ description: 'Buy rate per tola in NPR', example: 1400 })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  buyRatePerTola?: number;
}

export class SetGoldRatesDto {
  @ApiPropertyOptional({ description: '24K gold sell rate per tola in NPR', example: 120000 })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  gold24kSellPerTola?: number;

  @ApiPropertyOptional({ description: '24K gold buy rate per tola in NPR', example: 118000 })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  gold24kBuyPerTola?: number;

  @ApiPropertyOptional({ description: '24K gold sell rate per gram in NPR', example: 10288.07 })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  gold24kSellPerGram?: number;

  @ApiPropertyOptional({ description: '24K gold buy rate per gram in NPR', example: 10117.30 })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  gold24kBuyPerGram?: number;
}


export class RateHistoryQueryDto {
  /** Filter by metal type ID */
  @ApiPropertyOptional({ description: 'Filter by metal type ID', example: 'gold-24k-id' })
  @IsOptional()
  @IsString()
  metalTypeId?: string;

  /** From date — ISO string */
  @ApiPropertyOptional({ description: 'From date — ISO string', example: '2026-06-01T00:00:00.000Z' })
  @IsOptional()
  @IsString()
  from?: string;

  /** To date — ISO string */
  @ApiPropertyOptional({ description: 'To date — ISO string', example: '2026-06-06T23:59:59.999Z' })
  @IsOptional()
  @IsString()
  to?: string;

  @ApiPropertyOptional({ description: 'Page number', example: 1, default: 1 })
  @IsOptional()
  page?: number;

  @ApiPropertyOptional({ description: 'Items per page limit', example: 30, default: 30 })
  @IsOptional()
  limit?: number;
}

