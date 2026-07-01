import {
  IsString,
  IsOptional,
  IsArray,
  IsBoolean,
  IsNumber,
  IsIn,
  IsPositive,
  ValidateNested,
  MaxLength,
  Min,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { WeightInputDto } from '../../trade/dto/trade.dto';
import { JyalaBreakdownDto } from '../../stock/dto/stock.dto';

// ─── PAYMENT ──────────────────────────────────────────────────────────────────

export class PaymentDto {
  /** Payment amount in NPR */
  @IsNumber()
  @IsPositive()
  amountNpr!: number;

  /** Payment method */
  @IsString()
  @IsIn(['CASH', 'ONLINE', 'CHEQUE'])
  method!: 'CASH' | 'ONLINE' | 'CHEQUE';

  /** Reference number for cheque/online. Example: eSewa txn ID or cheque number */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  notes?: string;
}

// ─── SELL LINE ────────────────────────────────────────────────────────────────
// One item in a SELL transaction

export class SellLineDto {
  /** ID of the stock item being sold */
  @IsString()
  stockItemId!: string;

  /**
   * Override jerty at bill time (optional).
   * If not provided, uses the stored value on the stock item.
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => WeightInputDto)
  jertyOverride?: WeightInputDto;

  /**
   * Override total jyala at bill time (optional — customer may bargain).
   * If not provided, uses totalJyalaNpr stored on the stock item.
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  jyalaOverride?: number;

  /**
   * Override jyala breakdown at bill time (optional).
   * If not provided, uses the stored breakdown on the stock item.
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => JyalaBreakdownDto)
  jyalaBreakdown?: JyalaBreakdownDto;

  /**
   * Override applyLuxuryTax at bill time (optional).
   * If not provided, uses the stored value on the stock item.
   */
  @IsOptional()
  @IsBoolean()
  applyLuxuryTax?: boolean;

  /**
   * Override applyVat at bill time (optional).
   * If not provided, uses the stored value on the stock item.
   */
  @IsOptional()
  @IsBoolean()
  applyVat?: boolean;
}

// ─── CREATE SELL ──────────────────────────────────────────────────────────────

export class CreateSellDto {
  /** Customer ID (optional — walk-in customers may not be registered) */
  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  newCustomerName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  newCustomerPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  newCustomerAddress?: string;

  /** One or more items being sold in this bill */
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SellLineDto)
  items!: SellLineDto[];

  /** Initial payment — can be partial */
  @ValidateNested()
  @Type(() => PaymentDto)
  payment!: PaymentDto;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

// ─── CREATE RETURN ────────────────────────────────────────────────────────────

export class ReturnItemDto {
  /** Stock item ID being returned */
  @IsString()
  stockItemId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

export class CreateReturnDto {
  /** Original SELL transaction ID */
  @IsString()
  originalTxId!: string;

  /** Items being returned (partial return allowed) */
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReturnItemDto)
  items!: ReturnItemDto[];

  /** Refund payment method */
  @ValidateNested()
  @Type(() => PaymentDto)
  refund!: PaymentDto;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

// ─── CREATE EXCHANGE ──────────────────────────────────────────────────────────

export class ExchangeInItemDto {
  /**
   * For shop item: provide stockItemId
   * For old gold: provide weight — valued at today's buy rate
   */
  @IsOptional()
  @IsString()
  stockItemId?: string;

  // Old gold fields — used when stockItemId is not provided
  @IsOptional()
  @ValidateNested()
  @Type(() => WeightInputDto)
  oldGoldWeight?: WeightInputDto;

  @IsOptional()
  @IsString()
  oldGoldMetalTypeId?: string;
}

export class CreateExchangeDto {
  /** Customer ID */
  @IsOptional()
  @IsString()
  customerId?: string;

  /** Item(s) customer is returning/bringing in */
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExchangeInItemDto)
  itemsIn!: ExchangeInItemDto[];

  /** Item(s) customer is taking — from shop stock */
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SellLineDto)
  itemsOut!: SellLineDto[];

  /**
   * Cash difference settlement.
   * Positive = customer pays shop (itemsOut > itemsIn value)
   * Negative = shop pays customer (itemsIn > itemsOut value)
   */
  @ValidateNested()
  @Type(() => PaymentDto)
  payment!: PaymentDto;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

// ─── CREATE BUY_BACK ──────────────────────────────────────────────────────────

export class CreateBuybackDto {
  /** Customer selling back the item */
  @IsString()
  customerId!: string;

  /** Original sale transaction ID (required for BUY_BACK, null for OLD_GOLD) */
  @IsOptional()
  @IsString()
  relatedSaleTxId?: string;

  /** Weight of the item being bought back */
  @ValidateNested()
  @Type(() => WeightInputDto)
  weight!: WeightInputDto;

  /** Metal type ID */
  @IsString()
  metalTypeId!: string;

  /**
   * Buy rate per gram — owner inputs this manually.
   * This is the price the shop pays, which may differ from today's standard buy rate.
   */
  @IsNumber()
  @IsPositive()
  buyRatePerGram!: number;

  /** Payment to customer */
  @ValidateNested()
  @Type(() => PaymentDto)
  payment!: PaymentDto;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

// ─── CREATE OLD_GOLD ─────────────────────────────────────────────────────────

export class CreateOldGoldDto {
  /** Customer bringing old gold (optional) */
  @IsOptional()
  @IsString()
  customerId?: string;

  /** Weight of old gold */
  @ValidateNested()
  @Type(() => WeightInputDto)
  weight!: WeightInputDto;

  /** Metal type ID */
  @IsString()
  metalTypeId!: string;

  /**
   * Buy rate per gram — owner inputs manually.
   * Defaults to today's buy rate but can be overridden.
   */
  @IsNumber()
  @IsPositive()
  buyRatePerGram!: number;

  /** Payment to customer */
  @ValidateNested()
  @Type(() => PaymentDto)
  payment!: PaymentDto;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

// ─── ADD PAYMENT ──────────────────────────────────────────────────────────────
// Record an additional payment against an existing transaction (partial payment)

export class AddPaymentDto {
  @ValidateNested()
  @Type(() => PaymentDto)
  payment!: PaymentDto;
}

// ─── QUERY ────────────────────────────────────────────────────────────────────

export class SalesQueryDto {
  @IsOptional()
  @IsString()
  @IsIn(['SELL', 'RETURN', 'EXCHANGE', 'BUY_BACK', 'OLD_GOLD'])
  txType?: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  /** Filter by balance — true = only unpaid/partial */
  @IsOptional()
  @IsBoolean()
  hasBalance?: boolean;

  @IsOptional()
  @IsString()
  search?: string; // bill number or customer name

  @IsOptional()
  page?: number;

  @IsOptional()
  limit?: number;
}
