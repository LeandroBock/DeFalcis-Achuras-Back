import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { Customer } from './entities/customer.entity.js';
import { Order, OrderStatus } from '../orders/entities/order.entity.js';
import { Payment } from '../payments/entities/payments.entity.js';
import { payOpenOrders } from '../payments/open-orders.js';
import { PayCurrentAccountDto } from './dto/pay-current-account.dto.js';

const money = (value: number | string) => Number(Number(value).toFixed(2));

// Cuenta corriente: lo que cada cliente debe de sus entregas (total menos lo
// cobrado). Se paga aplicando el dinero a las entregas más viejas primero.
@Injectable()
export class CurrentAccountsService {
  constructor(
    @InjectRepository(Customer)
    private readonly customersRepository: Repository<Customer>,

    @InjectRepository(Order)
    private readonly ordersRepository: Repository<Order>,

    private readonly dataSource: DataSource,
  ) {}

  // Entregas con saldo pendiente, con lo cobrado de cada una.
  private openOrdersQuery() {
    return this.ordersRepository
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
      .where('o.status = :delivered', { delivered: OrderStatus.DELIVERED })
      .andWhere('o.total - COALESCE(pay.paid, 0) > 0');
  }

  // Clientes que deben, de mayor a menor deuda.
  async list() {
    const rows: {
      customerId: string;
      debt: string;
      openOrders: string;
      oldest: Date;
    }[] = await this.openOrdersQuery()
      .select('o.customerId', 'customerId')
      .addSelect('SUM(o.total - COALESCE(pay.paid, 0))', 'debt')
      .addSelect('COUNT(*)', 'openOrders')
      .addSelect('MIN(o.deliveredAt)', 'oldest')
      .groupBy('o.customerId')
      .getRawMany();

    if (!rows.length) return { totalDebt: 0, customers: [] };

    const customers = await this.customersRepository.findBy(
      rows.map((row) => ({ id: row.customerId })),
    );
    const byId = new Map(customers.map((c) => [c.id, c]));

    const list = rows
      .map((row) => {
        const customer = byId.get(row.customerId);
        return {
          customerId: row.customerId,
          name: customer?.name ?? 'Cliente eliminado',
          phone: customer?.phone ?? null,
          address: customer?.address ?? null,
          isActive: customer?.isActive ?? false,
          debt: money(row.debt),
          openOrders: Number(row.openOrders),
          oldestDebtAt: row.oldest,
        };
      })
      .sort((a, b) => b.debt - a.debt || a.name.localeCompare(b.name));

    return {
      totalDebt: money(list.reduce((sum, item) => sum + item.debt, 0)),
      customers: list,
    };
  }

  // Deuda de un cliente con el detalle de las entregas adeudadas.
  async detail(customerId: string) {
    const customer = await this.customersRepository.findOne({
      where: { id: customerId },
    });

    if (!customer) {
      throw new NotFoundException('Cliente no encontrado');
    }

    const rows: {
      id: string;
      deliveredAt: Date;
      total: string;
      paid: string | null;
    }[] = await this.openOrdersQuery()
      .select('o.id', 'id')
      .addSelect('o.deliveredAt', 'deliveredAt')
      .addSelect('o.total', 'total')
      .addSelect('COALESCE(pay.paid, 0)', 'paid')
      .andWhere('o.customerId = :customerId', { customerId })
      .orderBy('o.deliveredAt', 'ASC')
      .getRawMany();

    const orders = rows.map((row) => ({
      orderId: row.id,
      deliveredAt: row.deliveredAt,
      total: money(row.total),
      paid: money(row.paid ?? 0),
      pending: money(Number(row.total) - Number(row.paid ?? 0)),
    }));

    return {
      customer: {
        id: customer.id,
        name: customer.name,
        phone: customer.phone ?? null,
        address: customer.address ?? null,
      },
      debt: money(orders.reduce((sum, order) => sum + order.pending, 0)),
      orders,
    };
  }

  async pay(customerId: string, dto: PayCurrentAccountDto, userId: string) {
    const exists = await this.customersRepository.exists({
      where: { id: customerId },
    });

    if (!exists) {
      throw new NotFoundException('Cliente no encontrado');
    }

    const result = await this.dataSource.transaction((manager) =>
      payOpenOrders(
        manager,
        customerId,
        [{ amount: dto.amount, method: dto.method }],
        {
          collectedById: userId,
          notes: dto.notes?.trim()
            ? `Pago de cuenta corriente: ${dto.notes.trim()}`
            : 'Pago de cuenta corriente',
        },
      ),
    );

    return {
      paid: result.paid,
      remainingDebt: result.remainingDebt,
      payments: result.payments,
    };
  }
}
