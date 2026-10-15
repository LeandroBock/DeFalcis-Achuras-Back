import { BadRequestException } from '@nestjs/common';
import { EntityManager, In } from 'typeorm';

import {
  Order,
  OrderPaymentStatus,
  OrderStatus,
} from '../orders/entities/order.entity.js';
import { Payment, PaymentMethod } from './entities/payments.entity.js';

export interface PaymentLine {
  amount: number;
  method: PaymentMethod;
}

const toCents = (value: number | string) => Math.round(Number(value) * 100);

export function paymentStatusFor(paidCents: number, totalCents: number) {
  if (paidCents <= 0) return OrderPaymentStatus.PENDING;
  return paidCents < totalCents
    ? OrderPaymentStatus.PARTIAL
    : OrderPaymentStatus.PAID;
}

// Entregas del cliente con saldo pendiente (su cuenta corriente), de la más
// vieja a la más nueva, bloqueadas hasta el fin de la transacción.
export async function lockOpenOrders(
  manager: EntityManager,
  customerId: string,
) {
  const orders = await manager.getRepository(Order).find({
    where: {
      customerId,
      status: OrderStatus.DELIVERED,
      paymentStatus: In([
        OrderPaymentStatus.PENDING,
        OrderPaymentStatus.PARTIAL,
      ]),
    },
    order: { deliveredAt: 'ASC', createdAt: 'ASC', id: 'ASC' },
    lock: { mode: 'pessimistic_write' },
  });

  const paid = await paidByOrder(
    manager,
    orders.map((order) => order.id),
  );

  return orders
    .map((order) => {
      const totalCents = toCents(order.total);
      const paidCents = paid.get(order.id) ?? 0;
      return {
        order,
        totalCents,
        paidCents,
        pendingCents: totalCents - paidCents,
      };
    })
    .filter((open) => open.pendingCents > 0);
}

export async function paidByOrder(manager: EntityManager, orderIds: string[]) {
  if (!orderIds.length) return new Map<string, number>();

  const rows: { orderId: string; paid: string }[] = await manager
    .getRepository(Payment)
    .createQueryBuilder('p')
    .select('p.orderId', 'orderId')
    .addSelect('SUM(p.amount)', 'paid')
    .where('p.orderId IN (:...orderIds)', { orderIds })
    .groupBy('p.orderId')
    .getRawMany();

  return new Map(rows.map((row) => [row.orderId, toCents(row.paid)]));
}

// Paga la cuenta corriente del cliente: cada cobro se aplica a las entregas
// adeudadas empezando por la más vieja.
export async function payOpenOrders(
  manager: EntityManager,
  customerId: string,
  lines: PaymentLine[],
  options: { collectedById?: string | null; notes: string },
) {
  const open = await lockOpenOrders(manager, customerId);
  const debtCents = open.reduce((sum, item) => sum + item.pendingCents, 0);
  const amountCents = lines.reduce(
    (sum, line) => sum + toCents(line.amount),
    0,
  );

  if (amountCents > debtCents) {
    throw new BadRequestException(
      `El pago ($${(amountCents / 100).toFixed(2)}) supera la deuda del cliente ($${(debtCents / 100).toFixed(2)})`,
    );
  }

  const paymentRepository = manager.getRepository(Payment);
  const payments: Payment[] = [];
  let index = 0;

  for (const line of lines) {
    let remaining = toCents(line.amount);

    while (remaining > 0) {
      const target = open[index];
      const cents = Math.min(remaining, target.pendingCents);

      payments.push(
        paymentRepository.create({
          orderId: target.order.id,
          amount: cents / 100,
          method: line.method,
          collectedById: options.collectedById ?? null,
          notes: options.notes,
        }),
      );

      target.paidCents += cents;
      target.pendingCents -= cents;
      remaining -= cents;
      if (target.pendingCents === 0) index++;
    }
  }

  const saved = await paymentRepository.save(payments);

  const touched = new Set(saved.map((payment) => payment.orderId));
  for (const item of open.filter((o) => touched.has(o.order.id))) {
    item.order.paymentStatus = paymentStatusFor(
      item.paidCents,
      item.totalCents,
    );
    await manager.getRepository(Order).save(item.order);
  }

  return {
    payments: saved,
    paid: amountCents / 100,
    remainingDebt: (debtCents - amountCents) / 100,
  };
}
