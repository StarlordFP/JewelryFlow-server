import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { StockService } from '../stock/stock.service';
import {
  CreateStockItemDto,
  UpdateStockItemDto,
  UpdateStockStatusDto,
  PricePreviewDto,
  StockQueryDto,
} from './dto/stock.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('Stock')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('stock')
export class StockController {
  constructor(private readonly stockService: StockService) {}

  /**
   * POST /stock
   * Add a new item to inventory.
   * Jerty and jyala are set here but can be changed later.
   * Roles: OWNER, MANAGER
   */
  @Post()
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Add stock item', description: 'Add a new item to inventory. Jerty and jyala are set here but can be modified later.' })
  @ApiResponse({ status: 201, description: 'Stock item created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid input or validation failed' })
  @ApiResponse({ status: 404, description: 'Category or metal type not found' })
  create(@Body() dto: CreateStockItemDto) {
    return this.stockService.createStockItem(dto);
  }

  /**
   * GET /stock
   * List stock with filters:
   * category, metalType, origin, status, weight range, date range, search
   */
  @Get()
  @Roles('OWNER', 'MANAGER', 'STAFF')
  @ApiOperation({ summary: 'List stock items', description: 'Paginated list of stock items with filters: category, metalType, origin, status, weight range, date range, search' })
  @ApiResponse({ status: 200, description: 'Stock items retrieved successfully' })
  list(@Query() query: StockQueryDto) {
    return this.stockService.listStockItems(query);
  }

  /**
   * PATCH /stock/:id
   * Update jerty, jyala breakdown, tax toggles, notes, photo.
   * Blocked if item is SOLD or SCRAPPED.
   * Roles: OWNER, MANAGER
   */
  @Patch(':id')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Update stock item', description: 'Update jerty, jyala breakdown, tax toggles, notes, or photo. Blocked if item is SOLD or SCRAPPED.' })
  @ApiParam({ name: 'id', description: 'Stock item ID' })
  @ApiResponse({ status: 200, description: 'Stock item updated successfully' })
  @ApiResponse({ status: 404, description: 'Stock item not found' })
  @ApiResponse({ status: 409, description: 'Cannot update SOLD or SCRAPPED items' })
  update(@Param('id') id: string, @Body() dto: UpdateStockItemDto) {
    return this.stockService.updateStockItem(id, dto);
  }

  /**
   * PATCH /stock/:id/status
   * Manually update status: IN_STOCK ↔ RESERVED, or → SCRAPPED.
   * SOLD and RETURNED can only be set via the sales/transaction module.
   * Roles: OWNER, MANAGER
   */
  @Patch(':id/status')
  @Roles('OWNER', 'MANAGER')
  @ApiOperation({ summary: 'Update stock item status', description: 'Manually update status: IN_STOCK ↔ RESERVED, or → SCRAPPED. SOLD and RETURNED are set via the sales module only.' })
  @ApiParam({ name: 'id', description: 'Stock item ID' })
  @ApiResponse({ status: 200, description: 'Status updated successfully' })
  @ApiResponse({ status: 404, description: 'Stock item not found' })
  @ApiResponse({ status: 409, description: 'Invalid status transition' })
  updateStatus(@Param('id') id: string, @Body() dto: UpdateStockStatusDto) {
    return this.stockService.updateStockStatus(id, dto);
  }

  /**
   * POST /stock/price-preview
   * Calculate full price for a stock item using today's rate.
   * Jerty and jyala can be overridden here (bill-time adjustment).
   * Returns both owner view (full jyala breakdown) and customer view (jyala as single line).
   * Roles: OWNER, MANAGER, STAFF
   */
  @Post('price-preview')
  @HttpCode(HttpStatus.OK)
  @Roles('OWNER', 'MANAGER', 'STAFF')
  @ApiOperation({ summary: 'Price preview', description: 'Calculate full price for a stock item using today\'s rate. Jerty and jyala can be overridden (bill-time adjustment). Returns owner view (full breakdown) and customer view (single jyala line).' })
  @ApiResponse({ status: 200, description: 'Price calculated successfully' })
  @ApiResponse({ status: 404, description: 'Stock item or daily rate not found' })
  pricePreview(@Body() dto: PricePreviewDto) {
    return this.stockService.getPricePreview(dto);
  }

  /**
   * GET /stock/suggestions?categoryId=&metalTypeId=&weightGram=
   * Returns suggested jerty weight and jyala range for a given
   * category + metal + weight. Used by frontend to hint shopkeeper.
   * Roles: OWNER, MANAGER, STAFF
   */
  @Get('suggestions')
  @Roles('OWNER', 'MANAGER', 'STAFF')
  @ApiOperation({ summary: 'Get jerty & jyala suggestions', description: 'Returns suggested jerty weight and jyala range for a given category + metal + weight combination. Used to hint the shopkeeper.' })
  @ApiQuery({ name: 'categoryId', required: true, description: 'Category ID' })
  @ApiQuery({ name: 'metalTypeId', required: true, description: 'Metal type ID' })
  @ApiQuery({ name: 'weightGram', required: true, description: 'Weight in grams', example: '11.664' })
  @ApiResponse({ status: 200, description: 'Suggestions retrieved successfully' })
  suggestions(
    @Query('categoryId')  categoryId:  string,
    @Query('metalTypeId') metalTypeId: string,
    @Query('weightGram')  weightGram:  string,
  ) {
    return this.stockService.getSuggestions(
      categoryId,
      metalTypeId,
      parseFloat(weightGram),
    );
  }


  @Get('categories')
  @Roles('OWNER', 'MANAGER', 'STAFF')
  getCategories() {
    return this.stockService.getCategories()
  }

  /**
   * GET /stock/:id
   * Full detail of one stock item including addons and origin trace.
   */
  @Get(':id')
  @Roles('OWNER', 'MANAGER', 'STAFF')
  @ApiOperation({ summary: 'Get stock item details', description: 'Full detail of one stock item including addons and origin trace' })
  @ApiParam({ name: 'id', description: 'Stock item ID' })
  @ApiResponse({ status: 200, description: 'Stock item retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Stock item not found' })
  findOne(@Param('id') id: string) {
    return this.stockService.getStockItem(id);
  }
}
