import {
  IsString,
  IsNumber,
  IsPositive,
  IsOptional,
  IsArray,
  ValidateNested,
  IsBoolean,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

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

export class DerivePreviewQueryDto {
  @ApiProperty({ description: 'Fine 24K gold sell rate per gram (from FENEGOSIDA fine gold / 10)', example: 10288.07 })
  @IsNumber()
  @IsPositive()
  fineGoldSellPerGram: number;

  @ApiProperty({ description: 'Pure silver sell rate per gram (from FENEGOSIDA silver / 10)', example: 150.0 })
  @IsNumber()
  @IsPositive()
  pureSilverSellPerGram: number;
}

export class ConfirmRateRowDto {
  @ApiProperty({ description: 'Metal type ID' })
  @IsString()
  metalTypeId: string;

  @ApiPropertyOptional({ description: 'Override sell rate per gram' })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  sellRatePerGram?: number;

  @ApiPropertyOptional({ description: 'Override buy rate per gram' })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  buyRatePerGram?: number;
}

export class ConfirmRatesDto {
  @ApiPropertyOptional({ description: 'FetchedRateSnapshot ID to mark as consumed' })
  @IsOptional()
  @IsString()
  snapshotId?: string;

  @ApiProperty({ description: 'Fine 24K gold sell rate per gram' })
  @IsNumber()
  @IsPositive()
  fineGoldSellPerGram: number;

  @ApiProperty({ description: 'Pure silver sell rate per gram (FENEGOSIDA, before shop purity factor)' })
  @IsNumber()
  @IsPositive()
  pureSilverSellPerGram: number;

  @ApiPropertyOptional({ description: 'When true, derive all gold karats from 24K base (default true)' })
  @IsOptional()
  @IsBoolean()
  deriveFromGold24k?: boolean;

  @ApiPropertyOptional({ type: [ConfirmRateRowDto], description: 'Per-metal sell/buy overrides' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConfirmRateRowDto)
  rows?: ConfirmRateRowDto[];
}

export class PatchRatesSettingsDto {
  @ApiPropertyOptional({ description: 'Global buy discount percentage (0–100)', example: 5 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  buyDiscountPct?: number;

  @ApiPropertyOptional({ description: 'Metal type ID for per-metal override' })
  @IsOptional()
  @IsString()
  metalTypeId?: string;

  @ApiPropertyOptional({ description: 'Per-metal buy discount override (%); null clears override' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  buyDiscountPctOverride?: number | null;
}
