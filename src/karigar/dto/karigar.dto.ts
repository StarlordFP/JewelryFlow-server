import {
  IsString,
  IsOptional,
  IsBoolean,
  IsNumber,
  IsArray,
  IsIn,
  IsPositive,
  IsInt,
  ValidateNested,
  ValidateIf,
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

export class CreateProductionOrderLineDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  description!: string;

  @IsString()
  categoryId!: string;

  @IsString()
  metalTypeId!: string;

  /** Karat for display — mirrors CreateStockItemDto (optional, 24/22/18/14 only) */
  @IsOptional()
  @IsInt()
  @IsIn([24, 22, 18, 14])
  karat?: number;

  @IsNumber()
  @Min(0)
  expectedWeightGram!: number;

  @IsNumber()
  @Min(0)
  plannedIssuedWeightGram!: number;
}

export class CreateProductionOrderDto {
  @IsString()
  karigarId!: string;

  /** Per-order wastage allowance (percentage) — legacy simple orders only */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  tolerancePct?: number;

  /** Absolute wastage allowance in grams — when set, used instead of tolerancePct */
  @IsOptional()
  @IsNumber()
  @Min(0)
  toleranceGram?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  /** Optional per-item lines — when absent, behaviour is identical to today */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateProductionOrderLineDto)
  lines?: CreateProductionOrderLineDto[];
}

// ─── PRODUCTION ISSUE ─────────────────────────────────────────────────────────

export class CreateProductionIssueDto {
  @IsString()
  productionOrderId!: string;

  @IsString()
  metalTypeId!: string;

  /**
   * Weight of raw metal to issue — any unit.
   * Optional when sourceStockItemIds is provided (the combined source-item
   * weight already provides material; raw metal is the additive extra).
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => WeightInputDto)
  issuedWeight?: WeightInputDto;

  /**
   * Rate per gram at time of issue — for valuation.
   * Defaults to today's current rate if not provided.
   */
  @IsOptional()
  @IsNumber()
  @IsPositive()
  rateAtIssuePerGram?: number;

  /**
   * Existing IN_STOCK items to consume as remake inputs.
   * Optional — if absent, behavior is identical to the plain raw-metal flow.
   * Each listed item must have status IN_STOCK; the whole request is rejected
   * if any item fails this check.
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  sourceStockItemIds?: string[];

  /**
   * Grams of pending metal balance to apply — reduces effective issued weight.
   * Optional; when absent or 0, behaviour is identical to today.
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  applyBalanceGram?: number;

  /** When set, links this issue to a production order line (optional line-based flow) */
  @IsOptional()
  @IsString()
  productionOrderLineId?: string;
}

// ─── PRODUCTION ORDER LINE — ISSUE BATCH ─────────────────────────────────────

export class IssueProductionOrderLineBatchItemDto {
  @IsString()
  productionOrderLineId!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => WeightInputDto)
  issuedWeight?: WeightInputDto;
}

export class IssueProductionOrderLinesBatchDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IssueProductionOrderLineBatchItemDto)
  lines!: IssueProductionOrderLineBatchItemDto[];
}

// ─── PRODUCTION ORDER LINE — WEIGH-IN ────────────────────────────────────────

export class WeighInProductionOrderLineDto {
  @ValidateNested()
  @Type(() => WeightInputDto)
  actualWeight!: WeightInputDto;
}

export class WeighInProductionOrderLineBatchItemDto {
  @IsString()
  productionOrderLineId!: string;

  @ValidateNested()
  @Type(() => WeightInputDto)
  actualWeight!: WeightInputDto;
}

export class WeighInProductionOrderLinesBatchDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WeighInProductionOrderLineBatchItemDto)
  lines!: WeighInProductionOrderLineBatchItemDto[];
}

// ─── PRODUCTION ORDER LINE — APPROVE ─────────────────────────────────────────

export class ApproveProductionOrderLineBatchItemDto {
  @IsString()
  productionOrderLineId!: string;
}

export class ApproveProductionOrderLinesBatchDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ApproveProductionOrderLineBatchItemDto)
  lines!: ApproveProductionOrderLineBatchItemDto[];
}

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
  /**
   * How to resolve the dispute. Defaults to CASH_DEDUCTION for backward compatibility.
   */
  @IsOptional()
  @IsIn(['CASH_DEDUCTION', 'METAL_CARRYFORWARD'])
  resolutionType?: 'CASH_DEDUCTION' | 'METAL_CARRYFORWARD';

  /** Required when resolutionType is CASH_DEDUCTION (or omitted). */
  @ValidateIf((o) => !o.resolutionType || o.resolutionType === 'CASH_DEDUCTION')
  @IsNumber()
  @Min(0)
  deductionNpr?: number;

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
