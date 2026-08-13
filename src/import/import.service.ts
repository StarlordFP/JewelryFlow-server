import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StockSkuService } from '../stock/stock-sku.service';
import { WeightUtil } from '../common/utils/weight.util';
import { Workbook } from 'exceljs';

/** Minimal shape of what Multer puts in req.file — avoids global namespace dependency */
interface MulterFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

interface StockRowData {
  name: string;
  categoryId: string;
  metalTypeId: string;
  karat: number | null;
  weight: { gram: number; tola: number; lal: number };
  jerty: { gram: number; tola: number; lal: number };
  totalJyalaNpr: number;
  notes: string;
}

interface PurchaseLineData {
  supplierName: string;
  description: string;
  categoryId: string | null;
  metalTypeId: string | null;
  karat: number | null;
  weightGram: number;
  price: number;
}

@Injectable()
export class ImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly skuService: StockSkuService,
  ) {}

  private resolveNumber(val: any): number {
    if (val === null || val === undefined) return 0;
    if (typeof val === 'number') return val;
    if (typeof val === 'object' && 'result' in val) {
      return this.resolveNumber(val.result);
    }
    const parsed = parseFloat(val.toString());
    return isNaN(parsed) ? 0 : parsed;
  }

  private resolveString(val: any): string {
    if (val === null || val === undefined) return '';
    if (typeof val === 'object' && 'result' in val) {
      return this.resolveString(val.result);
    }
    return val.toString().trim();
  }

  async importStock(file: MulterFile) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    const workbook = new Workbook();
    try {
      await workbook.xlsx.load(file.buffer as any);
    } catch {
      throw new BadRequestException('Invalid Excel file format');
    }

    const sheet = workbook.getWorksheet(1);
    if (!sheet) {
      throw new BadRequestException('Worksheet not found in file');
    }

    const categories = await this.prisma.itemCategory.findMany();
    const metalTypes = await this.prisma.metalType.findMany();

    const rowsToImport: StockRowData[] = [];
    const errors: string[] = [];
    let totalRows = 0;

    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // skip header

      const name         = this.resolveString(row.getCell(1).value);
      const categoryName = this.resolveString(row.getCell(2).value);
      const metalName    = this.resolveString(row.getCell(3).value);
      const karatValue   = row.getCell(4).value;
      const weightGVal   = row.getCell(5).value;
      const weightTVal   = row.getCell(6).value;
      const jertyVal     = row.getCell(7).value;
      const jyalaVal     = row.getCell(8).value;
      const notes        = this.resolveString(row.getCell(9).value);

      // Skip the grayed example row and fully empty rows
      if (name.toLowerCase() === 'example gold ring') return;
      if (!categoryName && !metalName && !weightGVal && !weightTVal) return;

      totalRows++;

      // Required: Category
      const cat = categories.find(
        (c) => c.name.toLowerCase() === categoryName.toLowerCase(),
      );
      if (!cat) {
        errors.push(`Row ${rowNumber}: Category '${categoryName}' not found`);
        return;
      }

      // Required: Metal
      const metal = metalTypes.find(
        (m) => m.name.toLowerCase() === metalName.toLowerCase(),
      );
      if (!metal) {
        errors.push(`Row ${rowNumber}: Metal type '${metalName}' not found`);
        return;
      }

      // Required: Weight (gram or tola)
      const gWeight = this.resolveNumber(weightGVal);
      const tWeight = this.resolveNumber(weightTVal);
      if (gWeight <= 0 && tWeight <= 0) {
        errors.push(
          `Row ${rowNumber}: Gross Weight (g) or Gross Weight (tola) must be > 0`,
        );
        return;
      }

      const gramValue = gWeight > 0 ? gWeight : tWeight * 11.664;
      const weight = WeightUtil.fromGram(gramValue);

      // Optional: Karat
      let karat: number | null = null;
      if (karatValue) {
        const parsed = parseInt(
          karatValue.toString().replace(/K/i, '').trim(),
          10,
        );
        if (!isNaN(parsed)) karat = parsed;
      }

      const jertyGram = this.resolveNumber(jertyVal);
      const jerty = WeightUtil.fromGram(jertyGram);
      const totalJyalaNpr = this.resolveNumber(jyalaVal);

      rowsToImport.push({
        name,
        categoryId: cat.id,
        metalTypeId: metal.id,
        karat,
        weight,
        jerty,
        totalJyalaNpr,
        notes,
      });
    });

    if (totalRows === 0) {
      throw new BadRequestException('No data rows found in the file');
    }

    if (errors.length / totalRows > 0.2) {
      throw new BadRequestException({
        message:
          `More than 20% of rows failed validation (${errors.length}/${totalRows}). Import aborted.`,
        errors,
        imported: 0,
        skipped: totalRows,
      });
    }

    const createdSkus: string[] = [];

    if (rowsToImport.length > 0) {
      await this.prisma.$transaction(async (tx) => {
        for (const itemData of rowsToImport) {
          const sku = await this.skuService.generateCategoryKaratSku(
            itemData.categoryId,
            itemData.metalTypeId,
            tx,
          );
          createdSkus.push(sku);

          await tx.stockItem.create({
            data: {
              sku,
              name: itemData.name || null,
              origin: 'DIRECT',
              status: 'IN_STOCK',
              categoryId: itemData.categoryId,
              metalTypeId: itemData.metalTypeId,
              karat: itemData.karat,
              grossWeightGram: itemData.weight.gram,
              grossWeightTola: itemData.weight.tola,
              grossWeightLal: itemData.weight.lal,
              jertyGram: itemData.jerty.gram,
              jertyTola: itemData.jerty.tola,
              jertyLal: itemData.jerty.lal,
              totalJyalaNpr: itemData.totalJyalaNpr,
              notes: itemData.notes || null,
            },
          });
        }
      });
    }

    return {
      imported: rowsToImport.length,
      skipped: errors.length,
      errors,
      skus: createdSkus,
    };
  }

  async importPurchase(file: MulterFile, userId: string) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    const workbook = new Workbook();
    try {
      await workbook.xlsx.load(file.buffer as any);
    } catch {
      throw new BadRequestException('Invalid Excel file format');
    }

    const sheet = workbook.getWorksheet(1);
    if (!sheet) {
      throw new BadRequestException('Worksheet not found in file');
    }

    const categories = await this.prisma.itemCategory.findMany();
    const metalTypes  = await this.prisma.metalType.findMany();

    const validLines: PurchaseLineData[] = [];
    const errors: string[] = [];
    let totalRows = 0;

    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // skip header

      const supplierName = this.resolveString(row.getCell(1).value);
      const description  = this.resolveString(row.getCell(2).value);
      const categoryName = this.resolveString(row.getCell(3).value);
      const metalName    = this.resolveString(row.getCell(4).value);
      const karatValue   = row.getCell(5).value;
      const weightGVal   = row.getCell(6).value;
      const priceVal     = row.getCell(7).value;

      // Skip example / empty rows
      if (supplierName.toLowerCase() === 'example supplier ltd') return;
      if (!supplierName && !description && !categoryName && !metalName) return;

      totalRows++;

      if (!supplierName) {
        errors.push(`Row ${rowNumber}: Supplier Name is required`);
        return;
      }
      if (!description) {
        errors.push(`Row ${rowNumber}: Item Description is required`);
        return;
      }

      // Optional: Category
      let categoryId: string | null = null;
      if (categoryName) {
        const cat = categories.find(
          (c) => c.name.toLowerCase() === categoryName.toLowerCase(),
        );
        if (!cat) {
          errors.push(`Row ${rowNumber}: Category '${categoryName}' not found`);
          return;
        }
        categoryId = cat.id;
      }

      // Optional: Metal
      let metalTypeId: string | null = null;
      if (metalName) {
        const metal = metalTypes.find(
          (m) => m.name.toLowerCase() === metalName.toLowerCase(),
        );
        if (!metal) {
          errors.push(`Row ${rowNumber}: Metal '${metalName}' not found`);
          return;
        }
        metalTypeId = metal.id;
      }

      const weightGram = this.resolveNumber(weightGVal);
      if (weightGram <= 0) {
        errors.push(`Row ${rowNumber}: Gross Weight (g) must be > 0`);
        return;
      }

      const price = this.resolveNumber(priceVal);
      if (price < 0) {
        errors.push(`Row ${rowNumber}: Estimated Price (NPR) cannot be negative`);
        return;
      }

      let karat: number | null = null;
      if (karatValue) {
        const parsed = parseInt(
          karatValue.toString().replace(/K/i, '').trim(),
          10,
        );
        if (!isNaN(parsed)) karat = parsed;
      }

      validLines.push({
        supplierName,
        description,
        categoryId,
        metalTypeId,
        karat,
        weightGram,
        price,
      });
    });

    if (totalRows === 0) {
      throw new BadRequestException('No data rows found in the file');
    }

    // Group by supplier name
    const grouped = new Map<string, PurchaseLineData[]>();
    for (const line of validLines) {
      const key = line.supplierName.toLowerCase();
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(line);
    }

    let purchaseOrdersCreated = 0;
    let linesCreated = 0;

    if (validLines.length > 0) {
      await this.prisma.$transaction(async (tx) => {
        for (const [, lines] of grouped.entries()) {
          const suppName = lines[0].supplierName;

          // Find or create supplier
          let supplier = await tx.supplier.findFirst({
            where: { name: { equals: suppName, mode: 'insensitive' } },
          });
          if (!supplier) {
            supplier = await tx.supplier.create({
              data: { name: suppName, supplierType: 'DIRECT' },
            });
          }

          const totalNpr = lines.reduce((sum, l) => sum + l.price, 0);

          const po = await tx.purchaseOrder.create({
            data: {
              supplierId: supplier.id,
              createdByUserId: userId,
              totalNpr,
              status: 'PENDING',
              purchaseDate: new Date(),
            },
          });
          purchaseOrdersCreated++;

          for (const line of lines) {
            const w = WeightUtil.fromGram(line.weightGram);

            await tx.purchaseOrderLine.create({
              data: {
                purchaseOrderId: po.id,
                description: line.description,
                itemName: line.description,
                categoryId: line.categoryId,
                metalTypeId: line.metalTypeId,
                karat: line.karat,
                grossWeightGram: w.gram,
                grossWeightTola: w.tola,
                grossWeightLal: w.lal,
                priceNpr: line.price,
              },
            });
            linesCreated++;
          }
        }
      });
    }

    return {
      purchaseOrdersCreated,
      linesCreated,
      errors,
    };
  }
}
