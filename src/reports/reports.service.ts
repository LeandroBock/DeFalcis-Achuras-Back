import { Injectable } from '@nestjs/common';

import { InjectRepository } from '@nestjs/typeorm';

import {
  Repository,
  Between,
  LessThanOrEqual,
  MoreThanOrEqual,
  In,
} from 'typeorm';
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

    @InjectRepository(SupplierPayment)
    private readonly supplierPaymentsRepository: Repository<SupplierPayment>,

    @InjectRepository(Customer)
    private readonly customersRepository: Repository<Customer>,

    @InjectRepository(Supplier)
    private readonly suppliersRepository: Repository<Supplier>,

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

  async getFinancialSummary(query: FinancialSummaryQueryDto) {
    const { from, to } = query;

    const dateFilter = this.buildDateFilter(from, to);

    const orders = await this.ordersRepository.find({
      where: {
        status: OrderStatus.CONFIRMED,
        ...(dateFilter && {
          createdAt: dateFilter,
        }),
      },
    });

    const payments = await this.paymentsRepository.find({
      where: dateFilter ? { createdAt: dateFilter } : {},
    });

    const purchases = await this.purchasesRepository.find({
      where: dateFilter ? { createdAt: dateFilter } : {},
    });

    const expenses = await this.expensesRepository.find({
      where: dateFilter ? { createdAt: dateFilter } : {},
    });

    const totalSales = orders.reduce(
      (sum, order) => sum + Number(order.total),
      0,
    );

    const totalCollected = payments.reduce(
      (sum, payment) => sum + Number(payment.amount),
      0,
    );

    const totalPurchases = purchases.reduce(
      (sum, purchase) => sum + Number(purchase.total),
      0,
    );

    const totalExpenses = expenses.reduce(
      (sum, expense) => sum + Number(expense.amount),
      0,
    );

    const estimatedResult = totalCollected - totalPurchases - totalExpenses;

    return {
      from: from ?? null,
      to: to ?? null,

      totalSales: Number(totalSales.toFixed(2)),

      totalCollected: Number(totalCollected.toFixed(2)),

      totalPurchases: Number(totalPurchases.toFixed(2)),

      totalExpenses: Number(totalExpenses.toFixed(2)),

      estimatedResult: Number(estimatedResult.toFixed(2)),
    };
  }

  async getDashboard() {
    const [products, orders, payments, purchases, supplierPayments, expenses] =
      await Promise.all([
        this.productsRepository.find({
          where: {
            isActive: true,
          },
        }),

        this.ordersRepository.find({
          where: {
            status: OrderStatus.CONFIRMED,
          },
        }),

        this.paymentsRepository.find(),

        this.purchasesRepository.find(),

        this.supplierPaymentsRepository.find(),

        this.expensesRepository.find(),
      ]);

    const totalSales = orders.reduce(
      (sum, order) => sum + Number(order.total),
      0,
    );

    const totalCollected = payments.reduce(
      (sum, payment) => sum + Number(payment.amount),
      0,
    );

    const totalPurchases = purchases.reduce(
      (sum, purchase) => sum + Number(purchase.total),
      0,
    );

    const totalSupplierPayments = supplierPayments.reduce(
      (sum, payment) => sum + Number(payment.amount),
      0,
    );

    const totalExpenses = expenses.reduce(
      (sum, expense) => sum + Number(expense.amount),
      0,
    );

    const productsWithoutStock = products.filter(
      (product) => Number(product.stock) <= 0,
    );

    const productsWithLowStock = products.filter(
      (product) => Number(product.stock) > 0 && Number(product.stock) <= 5,
    );

    const pendingReceivable = orders.reduce((sum, order) => {
      const paid = payments
        .filter((payment) => payment.orderId === order.id)
        .reduce(
          (paymentSum, payment) => paymentSum + Number(payment.amount),
          0,
        );

      const pending = Number(order.total) - paid;

      return sum + Math.max(pending, 0);
    }, 0);

    const pendingPayable = purchases
      .filter(
        (purchase) =>
          purchase.paymentStatus === PurchasePaymentStatus.PENDING ||
          purchase.paymentStatus === PurchasePaymentStatus.PARTIAL,
      )
      .reduce((sum, purchase) => {
        const paid = supplierPayments
          .filter((payment) => payment.purchaseId === purchase.id)
          .reduce(
            (paymentSum, payment) => paymentSum + Number(payment.amount),
            0,
          );

        const pending = Number(purchase.total) - paid;

        return sum + Math.max(pending, 0);
      }, 0);

    const estimatedResult = totalCollected - totalPurchases - totalExpenses;

    return {
      financial: {
        totalSales: Number(totalSales.toFixed(2)),
        totalCollected: Number(totalCollected.toFixed(2)),
        totalPurchases: Number(totalPurchases.toFixed(2)),
        totalExpenses: Number(totalExpenses.toFixed(2)),
        estimatedResult: Number(estimatedResult.toFixed(2)),
      },

      inventory: {
        totalProducts: products.length,
        productsWithoutStock: productsWithoutStock.length,
        productsWithLowStock: productsWithLowStock.length,
      },

      receivables: {
        pending: Number(pendingReceivable.toFixed(2)),
      },

      payables: {
        pending: Number(pendingPayable.toFixed(2)),
      },
    };
  }

  async getReceivables(query: FinancialSummaryQueryDto) {
    const { from, to } = query;
    const dateFilter = this.buildDateFilter(from, to);
    const [orders, payments, customers] = await Promise.all([
      this.ordersRepository.find({
        where: {
          status: OrderStatus.CONFIRMED,
          ...(dateFilter && {
            createdAt: dateFilter,
          }),
        },
        order: {
          createdAt: 'DESC',
        },
      }),

      this.paymentsRepository.find(),

      this.customersRepository.find(),
    ]);

    const receivables = orders
      .map((order) => {
        const customer = customers.find(
          (customer) => customer.id === order.customerId,
        );

        const paid = payments
          .filter((payment) => payment.orderId === order.id)
          .reduce((sum, payment) => sum + Number(payment.amount), 0);

        const total = Number(order.total);

        const pending = Math.max(total - paid, 0);

        return {
          customerId: order.customerId,
          customerName: customer?.name ?? 'Cliente desconocido',
          orderId: order.id,
          orderDate: order.createdAt,
          total: Number(total.toFixed(2)),
          paid: Number(paid.toFixed(2)),
          pending: Number(pending.toFixed(2)),
          paymentStatus: order.paymentStatus,
        };
      })
      .filter((order) => order.pending > 0);

    return receivables;
  }

  private buildDateFilter(from?: string, to?: string) {
    if (from && to) {
      const startDate = new Date(`${from}T00:00:00`);
      const endDate = new Date(`${to}T23:59:59.999`);

      return Between(startDate, endDate);
    }

    if (from) {
      return MoreThanOrEqual(new Date(`${from}T00:00:00`));
    }

    if (to) {
      return LessThanOrEqual(new Date(`${to}T23:59:59.999`));
    }

    return undefined;
  }

  async getPayables(query: FinancialSummaryQueryDto) {
    const { from, to } = query;
    const dateFilter = this.buildDateFilter(from, to);
    const [purchases, supplierPayments, suppliers] = await Promise.all([
      this.purchasesRepository.find({
        where: [
          {
            paymentStatus: PurchasePaymentStatus.PENDING,
            ...(dateFilter && {
              createdAt: dateFilter,
            }),
          },
          {
            paymentStatus: PurchasePaymentStatus.PARTIAL,
            ...(dateFilter && {
              createdAt: dateFilter,
            }),
          },
        ],
        order: {
          createdAt: 'DESC',
        },
      }),

      this.supplierPaymentsRepository.find(),

      this.suppliersRepository.find(),
    ]);

    const payables = purchases
      .map((purchase) => {
        const supplier = suppliers.find(
          (supplier) => supplier.id === purchase.supplierId,
        );

        const paid = supplierPayments
          .filter((payment) => payment.purchaseId === purchase.id)
          .reduce((sum, payment) => sum + Number(payment.amount), 0);

        const total = Number(purchase.total);
        const pending = Math.max(total - paid, 0);

        return {
          supplierId: purchase.supplierId,
          supplierName: supplier?.name ?? 'Proveedor desconocido',

          purchaseId: purchase.id,
          purchaseDate: purchase.createdAt,

          total: Number(total.toFixed(2)),
          paid: Number(paid.toFixed(2)),
          pending: Number(pending.toFixed(2)),

          paymentStatus: purchase.paymentStatus,
        };
      })
      .filter((purchase) => purchase.pending > 0);

    return payables;
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
    const dateFilter = this.buildDateFilter(query.from, query.to);
    const createdAtWhere = dateFilter ? { createdAt: dateFilter } : {};

    const [products, orders, purchases, expenses, customers, suppliers] =
      await Promise.all([
        this.productsRepository.find({ order: { name: 'ASC' } }),
        this.ordersRepository.find({
          where: { status: In(SOLD_STATUSES), ...createdAtWhere },
        }),
        this.purchasesRepository.find({
          where: createdAtWhere,
          order: { createdAt: 'DESC' },
        }),
        this.expensesRepository.find({
          where: createdAtWhere,
          order: { createdAt: 'DESC' },
        }),
        this.customersRepository.find(),
        this.suppliersRepository.find(),
      ]);

    const orderItems = orders.length
      ? await this.orderItemsRepository.find({
          where: { orderId: In(orders.map((o) => o.id)) },
        })
      : [];

    const productById = new Map(products.map((p) => [p.id, p]));
    const customerById = new Map(customers.map((c) => [c.id, c]));
    const supplierById = new Map(suppliers.map((s) => [s.id, s]));
    const orderById = new Map(orders.map((o) => [o.id, o]));

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
    const salesRows = orderItems
      .map((item) => ({ item, order: orderById.get(item.orderId)! }))
      .sort((a, b) => b.order.createdAt.getTime() - a.order.createdAt.getTime())
      .map(({ item, order }, i) => {
        const row = i + 2;
        const product = productById.get(item.productId);

        return {
          date: order.createdAt,
          orderId: order.id.slice(0, 8),
          customer:
            customerById.get(order.customerId)?.name ?? 'Cliente desconocido',
          product: product?.name ?? 'Producto eliminado',
          quantity: Number(item.quantity),
          unit: product?.unit === 'kg' ? 'kg' : 'unidad',
          unitPrice: Number(item.unitPrice),
          subtotal: Number(item.subtotal),
          unitCost: Number(product?.costPrice ?? 0),
          profit: { formula: `H${row}-E${row}*I${row}` },
          paymentStatus:
            PAYMENT_STATUS_LABEL[order.paymentStatus] ?? order.paymentStatus,
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
      purchases
        .filter((p) => p.paymentStatus !== PurchasePaymentStatus.CANCELLED)
        .map((p) => ({
          date: p.createdAt,
          purchaseId: p.id.slice(0, 8),
          supplier:
            supplierById.get(p.supplierId)?.name ?? 'Proveedor desconocido',
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
