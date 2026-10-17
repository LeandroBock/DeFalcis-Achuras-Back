import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';

import { Customer } from '../customers/entities/customer.entity.js';
import { pricingFor } from '../customers/customer-prices.js';
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

    private readonly dataSource: DataSource,
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
  // domicilio: cliente (dirección, teléfono) y productos, en el orden de la
  // ruta que armó la oficina. Con `date`, solo las de ese día y las que no
  // tienen fecha.
  async pendingFor(userId: string, date?: string) {
    const query = this.ordersRepository
      .createQueryBuilder('o')
      .where('o.assignedToId = :userId', { userId })
      .andWhere('o.status = :status', { status: OrderStatus.PENDING })
      .orderBy('o.deliveryDate', 'ASC', 'NULLS LAST')
      .addOrderBy('o.routeOrder', 'ASC', 'NULLS LAST')
      .addOrderBy('o.createdAt', 'ASC');

    if (date) {
      query.andWhere('(o.deliveryDate = :date OR o.deliveryDate IS NULL)', {
        date,
      });
    }

    const orders = await query.getMany();

    return this.withDetails(orders);
  }

  // Una nota con los datos para entregarla (para cargar la entrega desde la
  // oficina).
  async detail(orderId: string) {
    const order = await this.ordersRepository.findOneBy({ id: orderId });

    if (!order) {
      throw new NotFoundException('Pedido no encontrado');
    }

    const [detailed] = await this.withDetails([order]);
    return detailed;
  }

  // Orden de la ruta del repartidor: orderIds de la primera a la última
  // parada. Tienen que ser notas pendientes asignadas a él; las suyas que no
  // vengan quedan al final, en el orden que tenían.
  async setRoute(driverId: string, orderIds: string[]) {
    const ids = [...new Set(orderIds)];

    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(Order);
      const pending = await repository.find({
        where: { assignedToId: driverId, status: OrderStatus.PENDING },
        order: {
          routeOrder: { direction: 'ASC', nulls: 'LAST' },
          createdAt: 'ASC',
        },
        lock: { mode: 'pessimistic_write' },
      });
      const byId = new Map(pending.map((order) => [order.id, order]));

      if (ids.some((id) => !byId.has(id))) {
        throw new BadRequestException(
          'Alguna de las notas ya no está pendiente o no es de este repartidor. Actualizá la pantalla.',
        );
      }

      const rest = pending.filter((order) => !ids.includes(order.id));
      const ordered = [...ids.map((id) => byId.get(id)!), ...rest];

      for (const [index, order] of ordered.entries()) {
        if (order.routeOrder !== index + 1) {
          await repository.update(order.id, { routeOrder: index + 1 });
        }
      }
    });

    return this.pendingFor(driverId);
  }

  // Tablero del día para la oficina: las notas a entregar ese día y las
  // entregadas ese día, con su estado y repartidor.
  async board(date: string) {
    const { start, end } = businessDayRange(date);

    const orders = await this.ordersRepository
      .createQueryBuilder('o')
      .where('(o.status = :pending AND o.deliveryDate = :date)', {
        pending: OrderStatus.PENDING,
        date,
      })
      .orWhere(
        '(o.status = :delivered AND o.deliveredAt >= :start AND o.deliveredAt < :end)',
        { delivered: OrderStatus.DELIVERED, start, end },
      )
      .orderBy('o.createdAt', 'ASC')
      .getMany();

    const detailed = await this.withDetails(orders);

    const userIds = [
      ...new Set(
        orders
          .map((order) => order.deliveredById ?? order.assignedToId)
          .filter((id): id is string => !!id),
      ),
    ];
    const [users, payments] = await Promise.all([
      userIds.length
        ? this.usersRepository.find({
            select: { id: true, name: true },
            where: { id: In(userIds) },
          })
        : [],
      orders.length
        ? this.paymentsRepository.find({
            where: { orderId: In(orders.map((order) => order.id)) },
          })
        : [],
    ]);

    const userName = new Map(users.map((user) => [user.id, user.name]));
    const collected = new Map<string, number>();
    for (const payment of payments) {
      collected.set(
        payment.orderId,
        (collected.get(payment.orderId) ?? 0) + Number(payment.amount),
      );
    }

    const notes = detailed.map((order, index) => {
      const source = orders[index];
      const driverId = source.deliveredById ?? source.assignedToId ?? null;
      const boardStatus =
        source.status === OrderStatus.DELIVERED
          ? 'delivered'
          : source.deliveryComment && !source.assignedToId
            ? 'not_delivered'
            : 'pending';

      return {
        ...order,
        boardStatus,
        driverId,
        driverName: driverId ? (userName.get(driverId) ?? null) : null,
        collected: money(collected.get(order.id) ?? 0),
      };
    });

    const delivered = notes.filter((note) => note.boardStatus === 'delivered');

    return {
      date,
      summary: {
        total: notes.length,
        pending: notes.filter((note) => note.boardStatus === 'pending').length,
        delivered: delivered.length,
        notDelivered: notes.filter(
          (note) => note.boardStatus === 'not_delivered',
        ).length,
        sold: money(delivered.reduce((sum, note) => sum + note.total, 0)),
        collected: money(
          delivered.reduce((sum, note) => sum + note.collected, 0),
        ),
      },
      notes,
    };
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
      // Deuda anterior que el repartidor cobró en las entregas.
      debtCollected: money(
        payments
          .filter((payment) => !detailed.some((o) => o.id === payment.orderId))
          .reduce((sum, payment) => sum + Number(payment.amount), 0),
      ),
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

  // Saldo pendiente por cliente: entregas no cobradas del todo.
  private async pendingBalances(customerIds: string[]) {
    if (!customerIds.length) return new Map<string, number>();

    const rows: { customerId: string; balance: string }[] =
      await this.ordersRepository
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
        .select('o.customerId', 'customerId')
        .addSelect('SUM(o.total - COALESCE(pay.paid, 0))', 'balance')
        .where('o.status = :delivered', { delivered: OrderStatus.DELIVERED })
        .andWhere('o.customerId IN (:...customerIds)', { customerIds })
        .andWhere('o.total - COALESCE(pay.paid, 0) > 0')
        .groupBy('o.customerId')
        .getRawMany();

    return new Map(
      rows.map((row) => [row.customerId, money(Number(row.balance))]),
    );
  }

  private async withDetails(orders: Order[]) {
    if (!orders.length) return [];

    const orderIds = orders.map((order) => order.id);

    const customerIds = [...new Set(orders.map((o) => o.customerId))];

    const [items, customers, pricing, activeProducts] = await Promise.all([
      this.orderItemsRepository.find({
        where: { orderId: In(orderIds) },
        order: { createdAt: 'ASC', id: 'ASC' },
      }),
      this.customersRepository.find({ where: { id: In(customerIds) } }),
      pricingFor(this.dataSource.manager, customerIds),
      this.productsRepository.find({
        select: { id: true, salePrice: true },
        where: { isActive: true },
      }),
    ]);

    // Lo que deben de entregas anteriores (cuenta corriente) los clientes con
    // el tilde de cobrar la deuda, para que el repartidor lo sepa al llegar.
    const balances = await this.pendingBalances(
      customers.filter((c) => c.collectDebt).map((c) => c.id),
    );

    // Precio de cada producto para el cliente (lista + descuentos) cuando no
    // es el normal: el repartidor lo necesita si agrega productos en el
    // momento de la entrega.
    const pricesByCustomer = new Map<string, Record<string, number>>();
    for (const customerId of customerIds) {
      const customerPricing = pricing.get(customerId);
      const prices: Record<string, number> = {};
      for (const product of activeProducts) {
        const price = customerPricing?.priceOf(product);
        if (price !== undefined && price !== Number(product.salePrice)) {
          prices[product.id] = price;
        }
      }
      pricesByCustomer.set(customerId, prices);
    }

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
        routeOrder: order.routeOrder ?? null,
        assignedToId: order.assignedToId ?? null,
        receiptNumber: order.receiptNumber ?? null,
        receiptSentAt: order.receiptSentAt ?? null,
        receiptError: order.receiptError ?? null,
        deliveredAt: order.deliveredAt ?? null,
        deliveryComment: order.deliveryComment ?? null,
        createdAt: order.createdAt,
        // Todos los datos del cliente que sirven en el domicilio.
        customer: customer
          ? {
              id: customer.id,
              name: customer.name,
              phone: customer.phone ?? null,
              email: customer.email ?? null,
              address: customer.address ?? null,
              notes: customer.notes ?? null,
              taxId: customer.taxId ?? null,
              taxCondition: customer.taxCondition,
              collectDebt: customer.collectDebt,
              pendingBalance: balances.get(customer.id) ?? 0,
              specialPrices: pricesByCustomer.get(customer.id) ?? {},
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
