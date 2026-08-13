import { Test, TestingModule } from '@nestjs/testing';
import { ExportService } from './export.service';
import { PrismaService } from '../prisma/prisma.service';
import { Response } from 'express';
import { Workbook } from 'exceljs';

const makePrismaMock = () => ({
  stockItem: {
    findMany: jest.fn(),
  },
  transaction: {
    findMany: jest.fn(),
  },
  productionOrder: {
    findMany: jest.fn(),
  },
  karigarDispute: {
    findMany: jest.fn(),
  },
  purchaseOrder: {
    findMany: jest.fn(),
  },
  itemCategory: {
    findMany: jest.fn().mockResolvedValue([{ id: 'cat-1', name: 'Ring' }]),
  },
  metalType: {
    findMany: jest.fn().mockResolvedValue([{ id: 'met-1', name: 'Gold' }]),
  },
});

describe('ExportService (Unit)', () => {
  let service: ExportService;
  let prismaMock: any;
  let mockRes: Partial<Response>;

  beforeEach(async () => {
    prismaMock = makePrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExportService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<ExportService>(ExportService);

    mockRes = {
      setHeader: jest.fn(),
      end: jest.fn(),
    };
  });

  it('should export stock items to Excel with correct headers', async () => {
    const mockStock = [
      {
        sku: 'RNG-0001-22K',
        name: 'Gold Ring',
        category: { name: 'Ring' },
        metalType: { name: 'Gold' },
        karat: 22,
        grossWeightGram: 10,
        grossWeightTola: 0.8573,
        jertyGram: 0.2,
        totalJyalaNpr: 1500,
        status: 'IN_STOCK',
        origin: 'DIRECT',
        entryRate: { sellRatePerGram: 9000 },
        createdAt: new Date(),
      },
    ];
    prismaMock.stockItem.findMany.mockResolvedValue(mockStock);

    const writeSpy = jest.spyOn(Workbook.prototype.xlsx, 'write').mockImplementation(async (res: any) => {
      // Mock the spreadsheet write operation
      res.end();
    });

    await service.exportStock(mockRes as Response, {});

    expect(prismaMock.stockItem.findMany).toHaveBeenCalled();
    expect(mockRes.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(mockRes.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      expect.stringContaining('attachment; filename=stock-export-'),
    );
    expect(writeSpy).toHaveBeenCalled();
    expect(mockRes.end).toHaveBeenCalled();

    writeSpy.mockRestore();
  });

  it('should export sales lines to Excel with correct headers and separator rows', async () => {
    const mockSales = [
      {
        billNumber: '10001',
        createdAt: new Date(),
        txType: 'SELL',
        customerName: 'Customer A',
        customerPhone: '9800000000',
        discountNpr: 100,
        roundingNpr: 2,
        grandTotalNpr: 50000,
        paidAmountNpr: 50000,
        balanceNpr: 0,
        paymentMethod: 'CASH',
        lines: [
          {
            grossWeightGram: 5,
            billableGram: 5.1,
            ratePerGram: 9000,
            metalValueNpr: 45000,
            jyalaNpr: 5100,
            lineTotalNpr: 50100,
            stockItem: {
              sku: 'RNG-0002-22K',
              name: 'Ring 2',
              metalType: { name: 'Gold' },
              karat: 22,
            },
          },
        ],
      },
    ];
    prismaMock.transaction.findMany.mockResolvedValue(mockSales);

    const writeSpy = jest.spyOn(Workbook.prototype.xlsx, 'write').mockImplementation(async (res: any) => {
      res.end();
    });

    await service.exportSales(mockRes as Response, {});

    expect(prismaMock.transaction.findMany).toHaveBeenCalled();
    expect(mockRes.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(mockRes.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      expect.stringContaining('attachment; filename=sales-export-'),
    );
    expect(writeSpy).toHaveBeenCalled();
    expect(mockRes.end).toHaveBeenCalled();

    writeSpy.mockRestore();
  });
});
