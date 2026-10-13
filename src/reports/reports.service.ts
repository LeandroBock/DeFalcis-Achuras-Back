import { Injectable } from '@nestjs/common';

import { InjectRepository } from '@nestjs/typeorm';

import { Repository, SelectQueryBuilder, ObjectLiteral } from 'typeorm';
import { FinancialSummaryQueryDto } from './dto/financial-summary-query.dto.js';
import { Order, OrderStatus } from '../orders/entities/order.entity.js';
import { Supplier } from '../suppliers/entities/supplier.entity.js';
import { Payment } from '../payments/entities/payments.entity.js';
import { OrderItem } from '../order-items/entities/order-item.entity.js';
import { ExpenseCategory } from '../expenses/entities/expense.entity.js';
import {
  Purchase,
  PurchasePaymentStatus,
} from '../purchases/entities/purchase.entity.js';
import { Customer } from '../customers/entities/customer.entity.js';
import ExcelJS from 'exceljs';
import { Expense } from '../expenses/entities/expense.entity.js';
import { Product } from '../products/entities/product.entity.js';
import { SupplierPayment } from '../supplier-payments/entities/supplier-payment.entity.js';

const SOLD_STATUSES = [OrderStatus.CONFIRMED, OrderStatus.DELIVERED];

const OPEN_PURCHASE_STATUSES = [
  PurchasePaymentStatus.PENDING,
  PurchasePaymentStatus.PARTIAL,
];

type DateRange = { start?: Date; end?: Date };

// Los montos `numeric` de Postgres llegan como string.
const money = (value: unknown) => Number(Number(value ?? 0).toFixed(2));

const PAYMENT_STATUS_LABEL: Record<string, string> = {
  pending: 'Pendiente',
  partial: 'Parcial',
  paid: 'Pagado',
  cancelled: 'Cancelado',
};

const METHOD_LABEL: Record<string, string> = {
  cash: 'Efectivo',
  transfer: 'Transferencia',
  mercado_pago: 'Mercado Pago',
  credit: 'Crédito',
  supplier_credit: 'Saldo a favor',
};

const EXPENSE_CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  rent: 'Alquiler',
  utilities: 'Servicios',
  fuel: 'Combustible',
  salaries: 'Sueldos',
  taxes: 'Impuestos',
  maintenance: 'Mantenimiento',
  administrative: 'Administrativo',
  other: 'Otros',
};

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(Order)
    private readonly ordersRepository: Repository<Order>,

    @InjectRepository(Payment)
    private readonly paymentsRepository: Repository<Payment>,

    @InjectRepository(Purchase)
    private readonly purchasesRepository: Repository<Purchase>,

    @InjectRepository(Expense)
    private readonly expensesRepository: Repository<Expense>,

    @InjectRepository(Product)
    private readonly productsRepository: Repository<Product>,

    @InjectRepository(OrderItem)
    private readonly orderItemsRepository: Repository<OrderItem>,
  ) {}

  private addTableSheet(
    workbook: ExcelJS.Workbook,
    name: string,
    columns: { header: string; key: string; width: number }[],
    rows: Record<string, unknown>[],
    opts: {
      money?: string[];
      date?: string[];
      percent?: string[];
      totals?: string[];
    } = {},
  ) {
    const sheet = workbook.addWorksheet(name);
    sheet.columns = columns;

    const header = sheet.getRow(1);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF111827' },
    };

    rows.forEach((r) => sheet.addRow(r));

    opts.money?.forEach((k) => (sheet.getColumn(k).numFmt = '"$"#,##0.00'));
    opts.date?.forEach((k) => (sheet.getColumn(k).numFmt = 'dd/mm/yyyy'));
    opts.percent?.forEach((k) => (sheet.getColumn(k).numFmt = '0.0%'));

    if (rows.length > 0 && opts.totals?.length) {
      const last = rows.length + 1;
      const totalRow = sheet.addRow({});
      totalRow.getCell(1).value = 'TOTAL';

      opts.totals.forEach((key) => {
        const col = sheet.getColumn(key);
        totalRow.getCell(col.number).value = {
          formula: `SUM(${col.letter}2:${col.letter}${last})`,
        };
      });
      totalRow.font = { bold: true };
    }

    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: columns.length },
    };

    return sheet;
  }

  // Todos los totales se calculan en Postgres (SUM / GROUP BY): no se traen
  // tablas enteras a memoria.

  async getFinancialSummary(query: FinancialSummaryQueryDto) {
    const { from, to } = query;

    const totals = await this.getFinancialTotals(this.buildDateRange(from, to));

    return {
      from: from ?? null,
      to: to ?? null,
      ...totals,
    };
  }

  async getDashboard() {
    const [financial, inventory, receivables, payables] = await Promise.all([
      this.getFinancialTotals({}),

      this.productsRepository
        .createQueryBuilder('product')
        .select('COUNT(*)', 'totalProducts')
        .addSelect(
          'COUNT(*) FILTER (WHERE product.stock <= 0)',
          'productsWithoutStock',
        )
        .addSelect(
          'COUNT(*) FILTER (WHERE product.stock > 0 AND product.stock <= 5)',
          'productsWithLowStock',
        )
        .where('product.isActive = true')
        .getRawOne(),

      this.receivablesQuery({})
        .select('COALESCE(SUM(o.total - COALESCE(pay.paid, 0)), 0)', 'pending')
        .getRawOne(),

      this.payablesQuery({})
        .select('COALESCE(SUM(p.total - COALESCE(pay.paid, 0)), 0)', 'pending')
        .getRawOne(),
    ]);

    return {
      financial,

      inventory: {
        totalProducts: Number(inventory.totalProducts),
        productsWithoutStock: Number(inventory.productsWithoutStock),
        productsWithLowStock: Number(inventory.productsWithLowStock),
      },

      receivables: {
        pending: money(receivables.pending),
      },

      payables: {
        pending: money(payables.pending),
      },
    };
  }

  async getReceivables(query: FinancialSummaryQueryDto) {
    const rows = await this.receivablesQuery(
      this.buildDateRange(query.from, query.to),
    )
      .leftJoin(Customer, 'c', 'c.id = o.customerId')
      .select('o.customerId', 'customerId')
      .addSelect('c.name', 'customerName')
      .addSelect('o.id', 'orderId')
      .addSelect('o.createdAt', 'orderDate')
      .addSelect('o.total', 'total')
      .addSelect('COALESCE(pay.paid, 0)', 'paid')
      .addSelect('o.paymentStatus', 'paymentStatus')
      .orderBy('o.createdAt', 'DESC')
      .getRawMany();

    return rows.map((row) => ({
      customerId: row.customerId,
      customerName: row.customerName ?? 'Cliente desconocido',
      orderId: row.orderId,
      orderDate: row.orderDate,
      total: money(row.total),
      paid: money(row.paid),
      pending: money(row.total - row.paid),
      paymentStatus: row.paymentStatus,
    }));
  }

  async getPayables(query: FinancialSummaryQueryDto) {
    const rows = await this.payablesQuery(
      this.buildDateRange(query.from, query.to),
    )
      .leftJoin(Supplier, 's', 's.id = p.supplierId')
      .select('p.supplierId', 'supplierId')
      .addSelect('s.name', 'supplierName')
      .addSelect('p.id', 'purchaseId')
      .addSelect('p.createdAt', 'purchaseDate')
      .addSelect('p.total', 'total')
      .addSelect('COALESCE(pay.paid, 0)', 'paid')
      .addSelect('p.paymentStatus', 'paymentStatus')
      .orderBy('p.createdAt', 'DESC')
      .getRawMany();

    return rows.map((row) => ({
      supplierId: row.supplierId,
      supplierName: row.supplierName ?? 'Proveedor desconocido',

      purchaseId: row.purchaseId,
      purchaseDate: row.purchaseDate,

      total: money(row.total),
      paid: money(row.paid),
      pending: money(row.total - row.paid),

      paymentStatus: row.paymentStatus,
    }));
  }

  private async getFinancialTotals(range: DateRange) {
    const sum = <T extends ObjectLiteral>(
      repository: Repository<T>,
      column: string,
      where?: (qb: SelectQueryBuilder<T>) => SelectQueryBuilder<T>,
    ) => {
      let qb = repository
        .createQueryBuilder('t')
        .select(`COALESCE(SUM(t.${column}), 0)`, 'total');

      qb = this.applyDateRange(qb, 't', range);

      return (where ? where(qb) : qb)
        .getRawOne()
        .then((row) => money(row.total));
    };

    const [totalSales, totalCollected, totalPurchases, totalExpenses] =
      await Promise.all([
        sum(this.ordersRepository, 'total', (qb) =>
          qb.andWhere('t.status IN (:...sold)', { sold: SOLD_STATUSES }),
        ),

        sum(this.paymentsRepository, 'amount'),

        // Las compras anuladas no cuentan como egreso.
        sum(this.purchasesRepository, 'total', (qb) =>
          qb.andWhere('t.paymentStatus <> :cancelled', {
            cancelled: PurchasePaymentStatus.CANCELLED,
          }),
        ),

        sum(this.expensesRepository, 'amount'),
      ]);

    return {
      totalSales,
      totalCollected,
      totalPurchases,
      totalExpenses,
      estimatedResult: money(totalCollected - totalPurchases - totalExpenses),
    };
  }

  // Ventas con saldo pendiente de cobro, con lo pagado sumado por pedido.
  private receivablesQuery(range: DateRange) {
    const qb = this.ordersRepository
      .createQueryBuilder('o')
      .leftJoin(
        (sub) =>
          sub
            .select('payment.orderId', 'orderId')
            .addSelect('SUM(payment.amount)', 'paid')
            .from(Payment, 'payment')
            .groupBy('payment.orderId'),
        'pay',
        'pay."orderId" = o.id',
      )
      .where('o.status IN (:...sold)', { sold: SOLD_STATUSES })
      .andWhere('o.total - COALESCE(pay.paid, 0) > 0');

    return this.applyDateRange(qb, 'o', range);
  }

  // Compras pendientes o parciales con saldo por pagar.
  private payablesQuery(range: DateRange) {
    const qb = this.purchasesRepository
      .createQueryBuilder('p')
      .leftJoin(
        (sub) =>
          sub
            .select('payment.purchaseId', 'purchaseId')
            .addSelect('SUM(payment.amount)', 'paid')
            .from(SupplierPayment, 'payment')
            .groupBy('payment.purchaseId'),
        'pay',
        'pay."purchaseId" = p.id',
      )
      .where('p.paymentStatus IN (:...open)', { open: OPEN_PURCHASE_STATUSES })
      .andWhere('p.total - COALESCE(pay.paid, 0) > 0');

    return this.applyDateRange(qb, 'p', range);
  }

  private buildDateRange(from?: string, to?: string): DateRange {
    return {
      start: from ? new Date(`${from}T00:00:00`) : undefined,
      end: to ? new Date(`${to}T23:59:59.999`) : undefined,
    };
  }

  private applyDateRange<T extends ObjectLiteral>(
    qb: SelectQueryBuilder<T>,
    alias: string,
    range: DateRange,
  ) {
    if (range.start) {
      qb.andWhere(`${alias}.createdAt >= :start`, { start: range.start });
    }

    if (range.end) {
      qb.andWhere(`${alias}.createdAt <= :end`, { end: range.end });
    }

    return qb;
  }

  async exportToExcel(query: FinancialSummaryQueryDto): Promise<Buffer> {
    const [summary, receivables, payables] = await Promise.all([
      this.getFinancialSummary(query),
      this.getReceivables(query),
      this.getPayables(query),
    ]);

    const MONEY = '"$"#,##0.00';
    const DATE = 'dd/mm/yyyy';

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'DF Achuras';
    workbook.created = new Date();

    const styleHeader = (row: ExcelJS.Row) => {
      row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      row.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF111827' },
      };
      row.alignment = { vertical: 'middle' };
    };

    // ---------- Hoja 1: Resumen ----------
    const resumen = workbook.addWorksheet('Resumen');
    resumen.columns = [
      { header: 'Concepto', key: 'concept', width: 28 },
      { header: 'Monto', key: 'amount', width: 20 },
    ];
    styleHeader(resumen.getRow(1));

    resumen.addRow({
      concept: 'Período',
      amount: `${summary.from ?? 'inicio'} a ${summary.to ?? 'hoy'}`,
    });
    resumen.addRow({
      concept: 'Ventas confirmadas',
      amount: summary.totalSales,
    });
    resumen.addRow({ concept: 'Cobrado', amount: summary.totalCollected });
    resumen.addRow({ concept: 'Compras', amount: summary.totalPurchases });
    resumen.addRow({ concept: 'Gastos', amount: summary.totalExpenses });

    // Filas: 2 período, 3 ventas, 4 cobrado, 5 compras, 6 gastos
    const resultRow = resumen.addRow({
      concept: 'Resultado estimado (cobrado − compras − gastos)',
      amount: {
        formula: 'B4-B5-B6',
        result: summary.estimatedResult,
      },
    });
    resultRow.font = { bold: true };

    resumen.addRow({});
    resumen.addRow({
      concept: 'Cuentas por cobrar (pendiente)',
      amount: { formula: "SUM('Por cobrar'!F:F)" },
    });
    resumen.addRow({
      concept: 'Cuentas por pagar (pendiente)',
      amount: { formula: "SUM('Por pagar'!F:F)" },
    });

    resumen.getColumn('amount').numFmt = MONEY;
    resumen.getColumn('amount').alignment = { horizontal: 'right' };
    resumen.getCell('B2').numFmt = '@'; // el período es texto

    // ---------- Hoja 2: Por cobrar ----------
    const porCobrar = workbook.addWorksheet('Por cobrar');
    porCobrar.columns = [
      { header: 'Cliente', key: 'customerName', width: 30 },
      { header: 'N° venta', key: 'orderId', width: 12 },
      { header: 'Fecha', key: 'orderDate', width: 14 },
      { header: 'Total', key: 'total', width: 16 },
      { header: 'Pagado', key: 'paid', width: 16 },
      { header: 'Pendiente', key: 'pending', width: 16 },
      { header: 'Estado de pago', key: 'paymentStatus', width: 18 },
    ];
    styleHeader(porCobrar.getRow(1));

    receivables.forEach((r) =>
      porCobrar.addRow({
        ...r,
        orderId: r.orderId.slice(0, 8),
        orderDate: new Date(r.orderDate),
      }),
    );

    porCobrar.getColumn('orderDate').numFmt = DATE;
    ['total', 'paid', 'pending'].forEach(
      (k) => (porCobrar.getColumn(k).numFmt = MONEY),
    );

    if (receivables.length > 0) {
      const last = receivables.length + 1;
      const totalRow = porCobrar.addRow({
        customerName: 'TOTAL',
        total: { formula: `SUM(D2:D${last})` },
        paid: { formula: `SUM(E2:E${last})` },
        pending: { formula: `SUM(F2:F${last})` },
      });
      totalRow.font = { bold: true };
    }
    porCobrar.views = [{ state: 'frozen', ySplit: 1 }];
    porCobrar.autoFilter = 'A1:G1';

    // ---------- Hoja 3: Por pagar ----------
    const porPagar = workbook.addWorksheet('Por pagar');
    porPagar.columns = [
      { header: 'Proveedor', key: 'supplierName', width: 30 },
      { header: 'N° compra', key: 'purchaseId', width: 12 },
      { header: 'Fecha', key: 'purchaseDate', width: 14 },
      { header: 'Total', key: 'total', width: 16 },
      { header: 'Pagado', key: 'paid', width: 16 },
      { header: 'Pendiente', key: 'pending', width: 16 },
      { header: 'Estado de pago', key: 'paymentStatus', width: 18 },
    ];
    styleHeader(porPagar.getRow(1));

    payables.forEach((p) =>
      porPagar.addRow({
        ...p,
        purchaseId: p.purchaseId.slice(0, 8),
        purchaseDate: new Date(p.purchaseDate),
      }),
    );

    porPagar.getColumn('purchaseDate').numFmt = DATE;
    ['total', 'paid', 'pending'].forEach(
      (k) => (porPagar.getColumn(k).numFmt = MONEY),
    );

    if (payables.length > 0) {
      const last = payables.length + 1;
      const totalRow = porPagar.addRow({
        supplierName: 'TOTAL',
        total: { formula: `SUM(D2:D${last})` },
        paid: { formula: `SUM(E2:E${last})` },
        pending: { formula: `SUM(F2:F${last})` },
      });
      totalRow.font = { bold: true };
    }
    porPagar.views = [{ state: 'frozen', ySplit: 1 }];
    porPagar.autoFilter = 'A1:G1';

    // ---------- Datos para las hojas extra ----------
    const range = this.buildDateRange(query.from, query.to);

    const [products, saleItems, purchases, expenses] = await Promise.all([
      this.productsRepository.find({ order: { name: 'ASC' } }),

      // Un renglón por producto vendido, con su pedido, cliente y producto.
      this.applyDateRange(
        this.orderItemsRepository
          .createQueryBuilder('item')
          .innerJoin(Order, 'o', 'o.id = item.orderId')
          .leftJoin(Customer, 'c', 'c.id = o.customerId')
          .leftJoin(Product, 'product', 'product.id = item.productId')
          .select('o.id', 'orderId')
          .addSelect('o.createdAt', 'date')
          .addSelect('o.paymentStatus', 'paymentStatus')
          .addSelect('c.name', 'customerName')
          .addSelect('product.name', 'productName')
          .addSelect('product.unit', 'unit')
          .addSelect('product.costPrice', 'costPrice')
          .addSelect('item.quantity', 'quantity')
          .addSelect('item.unitPrice', 'unitPrice')
          .addSelect('item.subtotal', 'subtotal')
          .where('o.status IN (:...sold)', { sold: SOLD_STATUSES }),
        'o',
        range,
      )
        // Dentro de un mismo pedido, los productos en el orden en que se cargaron.
        .orderBy('o.createdAt', 'DESC')
        .addOrderBy('item.createdAt', 'ASC')
        .addOrderBy('item.id', 'ASC')
        .getRawMany(),

      this.applyDateRange(
        this.purchasesRepository
          .createQueryBuilder('p')
          .leftJoin(Supplier, 's', 's.id = p.supplierId')
          .select('p.id', 'id')
          .addSelect('p.createdAt', 'createdAt')
          .addSelect('p.paymentMethod', 'paymentMethod')
          .addSelect('p.paymentStatus', 'paymentStatus')
          .addSelect('p.total', 'total')
          .addSelect('s.name', 'supplierName')
          .where('p.paymentStatus <> :cancelled', {
            cancelled: PurchasePaymentStatus.CANCELLED,
          }),
        'p',
        range,
      )
        .orderBy('p.createdAt', 'DESC')
        .getRawMany(),

      this.applyDateRange(
        this.expensesRepository.createQueryBuilder('e'),
        'e',
        range,
      )
        .orderBy('e.createdAt', 'DESC')
        .getMany(),
    ]);

    // ---------- Hoja: Inventario ----------
    // A nombre, B categoría, C unidad, D stock, E costo, F precio venta,
    // G margen, H valor en stock, I estado
    this.addTableSheet(
      workbook,
      'Inventario',
      [
        { header: 'Producto', key: 'name', width: 30 },
        { header: 'Categoría', key: 'category', width: 18 },
        { header: 'Unidad', key: 'unit', width: 10 },
        { header: 'Stock', key: 'stock', width: 12 },
        { header: 'Costo', key: 'costPrice', width: 14 },
        { header: 'Precio venta', key: 'salePrice', width: 14 },
        { header: 'Margen s/ precio', key: 'margin', width: 16 },
        { header: 'Valor en stock', key: 'stockValue', width: 16 },
        { header: 'Estado', key: 'status', width: 14 },
      ],
      products.map((p, i) => {
        const row = i + 2;
        const stock = Number(p.stock);

        return {
          name: p.name,
          category: p.category,
          unit: p.unit === 'kg' ? 'kg' : 'unidad',
          stock,
          costPrice: Number(p.costPrice),
          salePrice: Number(p.salePrice),
          margin: { formula: `IF(F${row}=0,0,(F${row}-E${row})/F${row})` },
          stockValue: { formula: `D${row}*E${row}` },
          status: !p.isActive
            ? 'Inactivo'
            : stock <= 0
              ? 'Sin stock'
              : stock <= 5
                ? 'Stock bajo'
                : 'OK',
        };
      }),
      {
        money: ['costPrice', 'salePrice', 'stockValue'],
        percent: ['margin'],
        totals: ['stockValue'],
      },
    );

    // ---------- Hoja: Ventas (detalle por producto) ----------
    // A fecha, B N° venta, C cliente, D producto, E cantidad, F unidad,
    // G precio unit., H subtotal, I costo unit., J ganancia est., K estado pago
    const salesRows = saleItems.map((item, i) => {
      const row = i + 2;

      return {
        date: item.date,
        orderId: item.orderId.slice(0, 8),
        customer: item.customerName ?? 'Cliente desconocido',
        product: item.productName ?? 'Producto eliminado',
        quantity: Number(item.quantity),
        unit: item.unit === 'kg' ? 'kg' : 'unidad',
        unitPrice: Number(item.unitPrice),
        subtotal: Number(item.subtotal),
        unitCost: Number(item.costPrice ?? 0),
        profit: { formula: `H${row}-E${row}*I${row}` },
        paymentStatus:
          PAYMENT_STATUS_LABEL[item.paymentStatus] ?? item.paymentStatus,
      };
    });

    this.addTableSheet(
      workbook,
      'Ventas',
      [
        { header: 'Fecha', key: 'date', width: 14 },
        { header: 'N° venta', key: 'orderId', width: 12 },
        { header: 'Cliente', key: 'customer', width: 28 },
        { header: 'Producto', key: 'product', width: 28 },
        { header: 'Cantidad', key: 'quantity', width: 12 },
        { header: 'Unidad', key: 'unit', width: 10 },
        { header: 'Precio unit.', key: 'unitPrice', width: 14 },
        { header: 'Subtotal', key: 'subtotal', width: 16 },
        { header: 'Costo unit. actual', key: 'unitCost', width: 18 },
        { header: 'Ganancia estimada', key: 'profit', width: 18 },
        { header: 'Estado de pago', key: 'paymentStatus', width: 16 },
      ],
      salesRows,
      {
        date: ['date'],
        money: ['unitPrice', 'subtotal', 'unitCost', 'profit'],
        totals: ['subtotal', 'profit'],
      },
    );

    // ---------- Hoja: Compras ----------
    this.addTableSheet(
      workbook,
      'Compras',
      [
        { header: 'Fecha', key: 'date', width: 14 },
        { header: 'N° compra', key: 'purchaseId', width: 12 },
        { header: 'Proveedor', key: 'supplier', width: 28 },
        { header: 'Método', key: 'method', width: 16 },
        { header: 'Estado de pago', key: 'status', width: 16 },
        { header: 'Total', key: 'total', width: 16 },
      ],
      purchases.map((p) => ({
        date: p.createdAt,
        purchaseId: p.id.slice(0, 8),
        supplier: p.supplierName ?? 'Proveedor desconocido',
        method: METHOD_LABEL[p.paymentMethod] ?? p.paymentMethod,
        status: PAYMENT_STATUS_LABEL[p.paymentStatus] ?? p.paymentStatus,
        total: Number(p.total),
      })),
      { date: ['date'], money: ['total'], totals: ['total'] },
    );

    // ---------- Hoja: Gastos ----------
    this.addTableSheet(
      workbook,
      'Gastos',
      [
        { header: 'Fecha', key: 'date', width: 14 },
        { header: 'Categoría', key: 'category', width: 18 },
        { header: 'Descripción', key: 'description', width: 36 },
        { header: 'Método', key: 'method', width: 16 },
        { header: 'Monto', key: 'amount', width: 16 },
        { header: 'Notas', key: 'notes', width: 30 },
      ],
      expenses.map((e) => ({
        date: e.createdAt,
        category: EXPENSE_CATEGORY_LABEL[e.category] ?? e.category,
        description: e.description,
        method: METHOD_LABEL[e.paymentMethod] ?? e.paymentMethod,
        amount: Number(e.amount),
        notes: e.notes ?? '',
      })),
      { date: ['date'], money: ['amount'], totals: ['amount'] },
    );

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer);
  }
}
