import {
  IsString,
  IsOptional,
  IsBoolean,
  IsNumber,
  IsArray,
  IsIn,
  IsPositive,
  ValidateNested,
  MinLength,
  MaxLength,
  Matches,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PartialType } from '@nestjs/mapped-types';
import { WeightInputDto } from '../../trade/dto/trade.dto';

// ─── KARIGAR ─────────────────────────────────────────────────────────────────

export class CreateKarigarDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @Matches(/^[0-9+\-\s()]{7,20}$/, { message: 'Invalid phone format' })
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;

  /** Acceptable wastage percentage. Example: 2.5 means 2.5% */
  @IsNumber()
  @Min(0)
  @Max(100)
  tolerancePct!: number;
}

export class UpdateKarigarDto extends PartialType(CreateKarigarDto) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class KarigarQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  page?: number;

  @IsOptional()
  limit?: number;
}

// ─── PRODUCTION ORDER ─────────────────────────────────────────────────────────

export class CreateProductionOrderDto {
  @IsString()
  karigarId!: string;

  /** Override karigar's default tolerance for this order */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  tolerancePct?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

// ─── PRODUCTION ISSUE ─────────────────────────────────────────────────────────

export class CreateProductionIssueDto {
  @IsString()
  productionOrderId!: string;

  @IsString()
  metalTypeId!: string;

  /** Weight of raw metal to issue — any unit */
  @ValidateNested()
  @Type(() => WeightInputDto)
  issuedWeight!: WeightInputDto;

  /**
   * Rate per gram at time of issue — for valuation.
   * Defaults to today's current rate if not provided.
   */
  @IsOptional()
  @IsNumber()
  @IsPositive()
  rateAtIssuePerGram?: number;
}

// ─── PRODUCTION RETURN ────────────────────────────────────────────────────────

export class CreateProductionReturnItemDto {
  /** Description of this finished piece */
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  description!: string;

  /** Weight of this finished piece — any unit */
  @ValidateNested()
  @Type(() => WeightInputDto)
  grossWeight!: WeightInputDto;
}

export class CreateProductionReturnDto {
  @IsString()
  productionOrderId!: string;

  @IsString()
  productionIssueId!: string;

  /** Total weight returned by karigar — any unit */
  @ValidateNested()
  @Type(() => WeightInputDto)
  returnedWeight!: WeightInputDto;

  /** Individual finished pieces */
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateProductionReturnItemDto)
  items!: CreateProductionReturnItemDto[];
}

// ─── KARIGAR PAYMENT ──────────────────────────────────────────────────────────
// Can be cash + metal, cash only, or metal only

export class CreateKarigarPaymentDto {
  @IsString()
  karigarId!: string;

  @IsString()
  productionOrderId!: string;

  /** Cash component in NPR — optional if paying in metal */
  @IsOptional()
  @IsNumber()
  @Min(0)
  cashAmountNpr?: number;

  /** Metal component — optional if paying in cash */
  @IsOptional()
  @ValidateNested()
  @Type(() => WeightInputDto)
  metalWeight?: WeightInputDto;

  @IsOptional()
  @IsString()
  metalTypeId?: string;

  /**
   * Dispute deduction to apply in this payment.
   * Owner decides the amount manually.
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  deductionNpr?: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  deductionNotes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

// ─── KARIGAR DISPUTE ──────────────────────────────────────────────────────────

export class ResolveDisputeDto {
  /** Amount to deduct from next payment — owner decides */
  @IsNumber()
  @Min(0)
  deductionNpr!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  resolutionNotes?: string;
}

// ─── QUERY ────────────────────────────────────────────────────────────────────

export class ProductionOrderQueryDto {
  @IsOptional()
  @IsString()
  karigarId?: string;

  @IsOptional()
  @IsString()
  @IsIn(['OPEN', 'COMPLETED', 'CANCELLED'])
  status?: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  page?: number;

  @IsOptional()
  limit?: number;
}
