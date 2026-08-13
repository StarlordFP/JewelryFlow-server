import { Test, TestingModule } from '@nestjs/testing';
import { ImportService } from './import.service';
import { PrismaService } from '../prisma/prisma.service';
import { StockSkuService } from '../stock/stock-sku.service';
import { Workbook } from 'exceljs';
import { BadRequestException } from '@nestjs/common';

const mockPrismaInstance = {
  itemCategory: {
    findMany: jest.fn().mockResolvedValue([
      { id: 'cat-ring', name: 'Ring' },
      { id: 'cat-necklace', name: 'Necklace' },
    ]),
  },
  metalType: {
    findMany: jest.fn().mockResolvedValue([
      { id: 'met-gold', name: 'Gold' },
      { id: 'met-silver', name: 'Silver' },
    ]),
  },
  stockItem: {
    create: jest.fn(),
  },
  $transaction: jest.fn(),
};

// Set up transaction wrapper
mockPrismaInstance.$transaction.mockImplementation((callback) => callback(mockPrismaInstance));

const makeSkuServiceMock = () => ({
  generateCategoryKaratSku: jest.fn().mockResolvedValue('RNG-0001-22K'),
});

describe('ImportService (Unit)', () => {
  let service: ImportService;
  let prismaMock: any;
  let skuServiceMock: any;

  beforeEach(async () => {
    prismaMock = mockPrismaInstance;
    skuServiceMock = makeSkuServiceMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImportService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: StockSkuService, useValue: skuServiceMock },
      ],
    }).compile();

    service = module.get<ImportService>(ImportService);
  });

  async function createExcelBuffer(rows: any[]) {
    const wb = new Workbook();
    const ws = wb.addWorksheet('Stock');
    ws.columns = [
      { header: 'Name', key: 'name' },
      { header: 'Category', key: 'category' },
      { header: 'Metal', key: 'metal' },
      { header: 'Karat', key: 'karat' },
      { header: 'Gross Weight (g)', key: 'grossWeightGram' },
      { header: 'Gross Weight (tola)', key: 'grossWeightTola' },
      { header: 'Jerty (g)', key: 'jertyGram' },
      { header: 'Total Jyala (NPR)', key: 'totalJyalaNpr' },
      { header: 'Notes', key: 'notes' },
    ];
    for (const r of rows) {
      ws.addRow(r);
    }
    const buf = await wb.xlsx.writeBuffer();
    return {
      buffer: buf as any,
      originalname: 'test.xlsx',
      mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      size: buf.byteLength,
    };
  }

  it('should successfully parse and import valid stock rows', async () => {
    const file = await createExcelBuffer([
      {
        name: 'Engagement Ring',
        category: 'Ring',
        metal: 'Gold',
        karat: 22,
        grossWeightGram: 5.5,
        grossWeightTola: '',
        jertyGram: 0.1,
        totalJyalaNpr: 1200,
        notes: 'Spec import',
      },
    ]);

    const result = await service.importStock(file);

    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(result.skus).toContain('RNG-0001-22K');
    expect(prismaMock.stockItem.create).toHaveBeenCalled();
  });

  it('should fail and throw BadRequestException if >20% rows fail validation', async () => {
    // 2 failed, 1 passed = 66.6% failure rate (> 20%)
    const file = await createExcelBuffer([
      {
        name: 'Bad Category',
        category: 'InvalidCat', // fails
        metal: 'Gold',
        karat: 22,
        grossWeightGram: 5.5,
      },
      {
        name: 'Bad Weight',
        category: 'Ring',
        metal: 'Gold',
        karat: 22,
        grossWeightGram: 0, // fails
        grossWeightTola: 0, // fails
      },
      {
        name: 'Good Item',
        category: 'Ring',
        metal: 'Gold',
        karat: 22,
        grossWeightGram: 5.5,
      },
    ]);

    await expect(service.importStock(file)).rejects.toThrow(BadRequestException);
  });

  it('should import the good rows if <=20% rows fail validation', async () => {
    // 1 failed, 4 passed = 20% failure rate (<= 20%)
    const file = await createExcelBuffer([
      { category: 'InvalidCat', metal: 'Gold', grossWeightGram: 5.5 }, // fails
      { category: 'Ring', metal: 'Gold', grossWeightGram: 5.5 },       // passes
      { category: 'Ring', metal: 'Gold', grossWeightGram: 5.5 },       // passes
      { category: 'Ring', metal: 'Gold', grossWeightGram: 5.5 },       // passes
      { category: 'Ring', metal: 'Gold', grossWeightGram: 5.5 },       // passes
    ]);

    const result = await service.importStock(file);

    expect(result.imported).toBe(4);
    expect(result.skipped).toBe(1);
    expect(result.errors).toHaveLength(1);
  });
});
