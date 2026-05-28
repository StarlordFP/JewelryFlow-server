import {
  IsString,
  IsOptional,
  IsBoolean,
  MinLength,
  MaxLength,
  Matches,
} from 'class-validator';
import { PartialType } from '@nestjs/swagger';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCustomerDto {
  @ApiProperty({ description: 'Customer full name', example: 'Ram Shrestha', minLength: 2, maxLength: 120 })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string;

  /**
   * Raw phone number — stored hashed (SHA-256) + last-4 hint.
   * Never persisted in plaintext.
   */
  @ApiPropertyOptional({ description: 'Raw phone number (stored hashed)', example: '+977-9841234567' })
  @IsOptional()
  @IsString()
  @Matches(/^[0-9+\-\s()]{7,20}$/, { message: 'Invalid phone format' })
  phone?: string;

  @ApiPropertyOptional({ description: 'Customer address', example: 'Kathmandu, Nepal', maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;

  @ApiPropertyOptional({ description: 'Internal notes about the customer', example: 'VIP customer', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class UpdateCustomerDto extends PartialType(CreateCustomerDto) {
  @ApiPropertyOptional({ description: 'Active status', example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CustomerQueryDto {
  @ApiPropertyOptional({ description: 'Search by name or last-4 phone hint', example: 'Ram' })
  @IsOptional()
  @IsString()
  search?: string;   // searches name and phoneHint

  @ApiPropertyOptional({ description: 'Filter by active status', example: true })
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

/** Used when looking up a customer by their exact phone number */
export class PhoneLookupDto {
  @ApiProperty({ description: 'Exact phone number to look up', example: '+977-9841234567' })
  @IsString()
  @Matches(/^[0-9+\-\s()]{7,20}$/, { message: 'Invalid phone format' })
  phone: string;
}
