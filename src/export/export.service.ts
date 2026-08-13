import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Workbook, Worksheet } from 'exceljs';
import { Response } from 'express';

@Injectable()
export class ExportService {
  constructor(private readonly prisma: PrismaService) {}

  private formatWorksheet(sheet: Worksheet, headerColorHex: string) {
    // Freeze header row
    sheet.views = [{ state: 'frozen', ySplit: 1 }];

    // Format Header Row
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF' + headerColorHex.replace('#', '') },
    };

    // Auto-fit widths and apply basic formatting
    sheet.columns?.forEach((column) => {
      let maxLength = 0;
      column.eachCell?.({ includeEmpty: true }, (cell, rowNumber) => {
        const val = cell.value;
        if (rowNumber === 1) return; // skip header for content formatting

        if (val instanceof Date) {
          cell.numFmt = 'dd/mm/yyyy';
        } else if (typeof val === 'number') {
          cell.alignment = { horizontal: 'right' };
        }

        const columnLength = val ? val.toString().length : 0;
        if (columnLength > maxLength) {
          maxLength = columnLength;
        }
      });
      column.width = Math.max(maxLength + 3, 10);
    });
  }

  async exportStock(res: Response, query: { status?: string; categoryId?: string; metalTypeId?: string }) {
    const { status, categoryId, metalTypeId } = query;
    const where: any = {};

    if (categoryId) where.categoryId = categoryId;
    if (metalTypeId) where.metalTypeId = metalTypeId;

    if (status) {
      if (status !== 'ALL') {
        where.status = status;
      }
    } else {
      where.status = 'IN_STOCK';
    }

    const items = await this.prisma.stockItem.findMany({
      where,
      include: {
        category: true,
        metalType: true,
        entryRate: true,
      },
      orderBy: { sku: 'asc' },
    });

    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('Stock');

    sheet.columns = [
      { header: 'SKU', key: 'sku' },
      { header: 'Name', key: 'name' },
      { header: 'Category', key: 'category' },
      { header: 'Metal', key: 'metal' },
      { header: 'Karat', key: 'karat' },
      { header: 'Gross Weight (g)', key: 'grossWeightGram' },
      { header: 'Gross Weight (tola)', key: 'grossWeightTola' },
      { header: 'Jerty (g)', key: 'jertyGram' },
      { header: 'Total Jyala (NPR)', key: 'totalJyalaNpr' },
      { header: 'Status', key: 'status' },
      { header: 'Origin', key: 'origin' },
      { header: 'Entry Rate (NPR/g)', key: 'entryRate' },
      { header: 'Created Date', key: 'createdAt' },
    ];

    for (const item of items) {
      sheet.addRow({
        sku: item.sku,
        name: item.name || '—',
        category: item.category.name,
        metal: item.metalType?.name || '—',
        karat: item.karat !== null ? `${item.karat}K` : '—',
        grossWeightGram: Number(item.grossWeightGram),
        grossWeightTola: Number(item.grossWeightTola),
        jertyGram: Number(item.jertyGram),
        totalJyalaNpr: Number(item.totalJyalaNpr),
        status: item.status,
        origin: item.origin,
        entryRate: item.entryRate ? Number(item.entryRate.sellRatePerGram) : 0,
        createdAt: item.createdAt,
      });
    }

    this.formatWorksheet(sheet, '2E7D32'); // Green for stock

    const dateStr = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=stock-export-${dateStr}.xlsx`);
    await workbook.xlsx.write(res);
    res.end();
  }

  async exportSales(res: Response, query: { from?: string; to?: string; txType?: string }) {
    const { from, to, txType } = query;
    const where: any = {};

    if (txType) where.txType = txType;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    const transactions = await this.prisma.transaction.findMany({
      where,
      include: {
        customer: true,
        lines: {
          include: {
            stockItem: {
              include: {
                metalType: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('Sales Lines');

    sheet.columns = [
      { header: 'Bill Number', key: 'billNumber' },
      { header: 'Date', key: 'date' },
      { header: 'Type', key: 'type' },
      { header: 'Customer Name', key: 'customerName' },
      { header: 'Customer Phone', key: 'customerPhone' },
      { header: 'SKU', key: 'sku' },
      { header: 'Item Name', key: 'itemName' },
      { header: 'Metal', key: 'metal' },
      { header: 'Karat', key: 'karat' },
      { header: 'Gross Weight (g)', key: 'grossWeight' },
      { header: 'Billable Weight (g)', key: 'billableWeight' },
      { header: 'Rate/g (NPR)', key: 'ratePerGram' },
      { header: 'Metal Value (NPR)', key: 'metalValue' },
      { header: 'Jyala (NPR)', key: 'jyala' },
      { header: 'Discount (NPR)', key: 'discount' },
      { header: 'Rounding (NPR)', key: 'rounding' },
      { header: 'Line Total (NPR)', key: 'lineTotal' },
      { header: 'Grand Total (NPR)', key: 'grandTotal' },
      { header: 'Paid (NPR)', key: 'paid' },
      { header: 'Balance (NPR)', key: 'balance' },
      { header: 'Payment Method', key: 'paymentMethod' },
    ];

    for (const txn of transactions) {
      for (const line of txn.lines) {
        sheet.addRow({
          billNumber: txn.billNumber,
          date: txn.createdAt,
          type: txn.txType,
          customerName: txn.customerName || txn.customer?.name || 'Walk-in',
          customerPhone: txn.customerPhone || txn.customer?.phone || '—',
          sku: line.stockItem?.sku || '—',
          itemName: line.stockItem?.name || '—',
          metal: line.stockItem?.metalType?.name || '—',
          karat: line.stockItem?.karat !== null ? `${line.stockItem?.karat}K` : '—',
          grossWeight: Number(line.grossWeightGram),
          billableWeight: Number(line.billableGram),
          ratePerGram: Number(line.ratePerGram),
          metalValue: Number(line.metalValueNpr),
          jyala: Number(line.jyalaNpr),
          discount: Number(txn.discountNpr),
          rounding: Number(txn.roundingNpr),
          lineTotal: Number(line.lineTotalNpr),
          grandTotal: Number(txn.grandTotalNpr),
          paid: Number(txn.paidAmountNpr),
          balance: Number(txn.balanceNpr),
          paymentMethod: txn.paymentMethod,
        });
      }
      // Add a blank separator row between bills
      sheet.addRow([]);
    }

    this.formatWorksheet(sheet, '1565C0'); // Blue for sales

    const dateStr = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=sales-export-${dateStr}.xlsx`);
    await workbook.xlsx.write(res);
    res.end();
  }

  async exportKarigar(res: Response) {
    const orders = await this.prisma.productionOrder.findMany({
      include: {
        karigar: true,
        productionIssues: true,
        productionReturns: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const disputes = await this.prisma.karigarDispute.findMany({
      include: {
        karigar: true,
        metalType: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const workbook = new Workbook();

    // Sheet 1: Production Orders
    const sheet1 = workbook.addWorksheet('Production Orders');
    sheet1.columns = [
      { header: 'Karigar Name', key: 'karigarName' },
      { header: 'Order ID', key: 'orderId' },
      { header: 'Status', key: 'status' },
      { header: 'Tolerance %', key: 'tolerancePct' },
      { header: 'Created Date', key: 'createdAt' },
      { header: 'Total Issued Weight (g)', key: 'issued' },
      { header: 'Total Returned Weight (g)', key: 'returned' },
      { header: 'Total Kharchar (g)', key: 'kharchar' },
    ];

    for (const order of orders) {
      const issued = order.productionIssues.reduce((sum, iss) => sum + Number(iss.issuedWeightGram), 0);
      const returned = order.productionReturns.reduce((sum, ret) => sum + Number(ret.returnedWeightGram), 0);
      const kharchar = order.productionReturns.reduce((sum, ret) => sum + Number(ret.kharcharGram), 0);

      sheet1.addRow({
        karigarName: order.karigar.name,
        orderId: order.id,
        status: order.status,
        tolerancePct: Number(order.tolerancePct),
        createdAt: order.createdAt,
        issued,
        returned,
        kharchar,
      });
    }
    this.formatWorksheet(sheet1, 'E65100'); // Amber for Karigar

    // Sheet 2: Disputes
    const sheet2 = workbook.addWorksheet('Disputes');
    sheet2.columns = [
      { header: 'Karigar Name', key: 'karigarName' },
      { header: 'Order ID', key: 'orderId' },
      { header: 'Metal', key: 'metal' },
      { header: 'Excess Weight (g)', key: 'excessWeight' },
      { header: 'Status', key: 'status' },
      { header: 'Resolution Type', key: 'resolutionType' },
      { header: 'Deduction (NPR)', key: 'deduction' },
      { header: 'Created Date', key: 'createdAt' },
    ];

    for (const dispute of disputes) {
      sheet2.addRow({
        karigarName: dispute.karigar.name,
        orderId: dispute.productionOrderId,
        metal: dispute.metalType?.name || '—',
        excessWeight: Number(dispute.excessWeightGram),
        status: dispute.status,
        resolutionType: dispute.resolutionType || '—',
        deduction: dispute.deductionNpr ? Number(dispute.deductionNpr) : 0,
        createdAt: dispute.createdAt,
      });
    }
    this.formatWorksheet(sheet2, 'E65100');

    const dateStr = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=karigar-export-${dateStr}.xlsx`);
    await workbook.xlsx.write(res);
    res.end();
  }

  async exportPurchase(res: Response) {
    const purchaseOrders = await this.prisma.purchaseOrder.findMany({
      include: {
        supplier: true,
        createdBy: true,
        lines: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const categories = await this.prisma.itemCategory.findMany();
    const metalTypes = await this.prisma.metalType.findMany();

    const catMap = new Map(categories.map((c) => [c.id, c.name]));
    const metalMap = new Map(metalTypes.map((m) => [m.id, m.name]));

    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('Purchases');

    sheet.columns = [
      { header: 'PO Number', key: 'poNumber' },
      { header: 'Supplier', key: 'supplier' },
      { header: 'Status', key: 'status' },
      { header: 'Purchase Date', key: 'purchaseDate' },
      { header: 'Item Description', key: 'description' },
      { header: 'Category', key: 'category' },
      { header: 'Metal', key: 'metal' },
      { header: 'Karat', key: 'karat' },
      { header: 'Gross Weight (g)', key: 'grossWeight' },
      { header: 'Price (NPR)', key: 'price' },
      { header: 'Rate at Purchase (NPR/g)', key: 'rateAtPurchase' },
      { header: 'Created By', key: 'createdBy' },
    ];

    for (const po of purchaseOrders) {
      for (const line of po.lines) {
        const category = line.categoryId ? catMap.get(line.categoryId) : '—';
        const metal = line.metalTypeId ? metalMap.get(line.metalTypeId) : '—';

        sheet.addRow({
          poNumber: po.id,
          supplier: po.supplier.name,
          status: po.status,
          purchaseDate: po.purchaseDate,
          description: line.description,
          category: category || '—',
          metal: metal || '—',
          karat: line.karat !== null ? `${line.karat}K` : '—',
          grossWeight: Number(line.grossWeightGram),
          price: Number(line.priceNpr),
          rateAtPurchase: line.rateAtPurchasePerGram ? Number(line.rateAtPurchasePerGram) : '—',
          createdBy: po.createdBy.name,
        });
      }
    }

    this.formatWorksheet(sheet, '6A1B9A'); // Purple for purchases

    const dateStr = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=purchase-export-${dateStr}.xlsx`);
    await workbook.xlsx.write(res);
    res.end();
  }

  async downloadStockTemplate(res: Response) {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('Stock Import Template');

    sheet.columns = [
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

    // Example grayed-out row
    const exampleRow = sheet.addRow({
      name: 'Example Gold Ring',
      category: 'Ring',
      metal: 'Gold',
      karat: 22,
      grossWeightGram: 5.5,
      grossWeightTola: '',
      jertyGram: 0.2,
      totalJyalaNpr: 1500,
      notes: 'Imported via template (will be skipped during import)',
    });

    exampleRow.eachCell((cell) => {
      cell.font = { italic: true, color: { argb: 'FF888888' } };
    });

    this.formatWorksheet(sheet, '757575'); // Dark Gray for templates

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=stock-import-template.xlsx');
    await workbook.xlsx.write(res);
    res.end();
  }

  async downloadPurchaseTemplate(res: Response) {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('PO Import Template');

    sheet.columns = [
      { header: 'Supplier Name', key: 'supplierName' },
      { header: 'Item Description', key: 'description' },
      { header: 'Category', key: 'category' },
      { header: 'Metal', key: 'metal' },
      { header: 'Karat', key: 'karat' },
      { header: 'Gross Weight (g)', key: 'grossWeight' },
      { header: 'Estimated Price (NPR)', key: 'price' },
    ];

    // Example grayed-out row
    const exampleRow = sheet.addRow({
      supplierName: 'Example Supplier Ltd',
      description: 'Gold Necklace',
      category: 'Necklace',
      metal: 'Gold',
      karat: 22,
      grossWeight: 15.0,
      price: 180000,
    });

    exampleRow.eachCell((cell) => {
      cell.font = { italic: true, color: { argb: 'FF888888' } };
    });

    this.formatWorksheet(sheet, '757575');

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=purchase-import-template.xlsx');
    await workbook.xlsx.write(res);
    res.end();
  }
}
