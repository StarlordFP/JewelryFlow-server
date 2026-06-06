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
  BadRequestException,
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
  StandalonePricePreviewDto,
  StockQueryDto,
  CreateCategoryDto,    // ← add
  UpdateCategoryDto,    // ← add
} from './dto/stock.dto';
// import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('Stock')
@ApiBearerAuth()
@UseGuards(RolesGuard)
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
   * Supports two modes:
   *   1. With stockItemId — uses stored item data, allows jerty/jyala overrides
   *   2. Without stockItemId — standalone preview before stock exists
   * Returns both owner view (full jyala breakdown) and customer view (jyala as single line).
   * Roles: OWNER, MANAGER, STAFF
   */
  @Post('price-preview')
  @HttpCode(HttpStatus.OK)
  @Roles('OWNER', 'MANAGER', 'STAFF')
  @ApiOperation({ summary: 'Price preview', description: 'Calculate full price using today\'s rate. Accepts either stockItemId (for existing items) or full item details (for preview before adding stock).' })
  @ApiResponse({ status: 200, description: 'Price calculated successfully' })
  @ApiResponse({ status: 404, description: 'Stock item or daily rate not found' })
  pricePreview(@Body() dto: any) {
    // Route to the correct handler based on whether stockItemId is present
    if (dto.stockItemId) {
      return this.stockService.getPricePreview(dto as PricePreviewDto);
    }
    // Standalone preview — validate required fields
    if (!dto.metalTypeId || !dto.grossWeight) {
      throw new BadRequestException('metalTypeId and grossWeight are required for standalone price preview');
    }
    return this.stockService.getStandalonePricePreview(dto as StandalonePricePreviewDto);
  }

  /**
   * GET /stock/suggestions?categoryId=&metalTypeId=&grossWeightGram=
   * Returns suggested jerty weight and jyala range for a given
   * category + metal + weight. Used by frontend to hint shopkeeper.
   * Roles: OWNER, MANAGER, STAFF
   */
  @Get('suggestions')
  @Roles('OWNER', 'MANAGER', 'STAFF')
  @ApiOperation({ summary: 'Get jerty & jyala suggestions', description: 'Returns suggested jerty weight and jyala range for a given category + metal + weight combination. Used to hint the shopkeeper.' })
  @ApiQuery({ name: 'categoryId', required: true, description: 'Category ID' })
  @ApiQuery({ name: 'metalTypeId', required: true, description: 'Metal type ID' })
  @ApiQuery({ name: 'grossWeightGram', required: true, description: 'Weight in grams', example: '11.664' })
  @ApiResponse({ status: 200, description: 'Suggestions retrieved successfully' })
  suggestions(
    @Query('categoryId')     categoryId:     string,
    @Query('metalTypeId')    metalTypeId:    string,
    @Query('grossWeightGram') grossWeightGram: string,
  ) {
    const weight = parseFloat(grossWeightGram);
    if (isNaN(weight)) {
      throw new BadRequestException('grossWeightGram must be a valid number');
    }
    return this.stockService.getSuggestions(
      categoryId,
      metalTypeId,
      weight,
    );
  }


  // ─── CATEGORY MANAGEMENT ──────────────────────────────────────────────────────

/**
 * GET /stock/categories
 * List all active categories.
 * Roles: OWNER, MANAGER, STAFF
 */
@Get('categories')
@Roles('OWNER', 'MANAGER', 'STAFF')
@ApiOperation({ summary: 'List categories' })
getCategories() {
  return this.stockService.getCategories();
}

/**
 * POST /stock/categories
 * Owner creates a new category.
 * Roles: OWNER, MANAGER
 */
@Post('categories')
@Roles('OWNER', 'MANAGER')
@ApiOperation({ summary: 'Create category', description: 'Owner creates a new jewelry category e.g. Ring, Necklace, Bangle' })
@ApiResponse({ status: 201, description: 'Category created' })
@ApiResponse({ status: 409, description: 'Category name already exists' })
createCategory(@Body() dto: CreateCategoryDto) {
  return this.stockService.createCategory(dto.name);
}

/**
 * PATCH /stock/categories/:id
 * Rename or toggle active status.
 * Roles: OWNER, MANAGER
 */
@Patch('categories/:id')
@Roles('OWNER', 'MANAGER')
@ApiOperation({ summary: 'Update category', description: 'Rename category or toggle active status' })
@ApiParam({ name: 'id', description: 'Category ID' })
@ApiResponse({ status: 200, description: 'Category updated' })
@ApiResponse({ status: 404, description: 'Category not found' })
@ApiResponse({ status: 409, description: 'Category name already exists' })
updateCategory(@Param('id') id: string, @Body() dto: UpdateCategoryDto) {
  return this.stockService.updateCategory(id, dto);
}

/**
 * DELETE /stock/categories/:id
 * Soft delete — sets isActive=false.
 * Blocked if active stock items use this category.
 * Roles: OWNER
 */
@Patch('categories/:id/deactivate')
@HttpCode(HttpStatus.OK)
@Roles('OWNER')
@ApiOperation({ summary: 'Deactivate category', description: 'Soft delete — blocked if active stock items use this category' })
@ApiParam({ name: 'id', description: 'Category ID' })
@ApiResponse({ status: 200, description: 'Category deactivated' })
@ApiResponse({ status: 409, description: 'Category in use by active stock items' })
deactivateCategory(@Param('id') id: string) {
  return this.stockService.deactivateCategory(id);
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
