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
import { ApiTags } from '@nestjs/swagger';
import { KarigarService } from './karigar.service';
import {
  CreateKarigarDto,
  UpdateKarigarDto,
  KarigarQueryDto,
  CreateProductionOrderDto,
  CreateProductionIssueDto,
  IssueProductionOrderLinesBatchDto,
  WeighInProductionOrderLineDto,
  WeighInProductionOrderLinesBatchDto,
  ApproveProductionOrderLinesBatchDto,
  CreateProductionReturnDto,
  CreateKarigarPaymentDto,
  ResolveDisputeDto,
  ProductionOrderQueryDto,
} from './dto/karigar.dto';
// JwtAuthGuard NOT imported here — all endpoints are protected by the
// global APP_GUARD registered in AppModule (app.module.ts, line 68).
// { provide: APP_GUARD, useClass: JwtAuthGuard }
// Do NOT add a controller-level guard — it would double-run auth.
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles, CurrentUser } from '../common/decorators/roles.decorator';

// ─── KARIGAR CONTROLLER ───────────────────────────────────────────────────────

@ApiTags('Karigar')
@UseGuards(RolesGuard)
@Controller('karigars')
export class KarigarController {
  constructor(private readonly karigarService: KarigarService) { }

  @Post()
  @Roles('OWNER', 'MANAGER')
  create(@Body() dto: CreateKarigarDto) {
    return this.karigarService.createKarigar(dto);
  }

  @Get()
  @Roles('OWNER', 'MANAGER', 'STAFF')
  list(@Query() query: KarigarQueryDto) {
    return this.karigarService.listKarigars(query);
  }

  @Get(':id')
  @Roles('OWNER', 'MANAGER', 'STAFF')
  findOne(@Param('id') id: string) {
    return this.karigarService.getKarigar(id);
  }

  @Patch(':id')
  @Roles('OWNER', 'MANAGER')
  update(@Param('id') id: string, @Body() dto: UpdateKarigarDto) {
    return this.karigarService.updateKarigar(id, dto);
  }

  @Get(':id/metal-balance')
  @Roles('OWNER', 'MANAGER', 'STAFF')
  metalBalance(@Param('id') id: string) {
    return this.karigarService.getKarigarMetalBalance(id);
  }

  @Get(':id/payments')
  @Roles('OWNER', 'MANAGER')
  payments(@Param('id') id: string) {
    return this.karigarService.getKarigarPayments(id);
  }
}

// ─── PRODUCTION ORDER CONTROLLER ─────────────────────────────────────────────

@ApiTags('Karigar')
@UseGuards(RolesGuard)
@Controller('production-orders')
export class ProductionOrderController {
  constructor(private readonly karigarService: KarigarService) { }

  /** POST /production-orders — open a new production order */
  @Post()
  @Roles('OWNER', 'MANAGER')
  create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateProductionOrderDto,
  ) {
    return this.karigarService.createProductionOrder(userId, dto);
  }

  /** GET /production-orders — list with filters */
  @Get()
  @Roles('OWNER', 'MANAGER', 'STAFF')
  list(@Query() query: ProductionOrderQueryDto) {
    return this.karigarService.listProductionOrders(query);
  }

  /** GET /production-orders/:id — full detail with issues, returns, weight summary */
  @Get(':id')
  @Roles('OWNER', 'MANAGER', 'STAFF')
  findOne(@Param('id') id: string) {
    return this.karigarService.getProductionOrder(id);
  }

  /** PATCH /production-orders/:id/complete */
  @Patch(':id/complete')
  @HttpCode(HttpStatus.OK)
  @Roles('OWNER', 'MANAGER')
  complete(@Param('id') id: string) {
    return this.karigarService.completeProductionOrder(id);
  }

  /** POST /production-orders/:orderId/lines/issue-batch */
  @Post(':orderId/lines/issue-batch')
  @Roles('OWNER', 'MANAGER')
  issueLinesBatch(
    @Param('orderId') orderId: string,
    @Body() dto: IssueProductionOrderLinesBatchDto,
  ) {
    return this.karigarService.issueProductionOrderLinesBatch(orderId, dto);
  }
}

// ─── PRODUCTION ORDER LINE CONTROLLER ─────────────────────────────────────────

@ApiTags('Karigar')
@UseGuards(RolesGuard)
@Controller('production-order-lines')
export class ProductionOrderLineController {
  constructor(private readonly karigarService: KarigarService) { }

  /** POST /production-order-lines/weigh-in-batch */
  @Post('weigh-in-batch')
  @Roles('OWNER', 'MANAGER')
  weighInBatch(@Body() dto: WeighInProductionOrderLinesBatchDto) {
    return this.karigarService.weighInProductionOrderLinesBatch(dto);
  }

  /** POST /production-order-lines/approve-batch */
  @Post('approve-batch')
  @Roles('OWNER', 'MANAGER')
  approveBatch(@Body() dto: ApproveProductionOrderLinesBatchDto) {
    return this.karigarService.approveProductionOrderLinesBatch(dto);
  }

  /** GET /production-order-lines/:id */
  @Get(':id')
  @Roles('OWNER', 'MANAGER', 'STAFF')
  findOne(@Param('id') id: string) {
    return this.karigarService.getProductionOrderLine(id);
  }

  /** POST /production-order-lines/:id/weigh-in */
  @Post(':id/weigh-in')
  @Roles('OWNER', 'MANAGER')
  weighIn(
    @Param('id') id: string,
    @Body() dto: WeighInProductionOrderLineDto,
  ) {
    return this.karigarService.weighInProductionOrderLine(id, dto);
  }

  /** POST /production-order-lines/:id/correct-weigh-in */
  @Post(':id/correct-weigh-in')
  @HttpCode(HttpStatus.OK)
  @Roles('OWNER', 'MANAGER')
  correctWeighIn(@Param('id') id: string) {
    return this.karigarService.correctWeighInProductionOrderLine(id);
  }

  /** POST /production-order-lines/:id/approve */
  @Post(':id/approve')
  @Roles('OWNER', 'MANAGER')
  approve(@Param('id') id: string) {
    return this.karigarService.approveProductionOrderLine(id);
  }
}

// ─── PRODUCTION ISSUE CONTROLLER ─────────────────────────────────────────────

@ApiTags('Karigar')
@UseGuards(RolesGuard)
@Controller('production-issues')
export class ProductionIssueController {
  constructor(private readonly karigarService: KarigarService) { }

  /**
   * POST /production-issues
   * Issue raw metal to karigar.
   * Rate defaults to today's current rate.
   */
  @Post()
  @Roles('OWNER', 'MANAGER')
  create(@Body() dto: CreateProductionIssueDto) {
    return this.karigarService.createProductionIssue(dto);
  }
}

// ─── PRODUCTION RETURN CONTROLLER ────────────────────────────────────────────

@ApiTags('Karigar')
@UseGuards(RolesGuard)
@Controller('production-returns')
export class ProductionReturnController {
  constructor(private readonly karigarService: KarigarService) { }

  /**
   * POST /production-returns
   * Record karigar returning finished items.
   * Auto-creates KarigarDispute if wastage exceeds tolerance.
   * Creates StockItem (origin=KARIGAR) for each piece.
   */
  @Post()
  @Roles('OWNER', 'MANAGER')
  create(@Body() dto: CreateProductionReturnDto) {
    return this.karigarService.createProductionReturn(dto);
  }
}

// ─── KARIGAR PAYMENT CONTROLLER ──────────────────────────────────────────────

@ApiTags('Karigar')
@UseGuards(RolesGuard)
@Controller('karigar-payments')
export class KarigarPaymentController {
  constructor(private readonly karigarService: KarigarService) { }

  /**
   * POST /karigar-payments
   * Pay karigar — cash, metal, or both.
   * Optionally apply dispute deduction.
   */
  @Post()
  @Roles('OWNER', 'MANAGER')
  create(@Body() dto: CreateKarigarPaymentDto) {
    return this.karigarService.createKarigarPayment(dto);
  }
}

// ─── KARIGAR DISPUTE CONTROLLER ──────────────────────────────────────────────

@ApiTags('Karigar')
@UseGuards(RolesGuard)
@Controller('karigar-disputes')
export class KarigarDisputeController {
  constructor(private readonly karigarService: KarigarService) { }

  /**
   * GET /karigar-disputes
   * List all disputes. Filter by karigarId.
   */
  @Get()
  @Roles('OWNER', 'MANAGER')
  list(@Query('karigarId') karigarId?: string) {
    return this.karigarService.listDisputes(karigarId);
  }

  /**
   * PATCH /karigar-disputes/:id/resolve
   * Owner sets deduction amount and marks dispute resolved.
   * Deduction applied manually in next KarigarPayment.
   */
  @Patch(':id/resolve')
  @HttpCode(HttpStatus.OK)
  @Roles('OWNER')
  resolve(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: ResolveDisputeDto,
  ) {
    return this.karigarService.resolveDispute(id, dto, userId);
  }
}
