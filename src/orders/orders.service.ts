import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import {
  DataSource,
  EntityManager,
  FindOptionsWhere,
  In,
  Repository,
} from 'typeorm';

import { InjectRepository } from '@nestjs/typeorm';

import {
  Order,
  OrderPaymentStatus,
  OrderStatus,
} from './entities/order.entity.js';

import { OrderItem } from '../order-items/entities/order-item.entity.js';

import { Customer } from '../customers/entities/customer.entity.js';
import { Product } from '../products/entities/product.entity.js';

import { CreateOrderDto } from './dto/create-order.dto.js';
import { UpdateOrderDto } from './dto/update-order.dto.js';
import { AssignOrderDto, BulkAssignOrdersDto } from './dto/assign-order.dto.js';
import { DeliverOrderDto } from './dto/deliver-order.dto.js';
import { OrdersQueryDto } from './dto/orders-query.dto.js';

import { InventoryService } from '../inventory/inventory.service.js';

import { findActiveProductsById } from '../products/active-products.js';
import { pricingForCustomer } from '../customers/customer-prices.js';
import { findMaybePaginated } from '../common/pagination.js';
import {
  CURRENT_ACCOUNT,
  Payment,
} from '../payments/entities/payments.entity.js';
import { payOpenOrders } from '../payments/open-orders.js';
import type { PaymentLine } from '../payments/open-orders.js';
import { User, UserRole } from '../users/entities/user.entity.js';
import type { AuthUser } from '../auth/decorators/current-user.decorator.js';
import { OrderEvent, RealtimeService } from '../realtime/realtime.service.js';

const money = (value: number) => Number(value.toFixed(2));
const kilos = (value: number) => Number(value.toFixed(3));

// Reparte lo cobrado en la entrega: primero paga esta nota (hasta su total) y
// lo que sobra va a la deuda anterior del cliente.
export function splitDeliveryPayments(lines: PaymentLine[], total: number) {
  const forOrder: PaymentLine[] = [];
  const forDebt: PaymentLine[] = [];
  let remainingCents = Math.round(total * 100);

  for (const line of lines) {
    const cents = Math.round(line.amount * 100);
    const toOrder = Math.min(cents, Math.max(remainingCents, 0));
    remainingCents -= toOrder;

    if (toOrder > 0) forOrder.push({ ...line, amount: toOrder / 100 });
    if (cents > toOrder) {
      forDebt.push({ ...line, amount: (cents - toOrder) / 100 });
    }
  }

  return { forOrder, forDebt };
}

// Circuito de venta:
// 1. Nota de pedido (PENDING): productos y kilos pedidos, total estimado. No
//    toca stock ni cuenta como venta.
// 2. Se asigna a un repartidor.
// 3. En el domicilio se pesa: el repartidor carga los kilos reales (puede
//    sacar o agregar productos) y lo cobrado. Recién ahí pasa a DELIVERED, se
//    descuenta el stock con los kilos reales y queda registrada la venta.
@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectRepository(Order)
    private readonly ordersRepository: Repository<Order>,

    @InjectRepository(OrderItem)
    private readonly orderItemsRepository: Repository<OrderItem>,

    private readonly inventoryService: InventoryService,

    private readonly dataSource: DataSource,

    private readonly realtime: RealtimeService,
  ) {}

  // Si se pasa un manager, la nota se crea dentro de esa transacción.
  async create(createOrderDto: CreateOrderDto, manager?: EntityManager) {
    if (manager) {
      // Transacción ajena (por ejemplo, WhatsApp): avisa quien la confirma.
      return this.createInTransaction(createOrderDto, manager);
    }

    const result = await this.dataSource.transaction((txManager) =>
      this.createInTransaction(createOrderDto, txManager),
    );

    await this.notify('order.created', result.order.id);

    return result;
  }

  private async createInTransaction(
    { customerId, notes, items, assignedToId, deliveryDate }: CreateOrderDto,
    manager: EntityManager,
  ) {
    await this.findActiveCustomer(manager, customerId);

    if (assignedToId) {
      await this.findDriver(manager, assignedToId);
    }

    const orderItems = await this.buildNoteItems(manager, customerId, items);

    const order = await manager.getRepository(Order).save(
      manager.getRepository(Order).create({
        customerId,
        notes,
        assignedToId: assignedToId ?? null,
        routeOrder: assignedToId
          ? await this.nextRouteOrder(manager, assignedToId)
          : null,
        deliveryDate: deliveryDate ?? null,
        status: OrderStatus.PENDING,
        total: this.sumSubtotals(orderItems),
      }),
    );

    for (const item of orderItems) {
      item.orderId = order.id;
    }

    await manager.getRepository(OrderItem).save(orderItems);

    return { order, items: orderItems };
  }

  async update(id: string, dto: UpdateOrderDto) {
    const result = await this.dataSource.transaction(async (manager) => {
      const order = await this.lockPendingOrder(manager, id);

      if (dto.notes !== undefined) order.notes = dto.notes;
      if (dto.deliveryDate !== undefined) order.deliveryDate = dto.deliveryDate;

      let items: OrderItem[] | undefined;

      if (dto.items) {
        items = await this.buildNoteItems(manager, order.customerId, dto.items);
        items.forEach((item) => (item.orderId = order.id));

        await manager.getRepository(OrderItem).delete({ orderId: order.id });
        await manager.getRepository(OrderItem).save(items);

        order.total = this.sumSubtotals(items);
      }

      await manager.getRepository(Order).save(order);

      return {
        order,
        items:
          items ??
          (await manager
            .getRepository(OrderItem)
            .findBy({ orderId: order.id })),
      };
    });

    await this.notify('order.updated', id);

    return result;
  }

  async assign(id: string, { assignedToId, deliveryDate }: AssignOrderDto) {
    const order = await this.dataSource.transaction(async (manager) => {
      const order = await this.lockPendingOrder(manager, id);

      if (assignedToId) {
        await this.findDriver(manager, assignedToId);
      }

      await this.setDriver(manager, order, assignedToId);
      if (deliveryDate !== undefined) order.deliveryDate = deliveryDate;

      return manager.getRepository(Order).save(order);
    });

    await this.notify('order.assigned', id);

    return order;
  }

  // Asigna varias notas pendientes al mismo repartidor de una vez. Las nuevas
  // se suman al final de su ruta, en el orden en que vienen.
  async assignMany({
    orderIds,
    assignedToId,
    deliveryDate,
  }: BulkAssignOrdersDto) {
    const ids = [...new Set(orderIds)];

    const orders = await this.dataSource.transaction(async (manager) => {
      if (assignedToId) {
        await this.findDriver(manager, assignedToId);
      }

      const found = await manager.getRepository(Order).find({
        where: { id: In(ids) },
        lock: { mode: 'pessimistic_write' },
      });
      const byId = new Map(found.map((order) => [order.id, order]));

      const missing = ids.filter((id) => !byId.has(id));
      if (missing.length) {
        throw new NotFoundException(
          `No se encontraron ${missing.length} de las notas elegidas`,
        );
      }

      const notPending = found.filter(
        (order) => order.status !== OrderStatus.PENDING,
      );
      if (notPending.length) {
        throw new ConflictException(
          notPending.length === 1
            ? 'Una de las notas elegidas ya fue entregada o anulada'
            : `${notPending.length} de las notas elegidas ya fueron entregadas o anuladas`,
        );
      }

      const saved: Order[] = [];
      for (const id of ids) {
        const order = byId.get(id)!;
        await this.setDriver(manager, order, assignedToId);
        if (deliveryDate !== undefined) order.deliveryDate = deliveryDate;
        saved.push(await manager.getRepository(Order).save(order));
      }

      return saved;
    });

    for (const order of orders) {
      await this.notify('order.assigned', order.id);
    }

    return { assigned: orders.length, orders };
  }

  async cancel(id: string) {
    const order = await this.dataSource.transaction(async (manager) => {
      const order = await this.lockPendingOrder(manager, id);

      order.status = OrderStatus.CANCELLED;

      return manager.getRepository(Order).save(order);
    });

    await this.notify('order.cancelled', id);

    return order;
  }

  // El repartidor carga lo que se pesó, entregó y cobró en el domicilio.
  async deliver(id: string, dto: DeliverOrderDto, user: AuthUser) {
    const productIds = dto.items.map((item) => item.productId);

    if (new Set(productIds).size !== productIds.length) {
      throw new BadRequestException(
        'Cada producto debe aparecer una sola vez en la entrega',
      );
    }

    const result = await this.dataSource.transaction(async (manager) => {
      const order = await this.lockPendingOrder(manager, id);
      this.assertCanDeliver(order, user);

      const noteItems = await manager
        .getRepository(OrderItem)
        .findBy({ orderId: order.id });

      const items = await this.buildDeliveredItems(
        manager,
        order.customerId,
        noteItems,
        dto,
      );
      const total = this.sumSubtotals(items);

      if (!items.some((item) => Number(item.quantity) > 0)) {
        throw new BadRequestException(
          'No se cargó ningún producto entregado. Si el cliente no recibió el pedido, marcalo como no entregado.',
        );
      }

      // "Cuenta corriente" no es un cobro: lo que no se cobra queda como
      // deuda. Lo cobrado de más paga la deuda anterior del cliente.
      const { forOrder, forDebt } = splitDeliveryPayments(
        (dto.payments ?? []).filter(
          (payment): payment is PaymentLine =>
            payment.method !== CURRENT_ACCOUNT,
        ),
        total,
      );
      const collected = money(
        forOrder.reduce((sum, payment) => sum + payment.amount, 0),
      );

      // Reemplazar los ítems de la nota por los entregados.
      items.forEach((item) => (item.orderId = order.id));
      await manager.getRepository(OrderItem).delete({ orderId: order.id });
      await manager.getRepository(OrderItem).save(items);

      // Descontar el stock con los kilos reales (en orden fijo de producto
      // para evitar deadlocks entre entregas simultáneas).
      const delivered = items
        .filter((item) => Number(item.quantity) > 0)
        .sort((a, b) => a.productId.localeCompare(b.productId));

      for (const item of delivered) {
        await this.inventoryService.registerSaleExit(
          item.productId,
          Number(item.quantity),
          order.id,
          manager,
        );
      }

      // Antes de marcar esta nota como entregada: así no cuenta como deuda.
      const debt = forDebt.length
        ? await payOpenOrders(manager, order.customerId, forDebt, {
            collectedById: user.sub,
            notes: 'Deuda cobrada en la entrega',
          }).catch((error: unknown) => {
            if (error instanceof BadRequestException) {
              throw new BadRequestException(
                'Lo cobrado supera el total de la entrega más la deuda anterior del cliente',
              );
            }
            throw error;
          })
        : null;

      const paymentRepository = manager.getRepository(Payment);
      const savedPayments = await paymentRepository.save(
        forOrder.map((payment) =>
          paymentRepository.create({
            orderId: order.id,
            amount: payment.amount,
            method: payment.method,
            collectedById: user.sub,
            notes: 'Cobrado en la entrega',
          }),
        ),
      );

      // Número del recibo X que se le deja (y se le manda) al cliente.
      const [{ nextval }]: { nextval: string }[] = await manager.query(
        `SELECT nextval('"ORDER_RECEIPT_SEQ"')`,
      );

      order.total = total;
      order.receiptNumber = Number(nextval);
      order.debtCollected = debt?.paid ?? 0;
      order.routeOrder = null;
      order.status = OrderStatus.DELIVERED;
      order.deliveredAt = new Date();
      order.deliveredById = user.sub;
      order.deliveryComment = dto.comment ?? null;
      order.paymentStatus =
        collected === 0
          ? OrderPaymentStatus.PENDING
          : collected < total
            ? OrderPaymentStatus.PARTIAL
            : OrderPaymentStatus.PAID;

      await manager.getRepository(Order).save(order);

      return {
        order,
        items,
        payments: savedPayments,
        collected,
        pending: money(total - collected),
        debtCollected: debt?.paid ?? 0,
        debtPayments: debt?.payments ?? [],
      };
    });

    // La venta quedó registrada: avisar a la oficina en el momento.
    const collectedByMethod: Record<string, number> = {};
    for (const payment of [...result.payments, ...result.debtPayments]) {
      collectedByMethod[payment.method] = money(
        (collectedByMethod[payment.method] ?? 0) + Number(payment.amount),
      );
    }

    await this.notify('order.delivered', id, {
      collected: result.collected,
      pending: result.pending,
      debtCollected: result.debtCollected,
      collectedByMethod,
    });

    return result;
  }

  // El cliente no recibió el pedido: la nota vuelve a la oficina (sin
  // repartidor) con el motivo, para reprogramarla o anularla.
  async markNotDelivered(id: string, reason: string, user: AuthUser) {
    const order = await this.dataSource.transaction(async (manager) => {
      const order = await this.lockPendingOrder(manager, id);
      this.assertCanDeliver(order, user);

      order.assignedToId = null;
      order.routeOrder = null;
      order.deliveryComment = reason;

      return manager.getRepository(Order).save(order);
    });

    await this.notify('order.not_delivered', id, {
      reason,
      driverName: await this.userName(user.sub),
    });

    return order;
  }

  async findAll(query: OrdersQueryDto) {
    const where: FindOptionsWhere<Order> = {};

    if (query.status) where.status = query.status;
    if (query.assignedToId) where.assignedToId = query.assignedToId;
    if (query.deliveryDate) where.deliveryDate = query.deliveryDate;

    return findMaybePaginated(
      this.ordersRepository,
      { where, order: { createdAt: 'DESC', id: 'DESC' } },
      query,
    );
  }

  async findOne(id: string) {
    const order = await this.ordersRepository.findOne({
      where: { id },
    });

    if (!order) {
      throw new NotFoundException('Pedido no encontrado');
    }

    const items = await this.orderItemsRepository.find({
      where: {
        orderId: id,
      },
    });

    return {
      order,
      items,
    };
  }

  // Avisa a la oficina (y al aviso por WhatsApp) con un resumen de la nota.
  // Nunca hace fallar la operación: ya quedó guardada.
  async notify(
    type: OrderEvent['type'],
    orderId: string,
    extra: Partial<OrderEvent['data']> = {},
  ) {
    try {
      const order = await this.ordersRepository.findOneByOrFail({
        id: orderId,
      });
      const customer = await this.dataSource
        .getRepository(Customer)
        .findOneBy({ id: order.customerId });

      this.realtime.emit({
        type,
        data: {
          orderId,
          customerName: customer?.name ?? 'Cliente',
          driverName: await this.userName(
            order.deliveredById ?? order.assignedToId,
          ),
          total: Number(order.total),
          ...extra,
        },
      } as OrderEvent);
    } catch (error) {
      this.logger.error(
        `No se pudo avisar ${type} de ${orderId}: ${String(error)}`,
      );
    }
  }

  private async userName(userId?: string | null) {
    if (!userId) return null;

    const user = await this.dataSource
      .getRepository(User)
      .findOne({ select: { id: true, name: true }, where: { id: userId } });

    return user?.name ?? null;
  }

  // ---------- Auxiliares ----------

  // Cambia el repartidor de la nota: si es otro, va al final de su ruta.
  private async setDriver(
    manager: EntityManager,
    order: Order,
    assignedToId: string | null,
  ) {
    if (order.assignedToId === assignedToId) return;

    order.assignedToId = assignedToId;
    order.routeOrder = assignedToId
      ? await this.nextRouteOrder(manager, assignedToId)
      : null;
  }

  private async nextRouteOrder(manager: EntityManager, driverId: string) {
    const { max }: { max: number | null } = (await manager
      .getRepository(Order)
      .createQueryBuilder('o')
      .select('MAX(o.routeOrder)', 'max')
      .where('o.assignedToId = :driverId', { driverId })
      .andWhere('o.status = :status', { status: OrderStatus.PENDING })
      .getRawOne()) ?? { max: null };

    return Number(max ?? 0) + 1;
  }

  private async findActiveCustomer(manager: EntityManager, customerId: string) {
    const customer = await manager
      .getRepository(Customer)
      .findOneBy({ id: customerId, isActive: true });

    if (!customer) {
      throw new NotFoundException('Cliente no encontrado o inactivo');
    }

    return customer;
  }

  private async findDriver(manager: EntityManager, userId: string) {
    const user = await manager
      .getRepository(User)
      .findOneBy({ id: userId, isActive: true });

    if (!user) {
      throw new NotFoundException('Repartidor no encontrado o inactivo');
    }

    return user;
  }

  // Bloquea la nota hasta el fin de la transacción (dos entregas o
  // modificaciones simultáneas no se pisan) y verifica que siga pendiente.
  private async lockPendingOrder(manager: EntityManager, id: string) {
    const order = await manager.getRepository(Order).findOne({
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });

    if (!order) {
      throw new NotFoundException('Pedido no encontrado');
    }

    if (order.status !== OrderStatus.PENDING) {
      throw new ConflictException(
        order.status === OrderStatus.CANCELLED
          ? 'La nota de pedido está anulada'
          : 'La nota de pedido ya fue entregada',
      );
    }

    return order;
  }

  // Un repartidor solo puede entregar las notas asignadas a él.
  private assertCanDeliver(order: Order, user: AuthUser) {
    if (user.role === UserRole.REPARTO && order.assignedToId !== user.sub) {
      throw new ForbiddenException('Esta nota no está asignada a vos');
    }
  }

  // Ítems de una nota: precio vigente para ese cliente (su lista y su
  // descuento o precio especial, si tiene) y kilos pedidos.
  private async buildNoteItems(
    manager: EntityManager,
    customerId: string,
    items: { productId: string; quantity: number }[],
  ) {
    const productIds = items.map((item) => item.productId);
    const [productsById, pricing] = await Promise.all([
      findActiveProductsById(manager, productIds),
      pricingForCustomer(manager, customerId, productIds),
    ]);

    return items.map((item) => {
      const unitPrice = pricing.priceOf(productsById.get(item.productId)!);

      return manager.getRepository(OrderItem).create({
        productId: item.productId,
        quantity: kilos(item.quantity),
        requestedQuantity: kilos(item.quantity),
        unitPrice,
        subtotal: money(item.quantity * unitPrice),
      });
    });
  }

  // Ítems de la entrega: los productos de la nota conservan el precio de la
  // nota (aunque el producto haya aumentado); los agregados en el momento
  // van al precio vigente para ese cliente. Lo que estaba en la nota y no se
  // entregó queda registrado con 0.
  private async buildDeliveredItems(
    manager: EntityManager,
    customerId: string,
    noteItems: OrderItem[],
    dto: DeliverOrderDto,
  ) {
    const note = new Map<string, { requested: number; unitPrice: number }>();

    for (const item of noteItems) {
      const current = note.get(item.productId);
      note.set(item.productId, {
        requested: (current?.requested ?? 0) + Number(item.requestedQuantity),
        unitPrice: current?.unitPrice ?? Number(item.unitPrice),
      });
    }

    const addedIds = dto.items
      .map((item) => item.productId)
      .filter((productId) => !note.has(productId));

    const [addedProducts, pricing] = addedIds.length
      ? await Promise.all([
          findActiveProductsById(manager, addedIds),
          pricingForCustomer(manager, customerId, addedIds),
        ])
      : [new Map<string, Product>(), null];

    const delivered = new Map(
      dto.items.map((item) => [item.productId, item.quantity]),
    );

    const productIds = [...new Set([...note.keys(), ...delivered.keys()])];

    return productIds
      .map((productId) => {
        const quantity = kilos(delivered.get(productId) ?? 0);
        const requested = kilos(note.get(productId)?.requested ?? 0);
        const unitPrice =
          note.get(productId)?.unitPrice ??
          pricing!.priceOf(addedProducts.get(productId)!);

        return manager.getRepository(OrderItem).create({
          productId,
          quantity,
          requestedQuantity: requested,
          unitPrice,
          subtotal: money(quantity * unitPrice),
        });
      })
      .filter(
        (item) =>
          Number(item.quantity) > 0 || Number(item.requestedQuantity) > 0,
      );
  }

  private sumSubtotals(items: OrderItem[]) {
    return money(items.reduce((sum, item) => sum + Number(item.subtotal), 0));
  }
}
