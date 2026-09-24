import { Injectable } from '@nestjs/common';

import { InjectRepository } from '@nestjs/typeorm';

import { Repository, Between, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';
import { FinancialSummaryQueryDto } from './dto/financial-summary-query.dto.js';
import { Order, OrderStatus } from '../orders/entities/order.entity.js';
import { Supplier } from '../suppliers/entities/supplier.entity.js';
import { Payment } from '../payments/entities/payments.entity.js';

import {
  Purchase,
  PurchasePaymentStatus,
} from '../purchases/entities/purchase.entity.js';
import { Customer } from '../customers/entities/customer.entity.js';

import { Expense } from '../expenses/entities/expense.entity.js';
import { Product } from '../products/entities/product.entity.js';
import { SupplierPayment } from '../supplier-payments/entities/supplier-payment.entity.js';

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
  ) {}

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
}
