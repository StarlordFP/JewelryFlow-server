import {
  IsString,
  IsOptional,
  IsBoolean,
  IsInt,
  IsArray,
  IsIn,
  IsPositive,
  IsNumber,
  ValidateNested,
  MinLength,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PartialType } from '@nestjs/swagger';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WeightInputDto } from '../../trade/dto/trade.dto';

// ─── ADDON ───────────────────────────────────────────────────────────────────

export class CreateStockAddonDto {
  /** ID of the addon type. Example: "diamond-type-id" */
  @ApiProperty({ description: 'Addon type ID', example: 'diamond-type-id' })
  @IsString()
  addonTypeId!: string;

  /** Number of pieces. Example: 3 (for 3 diamonds) */
  @ApiProperty({ description: 'Number of pieces', example: 3 })
  @IsInt()
  @IsPositive()
  quantity!: number;

  /** Manual NPR valuation for all pieces combined. Example: 5000 */
  @ApiProperty({ description: 'Manual NPR valuation for all pieces combined', example: 5000 })
  @IsNumber()
  @Min(0)
  valuationNpr!: number;

  /** Optional notes about this addon */
  @ApiPropertyOptional({ description: 'Notes about this addon', example: 'VS1 clarity', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  notes?: string;
}

// ─── JYALA BREAKDOWN ─────────────────────────────────────────────────────────
// Owner-only — never shown to customer on bill
// Customer sees only the sum as a single "Jyala" line

export class JyalaBreakdownDto {
  /** Making charge in NPR. Example: 800 */
  @ApiPropertyOptional({ description: 'Making charge in NPR', example: 800 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  makingChargeNpr?: number;

  /** Stone charge in NPR (non-diamond stones). Example: 300 */
  @ApiPropertyOptional({ description: 'Stone charge in NPR (non-diamond stones)', example: 300 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  stoneChargeNpr?: number;

  /** Moti (pearl) charge in NPR. Example: 200 */
  @ApiPropertyOptional({ description: 'Moti (pearl) charge in NPR', example: 200 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  motiChargeNpr?: number;

  /** Mala charge in NPR. Example: 150 */
  @ApiPropertyOptional({ description: 'Mala charge in NPR', example: 150 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  malaChargeNpr?: number;

  /** Any other charge in NPR. Example: 100 */
  @ApiPropertyOptional({ description: 'Any other charge in NPR', example: 100 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  otherChargeNpr?: number;
}

// ─── CREATE STOCK ITEM ───────────────────────────────────────────────────────

export class StockItemOriginDto {
  /** Origin type for this stock item */
  @ApiProperty({ description: 'Origin type for this stock item', enum: ['PURCHASED', 'KARIGAR', 'TRADE'], example: 'PURCHASED' })
  @IsString()
  @IsIn(['PURCHASED', 'KARIGAR', 'TRADE'])
  type!: 'PURCHASED' | 'KARIGAR' | 'TRADE';

  /** Trade item ID when origin=TRADE */
  @ApiPropertyOptional({ description: 'Trade item ID when origin=TRADE', example: 'clp789def' })
  @IsOptional()
  @IsString()
  tradeItemId?: string;

  /** Production item ID when origin=KARIGAR */
  @ApiPropertyOptional({ description: 'Production item ID when origin=KARIGAR', example: 'clp012ghi' })
  @IsOptional()
  @IsString()
  productionItemId?: string;
}

export class CreateStockItemDto {
  /** Origin details: type and related origin IDs */
  @ApiProperty({ description: 'Origin details: type and related origin IDs', type: StockItemOriginDto })
  @ValidateNested()
  @Type(() => StockItemOriginDto)
  origin!: StockItemOriginDto;

  /** Item name or label */
  @ApiPropertyOptional({ description: 'Item name or label. Optional when the item is identified by photo.', example: '22K Gold Ring' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  /** Category ID (ring, bangle, necklace etc.) */
  @ApiProperty({ description: 'Category ID (ring, bangle, necklace etc.)', example: 'clp123xyz' })
  @IsString()
  categoryId!: string;

  /** Metal type ID (Gold 22K, Silver etc.) */
  @ApiPropertyOptional({ description: 'Metal type ID (Gold 22K, Silver etc.)', example: 'clp456abc' })
  @IsOptional()
  @IsString()
  metalTypeId?: string;

  /** Karat for display. Example: 22 */
  @ApiPropertyOptional({ description: 'Karat for display', enum: [24, 22, 18, 14], example: 22 })
  @IsOptional()
  @IsInt()
  @IsIn([24, 22, 18, 14])
  karat?: number;

  /** Actual gross weight of the item. Example: { value: 2, unit: "tola" } */
  @ApiProperty({ description: 'Gross weight of the item', type: WeightInputDto })
  @ValidateNested()
  @Type(() => WeightInputDto)
  grossWeight!: WeightInputDto;

  /**
   * Jerty weight added on top of gross weight for pricing.
   * Suggested from JertyBracket — shopkeeper sets final value.
   * Can be changed again at bill time.
   * Example: { value: 0.5, unit: "gram" }
   */
  @ApiPropertyOptional({ description: 'Jerty weight (added on top of gross weight for pricing)', type: WeightInputDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => WeightInputDto)
  jertyWeight?: WeightInputDto;

  /**
   * Jyala breakdown — OWNER ONLY, never shown to customer.
   * Customer bill shows only the sum as a single "Jyala" line.
   * Can be overridden at bill time (e.g. customer bargains down).
   */
  @ApiPropertyOptional({ description: 'Jyala breakdown (owner-only, not shown to customer)', type: JyalaBreakdownDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => JyalaBreakdownDto)
  jyalaBreakdown?: JyalaBreakdownDto;

  /**
   * Apply 2% luxury tax on metal value.
   * Gold only — optional toggle.
   */
  @ApiPropertyOptional({ description: 'Apply 2% luxury tax on metal value (gold only)', example: false })
  @IsOptional()
  @IsBoolean()
  applyLuxuryTax?: boolean;

  /**
   * Apply 13% VAT on total jyala.
   * Optional toggle.
   */
  @ApiPropertyOptional({ description: 'Apply 13% VAT on total jyala', example: false })
  @IsOptional()
  @IsBoolean()
  applyVat?: boolean;

  /** Diamond, pearl etc. — manual NPR valuation per addon */
  @ApiPropertyOptional({ description: 'Addons (diamond, pearl, etc.)', type: [CreateStockAddonDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateStockAddonDto)
  addons?: CreateStockAddonDto[];

  /** Photo URL (uploaded separately via file endpoint) */
  @ApiPropertyOptional({ description: 'Photo URL', example: 'https://example.com/photo.jpg' })
  @IsOptional()
  @IsString()
  photoUrl?: string;

  /** Internal notes about the item */
  @ApiPropertyOptional({ description: 'Internal notes about the item', example: 'High quality finish', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  // ── Origin back-references (only one should be set) ──────────────────────
  /** Set when origin=TRADE */
  @ApiPropertyOptional({ description: 'Trade item ID (required when origin=TRADE)', example: 'clp789def' })
  @IsOptional()
  @IsString()
  tradeItemId?: string;

  /** Set when origin=KARIGAR */
  @ApiPropertyOptional({ description: 'Production item ID (required when origin=KARIGAR)', example: 'clp012ghi' })
  @IsOptional()
  @IsString()
  productionItemId?: string;
}

// ─── UPDATE STOCK ITEM ───────────────────────────────────────────────────────
// Allows editing jerty and jyala after initial entry

export class UpdateStockItemDto {
  /**
   * Update jerty weight — mutable after stock entry.
   * Example: { value: 0.8, unit: "gram" }
   */
  @ApiPropertyOptional({ description: 'Updated jerty weight', type: WeightInputDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => WeightInputDto)
  jertyWeight?: WeightInputDto;

  /**
   * Update jyala breakdown — mutable after stock entry and at bill time.
   * Updating this recalculates totalJyalaNpr automatically.
   */
  @ApiPropertyOptional({ description: 'Updated item name or label', example: '22K Gold Ring' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ description: 'Updated jyala breakdown (recalculates totalJyalaNpr)', type: JyalaBreakdownDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => JyalaBreakdownDto)
  jyalaBreakdown?: JyalaBreakdownDto;

  /** Toggle luxury tax on/off */
  @ApiPropertyOptional({ description: 'Toggle 2% luxury tax', example: false })
  @IsOptional()
  @IsBoolean()
  applyLuxuryTax?: boolean;

  /** Toggle VAT on/off */
  @ApiPropertyOptional({ description: 'Toggle 13% VAT', example: false })
  @IsOptional()
  @IsBoolean()
  applyVat?: boolean;

  @ApiPropertyOptional({ description: 'Internal notes', example: 'Updated finish notes', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ApiPropertyOptional({ description: 'Photo URL', example: 'https://example.com/photo-updated.jpg' })
  @IsOptional()
  @IsString()
  photoUrl?: string;
}

// ─── UPDATE STATUS ────────────────────────────────────────────────────────────

export class UpdateStockStatusDto {
  /** New status for the stock item */
  @ApiProperty({ description: 'New status', enum: ['IN_STOCK', 'RESERVED', 'SCRAPPED'], example: 'RESERVED' })
  @IsString()
  @IsIn(['IN_STOCK', 'RESERVED', 'SCRAPPED'])
  status!: 'IN_STOCK' | 'RESERVED' | 'SCRAPPED';

  @ApiPropertyOptional({ description: 'Status change notes', example: 'Customer requested reservation', maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  notes?: string;
}

// ─── PRICE PREVIEW ───────────────────────────────────────────────────────────
// Calculate price without creating a sale
// Jerty and jyala can be overridden here (bill-time override)

export class PricePreviewDto {
  /** Stock item to price */
  @ApiProperty({ description: 'Stock item ID to calculate price for', example: 'clp123xyz' })
  @IsString()
  stockItemId!: string;

  /**
   * Override jerty at bill time (optional).
   * If not provided, uses the value stored on the stock item.
   */
  @ApiPropertyOptional({ description: 'Override jerty weight at bill time', type: WeightInputDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => WeightInputDto)
  jertyOverride?: WeightInputDto;

  /**
   * Override total jyala at bill time (optional — e.g. customer bargains down).
   * If provided, this replaces the stored jyala breakdown total.
   */
  @ApiPropertyOptional({ description: 'Override total jyala at bill time (e.g. after bargaining)', example: 1200 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  jyalaOverride?: number;

  /** Use a specific daily rate ID instead of today's current rate */
  @ApiPropertyOptional({ description: 'Specific daily rate ID (defaults to today\'s rate)', example: 'clp456abc' })
  @IsOptional()
  @IsString()
  dailyRateId?: string;
}

// ─── STANDALONE PRICE PREVIEW ────────────────────────────────────────────────
// Preview price before a stock item exists (e.g. while adding stock)

export class StandalonePricePreviewDto {
  /** Metal type ID to look up today's rate */
  @ApiProperty({ description: 'Metal type ID', example: 'clp456abc' })
  @IsString()
  metalTypeId!: string;

  /** Category ID (for context, not used in pricing) */
  @ApiPropertyOptional({ description: 'Category ID', example: 'clp123xyz' })
  @IsOptional()
  @IsString()
  categoryId?: string;

  /** Gross weight of the item */
  @ApiProperty({ description: 'Gross weight', type: WeightInputDto })
  @ValidateNested()
  @Type(() => WeightInputDto)
  grossWeight!: WeightInputDto;

  /** Jerty weight (optional — defaults to 0) */
  @ApiPropertyOptional({ description: 'Jerty weight', type: WeightInputDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => WeightInputDto)
  jertyWeight?: WeightInputDto;

  /** Jyala breakdown (optional — defaults to all zeros) */
  @ApiPropertyOptional({ description: 'Jyala breakdown', type: JyalaBreakdownDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => JyalaBreakdownDto)
  jyalaBreakdown?: JyalaBreakdownDto;

  /** Apply 2% luxury tax on metal value */
  @ApiPropertyOptional({ description: 'Apply luxury tax', example: false })
  @IsOptional()
  @IsBoolean()
  applyLuxuryTax?: boolean;

  /** Apply 13% VAT on total jyala */
  @ApiPropertyOptional({ description: 'Apply VAT', example: false })
  @IsOptional()
  @IsBoolean()
  applyVat?: boolean;

  /** Use a specific daily rate ID instead of today's current rate */
  @ApiPropertyOptional({ description: 'Specific daily rate ID', example: 'clp456abc' })
  @IsOptional()
  @IsString()
  dailyRateId?: string;
}

// ─── QUERY / FILTER ──────────────────────────────────────────────────────────

export class StockQueryDto {
  /** Filter by category ID */
  @ApiPropertyOptional({ description: 'Filter by category ID', example: 'clp123xyz' })
  @IsOptional()
  @IsString()
  categoryId?: string;

  /** Filter by metal type ID */
  @ApiPropertyOptional({ description: 'Filter by metal type ID', example: 'clp456abc' })
  @IsOptional()
  @IsString()
  metalTypeId?: string;

  /** Filter by origin */
  @ApiPropertyOptional({ description: 'Filter by origin', enum: ['PURCHASED', 'KARIGAR', 'TRADE'] })
  @IsOptional()
  @IsString()
  @IsIn(['PURCHASED', 'KARIGAR', 'TRADE'])
  origin?: 'PURCHASED' | 'KARIGAR' | 'TRADE';

  /** Filter by status */
  @ApiPropertyOptional({ description: 'Filter by status', enum: ['IN_STOCK', 'RESERVED', 'SOLD', 'RETURNED', 'SCRAPPED'] })
  @IsOptional()
  @IsString()
  @IsIn(['IN_STOCK', 'RESERVED', 'SOLD', 'RETURNED', 'SCRAPPED'])
  status?: string;

  /** Filter by minimum gross weight in grams */
  @ApiPropertyOptional({ description: 'Minimum gross weight in grams', example: 5.0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  minWeightGram?: number;

  /** Filter by maximum gross weight in grams */
  @ApiPropertyOptional({ description: 'Maximum gross weight in grams', example: 50.0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  maxWeightGram?: number;

  /** Filter by date added — from */
  @ApiPropertyOptional({ description: 'From date (ISO format)', example: '2026-04-01' })
  @IsOptional()
  @IsString()
  from?: string;

  /** Filter by date added — to */
  @ApiPropertyOptional({ description: 'To date (ISO format)', example: '2026-04-30' })
  @IsOptional()
  @IsString()
  to?: string;

  /** Search by SKU or notes */
  @ApiPropertyOptional({ description: 'Search by SKU or notes', example: 'GLD-RNG' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Page number', example: 1, default: 1 })
  @IsOptional()
  page?: number;

  @ApiPropertyOptional({ description: 'Items per page', example: 20, default: 20 })
  @IsOptional()
  limit?: number;
}

// ─── CATEGORY DTOs ────────────────────────────────────────────────────────────

export class CreateCategoryDto {
  @ApiProperty({ description: 'Category name', example: 'Ring' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;
}

export class UpdateCategoryDto {
  @ApiPropertyOptional({ description: 'Category name', example: 'Ring' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ description: 'Active status', example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
