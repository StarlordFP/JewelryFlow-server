import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { ExportService } from './export.service';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@UseGuards(RolesGuard)
@Roles('OWNER', 'MANAGER')
@Controller('export')
export class ExportController {
  constructor(private readonly exportService: ExportService) {}

  @Get('stock')
  async exportStock(
    @Res() res: Response,
    @Query('status') status?: string,
    @Query('categoryId') categoryId?: string,
    @Query('metalTypeId') metalTypeId?: string,
  ) {
    return this.exportService.exportStock(res, { status, categoryId, metalTypeId });
  }

  @Get('sales')
  async exportSales(
    @Res() res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('txType') txType?: string,
  ) {
    return this.exportService.exportSales(res, { from, to, txType });
  }

  @Get('karigar')
  async exportKarigar(@Res() res: Response) {
    return this.exportService.exportKarigar(res);
  }

  @Get('purchase')
  async exportPurchase(@Res() res: Response) {
    return this.exportService.exportPurchase(res);
  }

  @Get('stock-template')
  async downloadStockTemplate(@Res() res: Response) {
    return this.exportService.downloadStockTemplate(res);
  }

  @Get('purchase-template')
  async downloadPurchaseTemplate(@Res() res: Response) {
    return this.exportService.downloadPurchaseTemplate(res);
  }
}
