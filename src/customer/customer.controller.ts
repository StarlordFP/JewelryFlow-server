import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  DefaultValuePipe,
  ParseIntPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { CustomerService } from './customer.service';
import {
  CreateCustomerDto,
  UpdateCustomerDto,
  CustomerQueryDto,
  PhoneLookupDto,
} from './dto/customer.dto';
// import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('Customers')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller('customers')
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  /**
   * POST /customers
   * Register a new customer. Phone is hashed before storage.
   * Roles: OWNER, MANAGER, STAFF
   */
  @Post()
  @Roles('OWNER', 'MANAGER', 'STAFF')
  @ApiOperation({ summary: 'Create a new customer', description: 'Register a new customer. Phone number is hashed (SHA-256) before storage; only the last 4 digits are kept as a hint.' })
  @ApiResponse({ status: 201, description: 'Customer created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid input or duplicate phone' })
  create(@Body() dto: CreateCustomerDto) {
    return this.customerService.create(dto);
  }

  /**
   * GET /customers
   * List customers. Search on name or last-4 phone hint.
   * phoneHash is never returned in any list or detail response.
   */
  @Get()
  @Roles('OWNER', 'MANAGER', 'STAFF')
  @ApiOperation({ summary: 'List customers', description: 'Paginated list of customers with optional search on name or last-4 phone hint. Phone hash is never returned.' })
  @ApiResponse({ status: 200, description: 'Customers retrieved successfully' })
  list(@Query() query: CustomerQueryDto) {
    return this.customerService.list(query);
  }

  /**
   * GET /customers/:id
   * Single customer with transaction counts.
   */
  @Get(':id')
  @Roles('OWNER', 'MANAGER', 'STAFF')
  @ApiOperation({ summary: 'Get customer details', description: 'Get a single customer with transaction counts' })
  @ApiParam({ name: 'id', description: 'Customer ID' })
  @ApiResponse({ status: 200, description: 'Customer retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Customer not found' })
  findOne(@Param('id') id: string) {
    return this.customerService.findById(id);
  }

  /**
   * POST /customers/lookup-by-phone
   * Lookup a customer by raw phone number (server hashes it, never logs plaintext).
   * POST (not GET) intentionally — phone number should not appear in server logs/URLs.
   */
  @Post('lookup-by-phone')
  @HttpCode(HttpStatus.OK)
  @Roles('OWNER', 'MANAGER', 'STAFF')
  @ApiOperation({ summary: 'Lookup customer by phone', description: 'Lookup a customer by exact phone number. Uses POST to avoid exposing the phone number in URLs/logs. Server hashes the number internally.' })
  @ApiResponse({ status: 200, description: 'Customer found' })
  @ApiResponse({ status: 404, description: 'No customer with this phone number' })
  lookupByPhone(@Body() dto: PhoneLookupDto) {
    return this.customerService.findByPhone(dto);
  }

  /**
   * PATCH /customers/:id
   * Update customer details. Phone change re-hashes and checks uniqueness.
   */
  @Patch(':id')
  @Roles('OWNER', 'MANAGER', 'STAFF')
  @ApiOperation({ summary: 'Update customer', description: 'Update customer details. If phone is changed, it is re-hashed and uniqueness is verified.' })
  @ApiParam({ name: 'id', description: 'Customer ID' })
  @ApiResponse({ status: 200, description: 'Customer updated successfully' })
  @ApiResponse({ status: 400, description: 'Invalid input or duplicate phone' })
  @ApiResponse({ status: 404, description: 'Customer not found' })
  update(@Param('id') id: string, @Body() dto: UpdateCustomerDto) {
    return this.customerService.update(id, dto);
  }

  /**
   * DELETE /customers/:id
   * Soft-deactivate. Historical transactions are preserved.
   * Roles: OWNER, MANAGER
   */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Deactivate customer', description: 'Soft-deactivate a customer. Historical transactions are preserved.' })
  @ApiParam({ name: 'id', description: 'Customer ID' })
  @ApiResponse({ status: 200, description: 'Customer deactivated successfully' })
  @ApiResponse({ status: 404, description: 'Customer not found' })
  deactivate(@Param('id') id: string) {
    return this.customerService.deactivate(id);
  }

  /**
   * GET /customers/:id/past-sales
   * SELL transactions with line detail for buyback reference (read-only).
   */
  @Get(':id/past-sales')
  @Roles('OWNER', 'MANAGER', 'STAFF')
  @ApiOperation({
    summary: 'Get customer past sales',
    description:
      'SELL transactions for a customer, newest first, with line items (description, metal, weight, rate). Read-only.',
  })
  @ApiParam({ name: 'id', description: 'Customer ID' })
  @ApiResponse({ status: 200, description: 'Past sales retrieved' })
  @ApiResponse({ status: 404, description: 'Customer not found' })
  pastSales(@Param('id') id: string) {
    return this.customerService.getPastSales(id);
  }

  /**
   * GET /customers/:id/transactions
   * Paginated purchase history for a customer.
   */
  @Get(':id/transactions')
  @Roles('OWNER', 'MANAGER', 'STAFF')
  @ApiOperation({ summary: 'Get customer transactions', description: 'Paginated purchase history for a customer' })
  @ApiParam({ name: 'id', description: 'Customer ID' })
  @ApiQuery({ name: 'page', required: false, description: 'Page number', example: 1 })
  @ApiQuery({ name: 'limit', required: false, description: 'Items per page', example: 20 })
  @ApiResponse({ status: 200, description: 'Transaction history retrieved' })
  @ApiResponse({ status: 404, description: 'Customer not found' })
  transactionHistory(
    @Param('id') id: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.customerService.getTransactionHistory(id, page, limit);
  }

  /**
   * GET /customers/:id/summary
   * Lifetime value: total transactions, buybacks.
   */
  @Get(':id/summary')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Get customer summary', description: 'Lifetime value statistics: total transactions and buybacks' })
  @ApiParam({ name: 'id', description: 'Customer ID' })
  @ApiResponse({ status: 200, description: 'Summary retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Customer not found' })
  summary(@Param('id') id: string) {
    return this.customerService.getCustomerSummary(id);
  }
}
