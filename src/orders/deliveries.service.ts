import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { Customer } from '../customers/entities/customer.entity.js';
import { OrderItem } from '../order-items/entities/order-item.entity.js';
import { Payment } from '../payments/entities/payments.entity.js';
import { Product } from '../products/entities/product.entity.js';
import { User, UserRole } from '../users/entities/user.entity.js';

import { Order, OrderStatus } from './entities/order.entity.js';

// La empresa opera en Argentina (UTC-3, sin horario de verano): un "día" de
// rendición va de 00:00 a 24:00 hora argentina, sin importar la zona horaria
// del servidor.
const BUSINESS_UTC_OFFSET = '-03:00';

const money = (value: number) => Number(value.toFixed(2));
const kilos = (value: number) => Number(value.toFixed(3));

export function businessDayRange(date: string) {
  const start = new Date(`${date}T00:00:00${BUSINESS_UTC_OFFSET}`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

export function todayInBusinessTimezone(now = new Date()) {
  const local = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

@Injectable()
export class DeliveriesService {
  constructor(
    @InjectRepository(Order)
    private readonly ordersRepository: Repository<Order>,

    @InjectRepository(OrderItem)
    private readonly orderItemsRepository: Repository<OrderItem>,

    @InjectRepository(Customer)
    private readonly customersRepository: Repository<Customer>,

    @InjectRepository(Product)
    private readonly productsRepository: Repository<Product>,

    @InjectRepository(Payment)
    private readonly paymentsRepository: Repository<Payment>,

    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  // Usuarios a los que se les pueden asignar notas.
  async drivers() {
    return this.usersRepository.find({
      select: { id: true, name: true, email: true },
      where: { role: UserRole.REPARTO, isActive: true },
      order: { name: 'ASC' },
    });
  }

  // Notas pendientes asignadas al repartidor, con lo necesario para ir al
  // domicilio: cliente (dirección, teléfono) y productos. Con `date`, solo
  // las de ese día y las que no tienen fecha.
  async pendingFor(userId: string, date?: string) {
    const query = this.ordersRepository
      .createQueryBuilder('o')
      .where('o.assignedToId = :userId', { userId })
      .andWhere('o.status = :status', { status: OrderStatus.PENDING })
      .orderBy('o.deliveryDate', 'ASC', 'NULLS LAST')
      .addOrderBy('o.createdAt', 'ASC');

    if (date) {
      query.andWhere('(o.deliveryDate = :date OR o.deliveryDate IS NULL)', {
        date,
      });
    }

    const orders = await query.getMany();

    return this.withDetails(orders);
  }

  // Rendición de un repartidor en un día: qué entregó (kilos reales) y cuánto
  // cobró por cada método, para controlar lo que trae a la empresa.
  async settlement(userId: string, date: string) {
    const driver = await this.usersRepository.findOne({
      select: { id: true, name: true, email: true },
      where: { id: userId },
    });

    if (!driver) {
      throw new NotFoundException('Repartidor no encontrado');
    }

    const { start, end } = businessDayRange(date);

    const [orders, payments, stillPending] = await Promise.all([
      this.ordersRepository
        .createQueryBuilder('o')
        .where('o.deliveredById = :userId', { userId })
        .andWhere('o.status = :status', { status: OrderStatus.DELIVERED })
        .andWhere('o.deliveredAt >= :start AND o.deliveredAt < :end', {
          start,
          end,
        })
        .orderBy('o.deliveredAt', 'ASC')
        .getMany(),

      this.paymentsRepository
        .createQueryBuilder('p')
        .where('p.collectedById = :userId', { userId })
        .andWhere('p.createdAt >= :start AND p.createdAt < :end', {
          start,
          end,
        })
        .getMany(),

      this.ordersRepository.count({
        where: {
          assignedToId: userId,
          status: OrderStatus.PENDING,
        },
      }),
    ]);

    const detailed = await this.withDetails(orders);

    const collectedByOrder = new Map<string, number>();
    const collectedByMethod: Record<string, number> = {};

    for (const payment of payments) {
      const amount = Number(payment.amount);
      collectedByOrder.set(
        payment.orderId,
        (collectedByOrder.get(payment.orderId) ?? 0) + amount,
      );
      collectedByMethod[payment.method] =
        (collectedByMethod[payment.method] ?? 0) + amount;
    }

    const products = new Map<
      string,
      {
        productId: string;
        name: string;
        unit: string;
        requested: number;
        delivered: number;
        amount: number;
      }
    >();

    for (const order of detailed) {
      for (const item of order.items) {
        const current = products.get(item.productId) ?? {
          productId: item.productId,
          name: item.productName,
          unit: item.unit,
          requested: 0,
          delivered: 0,
          amount: 0,
        };
        current.requested += item.requestedQuantity;
        current.delivered += item.quantity;
        current.amount += item.subtotal;
        products.set(item.productId, current);
      }
    }

    const totalSold = money(
      detailed.reduce((sum, order) => sum + order.total, 0),
    );
    const totalCollected = money(
      payments.reduce((sum, payment) => sum + Number(payment.amount), 0),
    );

    return {
      driver,
      date,
      deliveredCount: detailed.length,
      stillPendingCount: stillPending,
      totalSold,
      totalCollected,
      // Lo que quedó en cuenta corriente.
      totalOnCredit: money(
        detailed.reduce(
          (sum, order) =>
            sum +
            Math.max(order.total - (collectedByOrder.get(order.id) ?? 0), 0),
          0,
        ),
      ),
      collectedByMethod: Object.fromEntries(
        Object.entries(collectedByMethod).map(([method, amount]) => [
          method,
          money(amount),
        ]),
      ),
      products: [...products.values()]
        .map((product) => ({
          ...product,
          requested: kilos(product.requested),
          delivered: kilos(product.delivered),
          amount: money(product.amount),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      orders: detailed.map((order) => ({
        ...order,
        collected: money(collectedByOrder.get(order.id) ?? 0),
      })),
    };
  }

  private async withDetails(orders: Order[]) {
    if (!orders.length) return [];

    const orderIds = orders.map((order) => order.id);

    const [items, customers] = await Promise.all([
      this.orderItemsRepository.find({
        where: { orderId: In(orderIds) },
        order: { createdAt: 'ASC', id: 'ASC' },
      }),
      this.customersRepository.find({
        where: { id: In([...new Set(orders.map((o) => o.customerId))]) },
      }),
    ]);

    const products = items.length
      ? await this.productsRepository.find({
          where: { id: In([...new Set(items.map((item) => item.productId))]) },
        })
      : [];

    const productById = new Map(products.map((p) => [p.id, p]));
    const customerById = new Map(customers.map((c) => [c.id, c]));

    return orders.map((order) => {
      const customer = customerById.get(order.customerId);

      return {
        id: order.id,
        status: order.status,
        paymentStatus: order.paymentStatus,
        total: Number(order.total),
        notes: order.notes ?? null,
        deliveryDate: order.deliveryDate ?? null,
        deliveredAt: order.deliveredAt ?? null,
        deliveryComment: order.deliveryComment ?? null,
        createdAt: order.createdAt,
        customer: customer
          ? {
              id: customer.id,
              name: customer.name,
              phone: customer.phone ?? null,
              address: customer.address ?? null,
            }
          : null,
        items: items
          .filter((item) => item.orderId === order.id)
          .map((item) => {
            const product = productById.get(item.productId);
            return {
              productId: item.productId,
              productName: product?.name ?? 'Producto eliminado',
              unit: product?.unit ?? 'kg',
              requestedQuantity: Number(item.requestedQuantity),
              quantity: Number(item.quantity),
              unitPrice: Number(item.unitPrice),
              subtotal: Number(item.subtotal),
            };
          }),
      };
    });
  }
}
