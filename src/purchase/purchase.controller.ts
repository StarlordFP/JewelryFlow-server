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
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { PurchaseService } from './purchase.service';
import {
  CreateSupplierDto,
  UpdateSupplierDto,
  SupplierQueryDto,
  CreatePurchaseOrderDto,
  ReceivePurchaseOrderDto,
  PurchaseOrderQueryDto,
} from './dto/purchase.dto';
// import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/roles.decorator';

// ─── SUPPLIER CONTROLLER ─────────────────────────────────────────────────────

@ApiTags('Purchase')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller('suppliers')
export class SupplierController {
  constructor(private readonly purchaseService: PurchaseService) {}

  @Post()
  @Roles('OWNER', 'MANAGER')
  create(@Body() dto: CreateSupplierDto) {
    return this.purchaseService.createSupplier(dto);
  }

  @Get()
  @Roles('OWNER', 'MANAGER', 'STAFF')
  list(@Query() query: SupplierQueryDto) {
    return this.purchaseService.listSuppliers(query);
  }

  @Get(':id')
  @Roles('OWNER', 'MANAGER', 'STAFF')
  findOne(@Param('id') id: string) {
    return this.purchaseService.getSupplier(id);
  }

  @Patch(':id')
  @Roles('OWNER', 'MANAGER')
  update(@Param('id') id: string, @Body() dto: UpdateSupplierDto) {
    return this.purchaseService.updateSupplier(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @Roles('OWNER')
  deactivate(@Param('id') id: string) {
    return this.purchaseService.deactivateSupplier(id);
  }
}

// ─── PURCHASE ORDER CONTROLLER ────────────────────────────────────────────────

@ApiTags('Purchase')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller('purchase-orders')
export class PurchaseOrderController {
  constructor(private readonly purchaseService: PurchaseService) {}

  /** POST /purchase-orders — create order with pre-filled lines */
  @Post()
  @Roles('OWNER', 'MANAGER')
  create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreatePurchaseOrderDto,
  ) {
    return this.purchaseService.createPurchaseOrder(userId, dto);
  }

  /** GET /purchase-orders — list with filters */
  @Get()
  @Roles('OWNER', 'MANAGER', 'STAFF')
  list(@Query() query: PurchaseOrderQueryDto) {
    return this.purchaseService.listPurchaseOrders(query);
  }

  /** GET /purchase-orders/:id — full detail with lines and stock items */
  @Get(':id')
  @Roles('OWNER', 'MANAGER', 'STAFF')
  findOne(@Param('id') id: string) {
    return this.purchaseService.getPurchaseOrder(id);
  }

  /**
   * PATCH /purchase-orders/:id/receive
   * Mark as RECEIVED — creates StockItems for all lines.
   * Line weights/prices can be updated on receipt.
   */
  @Patch(':id/receive')
  @Roles('OWNER', 'MANAGER')
  receive(
    @Param('id') id: string,
    @Body() dto: ReceivePurchaseOrderDto,
  ) {
    return this.purchaseService.receivePurchaseOrder(id, dto);
  }

  /** PATCH /purchase-orders/:id/cancel */
  @Patch(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Roles('OWNER', 'MANAGER')
  cancel(@Param('id') id: string) {
    return this.purchaseService.cancelPurchaseOrder(id);
  }
}
