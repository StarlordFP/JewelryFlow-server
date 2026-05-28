import {
  IsString,
  IsOptional,
  IsArray,
  IsNumber,
  IsInt,
  IsIn,
  IsBoolean,
  IsPositive,
  ValidateNested,
  MinLength,
  MaxLength,
  Matches,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PartialType } from '@nestjs/mapped-types';
import { WeightInputDto } from '../../trade/dto/trade.dto';

// ─── SUPPLIER ─────────────────────────────────────────────────────────────────

export class CreateSupplierDto {
  /** Supplier name. Example: "Sharma Traders" */
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

  /**
   * TRADE = gives raw metal, receives finished items back (old TradeParty)
   * DIRECT = sells finished items directly to shop
   */
  @IsString()
  @IsIn(['TRADE', 'DIRECT'])
  supplierType!: 'TRADE' | 'DIRECT';
}

export class UpdateSupplierDto extends PartialType(CreateSupplierDto) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class SupplierQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  @IsIn(['TRADE', 'DIRECT'])
  supplierType?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  page?: number;

  @IsOptional()
  limit?: number;
}

// ─── PURCHASE ORDER LINE ──────────────────────────────────────────────────────

export class CreatePurchaseOrderLineDto {
  /** Description of the item. Example: "Gold Ring 22K" */
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  description!: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  metalTypeId?: string;

  @IsOptional()
  @IsInt()
  @IsIn([24, 22, 18, 14])
  karat?: number;

  /** Weight — any unit */
  @ValidateNested()
  @Type(() => WeightInputDto)
  grossWeight!: WeightInputDto;

  /** Jerty — optional, flexible unit */
  @IsOptional()
  @ValidateNested()
  @Type(() => WeightInputDto)
  jertyWeight?: WeightInputDto;

  /** Price for this line item in NPR */
  @IsNumber()
  @IsPositive()
  priceNpr!: number;
}

export class UpdatePurchaseOrderLineDto {
  /** Update weight on receipt — supplier may bring different weight */
  @IsOptional()
  @ValidateNested()
  @Type(() => WeightInputDto)
  grossWeight?: WeightInputDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => WeightInputDto)
  jertyWeight?: WeightInputDto;

  @IsOptional()
  @IsNumber()
  @Min(0)
  priceNpr?: number;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  metalTypeId?: string;
}

// ─── PURCHASE ORDER ───────────────────────────────────────────────────────────

export class CreatePurchaseOrderDto {
  /** Supplier ID — must be a DIRECT type supplier */
  @IsString()
  supplierId!: string;

  /** Order lines — each line becomes one stock item when received */
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePurchaseOrderLineDto)
  lines!: CreatePurchaseOrderLineDto[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class ReceivePurchaseOrderDto {
  /**
   * Updated line details on receipt.
   * Supplier may bring different weight/price — these override the order values.
   * Lines not included here are received as-is from the order.
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceiveLineDto)
  lineUpdates?: ReceiveLineDto[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class ReceiveLineDto {
  @IsString()
  lineId!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => WeightInputDto)
  grossWeight?: WeightInputDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => WeightInputDto)
  jertyWeight?: WeightInputDto;

  @IsOptional()
  @IsNumber()
  @Min(0)
  priceNpr?: number;
}

export class PurchaseOrderQueryDto {
  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsOptional()
  @IsString()
  @IsIn(['PENDING', 'RECEIVED', 'CANCELLED'])
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
