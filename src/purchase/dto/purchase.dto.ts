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
import { PartialType, ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WeightInputDto } from '../../trade/dto/trade.dto';
import { IsDateString } from 'class-validator';

// ─── SUPPLIER ─────────────────────────────────────────────────────────────────

export class CreateSupplierDto {
  /** Supplier name. Example: "Sharma Traders" */
  @ApiProperty({ description: 'Supplier name', example: 'Sharma Traders', minLength: 2, maxLength: 120 })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

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

  /**
   * TRADE = gives raw metal, receives finished items back (old TradeParty)
   * DIRECT = sells finished items directly to shop
   */
  @ApiProperty({ description: 'Supplier type', enum: ['TRADE', 'DIRECT'], example: 'DIRECT' })
  @IsString()
  @IsIn(['TRADE', 'DIRECT'])
  supplierType!: 'TRADE' | 'DIRECT';
}

export class UpdateSupplierDto extends PartialType(CreateSupplierDto) {
  @ApiPropertyOptional({ description: 'Active status', example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class SupplierQueryDto {
  @ApiPropertyOptional({ description: 'Search query' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Filter by supplier type', enum: ['TRADE', 'DIRECT'] })
  @IsOptional()
  @IsString()
  @IsIn(['TRADE', 'DIRECT'])
  supplierType?: string;

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

// ─── PURCHASE ORDER LINE ──────────────────────────────────────────────────────

export class CreatePurchaseOrderLineDto {
  /** Description of the item. Example: "Gold Ring 22K" */
  @ApiProperty({ description: 'Description of the item', example: 'Gold Ring 22K', minLength: 2, maxLength: 200 })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  description!: string;

  @ApiPropertyOptional({ description: 'Item category ID', example: 'category-id' })
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiPropertyOptional({ description: 'Metal type ID', example: 'gold-22k-id' })
  @IsOptional()
  @IsString()
  metalTypeId?: string;

  @ApiPropertyOptional({ description: 'Karat grade', enum: [24, 22, 18, 14], example: 22 })
  @IsOptional()
  @IsInt()
  @IsIn([24, 22, 18, 14])
  karat?: number;

  /** Weight — any unit */
  @ApiProperty({ description: 'Gross weight of the line item', type: WeightInputDto })
  @ValidateNested()
  @Type(() => WeightInputDto)
  grossWeight!: WeightInputDto;

  /** Jerty — optional, flexible unit */
  @ApiPropertyOptional({ description: 'Jerty weight suggestion', type: WeightInputDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => WeightInputDto)
  jertyWeight?: WeightInputDto;

  /** Price for this line item in NPR */
  @ApiProperty({ description: 'Price in NPR', example: 95000 })
  @IsNumber()
  @IsPositive()
  priceNpr!: number;

   // ── Rate at purchase — optional, for audit purposes ───────────────────────
  @ApiPropertyOptional({
    description: 'Gold/silver rate per gram on purchase date. Used for audit history.',
    example: 9431.17,
  })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  rateAtPurchasePerGram?: number;
}

export class UpdatePurchaseOrderLineDto {
  /** Update weight on receipt — supplier may bring different weight */
  @ApiPropertyOptional({ description: 'Gross weight override on receipt', type: WeightInputDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => WeightInputDto)
  grossWeight?: WeightInputDto;

  @ApiPropertyOptional({ description: 'Jerty weight override on receipt', type: WeightInputDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => WeightInputDto)
  jertyWeight?: WeightInputDto;

  @ApiPropertyOptional({ description: 'Price override in NPR', example: 96000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  priceNpr?: number;

  @ApiPropertyOptional({ description: 'Category ID override', example: 'category-id' })
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiPropertyOptional({ description: 'Metal type ID override', example: 'gold-22k-id' })
  @IsOptional()
  @IsString()
  metalTypeId?: string;
}

// ─── PURCHASE ORDER ───────────────────────────────────────────────────────────

export class CreatePurchaseOrderDto {
  /** Supplier ID — must be a DIRECT type supplier */
  @ApiProperty({ description: 'Supplier ID', example: 'direct-supplier-id' })
  @IsString()
  supplierId!: string;

  // ── Purchase date — optional, defaults to today ───────────────────────────
  @ApiPropertyOptional({
    description: 'Purchase date. Defaults to today if not provided. Use ISO format: 2026-06-05',
    example: '2026-06-05',
  })
  @IsOptional()
  @IsDateString()
  purchaseDate?: string;

  /** Order lines — each line becomes one stock item when received */
  @ApiProperty({ description: 'Purchase order line items', type: [CreatePurchaseOrderLineDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePurchaseOrderLineDto)
  lines!: CreatePurchaseOrderLineDto[];

  @ApiPropertyOptional({ description: 'Order notes', example: 'Fast delivery requested' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class ReceiveLineDto {
  @ApiProperty({ description: 'Purchase order line ID to apply update', example: 'line-id' })
  @IsString()
  lineId!: string;

  @ApiPropertyOptional({ description: 'Gross weight at receipt', type: WeightInputDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => WeightInputDto)
  grossWeight?: WeightInputDto;

  @ApiPropertyOptional({ description: 'Jerty weight at receipt', type: WeightInputDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => WeightInputDto)
  jertyWeight?: WeightInputDto;

  @ApiPropertyOptional({ description: 'Price at receipt', example: 95500 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  priceNpr?: number;

  // ── Rate override at receipt ──────────────────────────────────────────────
  @ApiPropertyOptional({
    description: 'Rate per gram at time of receipt — overrides order-level rate',
    example: 9431.17,
  })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  rateAtPurchasePerGram?: number;
}


export class ReceivePurchaseOrderDto {
  /**
   * Updated line details on receipt.
   * Supplier may bring different weight/price — these override the order values.
   * Lines not included here are received as-is from the order.
   */
  @ApiPropertyOptional({ description: 'Custom modifications to specific lines on receipt', type: [ReceiveLineDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceiveLineDto)
  lineUpdates?: ReceiveLineDto[];

  @ApiPropertyOptional({ description: 'Receipt notes', example: 'Received in good condition' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class PurchaseOrderQueryDto {
  @ApiPropertyOptional({ description: 'Filter by supplier ID', example: 'supplier-id' })
  @IsOptional()
  @IsString()
  supplierId?: string;

  @ApiPropertyOptional({ description: 'Filter by order status', enum: ['PENDING', 'RECEIVED', 'CANCELLED'], example: 'PENDING' })
  @IsOptional()
  @IsString()
  @IsIn(['PENDING', 'RECEIVED', 'CANCELLED'])
  status?: string;

  @ApiPropertyOptional({ description: 'From date (ISO format)', example: '2026-06-01' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ description: 'To date (ISO format)', example: '2026-06-06' })
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
