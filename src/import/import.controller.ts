import { Controller, Post, UseInterceptors, UploadedFile, UseGuards } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ImportService } from './import.service';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles, CurrentUser } from '../common/decorators/roles.decorator';

/** Local type alias — avoids relying on Express global namespace augmentation */
type UploadedXlsx = { buffer: Buffer; originalname: string; mimetype: string; size: number };

@UseGuards(RolesGuard)
@Roles('OWNER', 'MANAGER')
@Controller('import')
export class ImportController {
  constructor(private readonly importService: ImportService) {}

  /** POST /import/stock — multipart/form-data, field name: file */
  @Post('stock')
  @UseInterceptors(FileInterceptor('file'))
  importStock(@UploadedFile() file: UploadedXlsx) {
    return this.importService.importStock(file as any);
  }

  /** POST /import/purchase — multipart/form-data, field name: file */
  @Post('purchase')
  @UseInterceptors(FileInterceptor('file'))
  importPurchase(
    @UploadedFile() file: UploadedXlsx,
    @CurrentUser('id') userId: string,
  ) {
    return this.importService.importPurchase(file as any, userId);
  }
}
