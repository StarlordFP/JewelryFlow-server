import {
  IsString,
  IsNumber,
  IsPositive,
  IsOptional,
} from 'class-validator';

export class SetDailyRateDto {
  /** Metal type ID to set rate for */
  @IsString()
  metalTypeId!: string;

  /**
   * Sell rate per gram in NPR — shop sells jewelry at this rate.
   * Example: 6500.00
   */
  @IsNumber()
  @IsPositive()
  sellRatePerGram!: number;

  /**
   * Buy rate per gram in NPR — shop buys back gold at this rate.
   * Must be lower than sellRatePerGram.
   * Example: 6200.00
   */
  @IsNumber()
  @IsPositive()
  buyRatePerGram!: number;
}

export class RateHistoryQueryDto {
  /** Filter by metal type ID */
  @IsOptional()
  @IsString()
  metalTypeId?: string;

  /** From date — ISO string */
  @IsOptional()
  @IsString()
  from?: string;

  /** To date — ISO string */
  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  page?: number;

  @IsOptional()
  limit?: number;
}
