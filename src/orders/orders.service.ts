import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  DataSource,
  EntityManager,
  FindOptionsWhere,
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

import { CreateOrderDto } from './dto/create-order.dto.js';
import { UpdateOrderDto } from './dto/update-order.dto.js';
import { AssignOrderDto } from './dto/assign-order.dto.js';
import { DeliverOrderDto } from './dto/deliver-order.dto.js';
import { OrdersQueryDto } from './dto/orders-query.dto.js';

import { InventoryService } from '../inventory/inventory.service.js';

import { findActiveProductsById } from '../products/active-products.js';
import { findMaybePaginated } from '../common/pagination.js';
import { Payment } from '../payments/entities/payments.entity.js';
import { User, UserRole } from '../users/entities/user.entity.js';
import type { AuthUser } from '../auth/decorators/current-user.decorator.js';

const money = (value: number) => Number(value.toFixed(2));
const kilos = (value: number) => Number(value.toFixed(3));

// Circuito de venta:
// 1. Nota de pedido (PENDING): productos y kilos pedidos, total estimado. No
//    toca stock ni cuenta como venta.
// 2. Se asigna a un repartidor.
// 3. En el domicilio se pesa: el repartidor carga los kilos reales (puede
//    sacar o agregar productos) y lo cobrado. Recién ahí pasa a DELIVERED, se
//    descuenta el stock con los kilos reales y queda registrada la venta.
@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order)
    private readonly ordersRepository: Repository<Order>,

    @InjectRepository(OrderItem)
    private readonly orderItemsRepository: Repository<OrderItem>,

    private readonly inventoryService: InventoryService,

    private readonly dataSource: DataSource,
  ) {}

  // Si se pasa un manager, la nota se crea dentro de esa transacción.
  async create(createOrderDto: CreateOrderDto, manager?: EntityManager) {
    if (manager) {
      return this.createInTransaction(createOrderDto, manager);
    }

    return this.dataSource.transaction((txManager) =>
      this.createInTransaction(createOrderDto, txManager),
    );
  }

  private async createInTransaction(
    { customerId, notes, items, assignedToId, deliveryDate }: CreateOrderDto,
    manager: EntityManager,
  ) {
    await this.findActiveCustomer(manager, customerId);

    if (assignedToId) {
      await this.findDriver(manager, assignedToId);
    }

    const orderItems = await this.buildNoteItems(manager, items);

    const order = await manager.getRepository(Order).save(
      manager.getRepository(Order).create({
        customerId,
        notes,
        assignedToId: assignedToId ?? null,
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
    return this.dataSource.transaction(async (manager) => {
      const order = await this.lockPendingOrder(manager, id);

      if (dto.notes !== undefined) order.notes = dto.notes;
      if (dto.deliveryDate !== undefined) order.deliveryDate = dto.deliveryDate;

      let items: OrderItem[] | undefined;

      if (dto.items) {
        items = await this.buildNoteItems(manager, dto.items);
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
  }

  async assign(id: string, { assignedToId, deliveryDate }: AssignOrderDto) {
    return this.dataSource.transaction(async (manager) => {
      const order = await this.lockPendingOrder(manager, id);

      if (assignedToId) {
        await this.findDriver(manager, assignedToId);
      }

      order.assignedToId = assignedToId;
      if (deliveryDate !== undefined) order.deliveryDate = deliveryDate;

      return manager.getRepository(Order).save(order);
    });
  }

  async cancel(id: string) {
    return this.dataSource.transaction(async (manager) => {
      const order = await this.lockPendingOrder(manager, id);

      order.status = OrderStatus.CANCELLED;

      return manager.getRepository(Order).save(order);
    });
  }

  // El repartidor carga lo que se pesó, entregó y cobró en el domicilio.
  async deliver(id: string, dto: DeliverOrderDto, user: AuthUser) {
    const productIds = dto.items.map((item) => item.productId);

    if (new Set(productIds).size !== productIds.length) {
      throw new BadRequestException(
        'Cada producto debe aparecer una sola vez en la entrega',
      );
    }

    return this.dataSource.transaction(async (manager) => {
      const order = await this.lockPendingOrder(manager, id);
      this.assertCanDeliver(order, user);

      const noteItems = await manager
        .getRepository(OrderItem)
        .findBy({ orderId: order.id });

      const items = await this.buildDeliveredItems(manager, noteItems, dto);
      const total = this.sumSubtotals(items);

      if (!items.some((item) => Number(item.quantity) > 0)) {
        throw new BadRequestException(
          'No se cargó ningún producto entregado. Si el cliente no recibió el pedido, marcalo como no entregado.',
        );
      }

      const payments = dto.payments ?? [];
      const collected = money(
        payments.reduce((sum, payment) => sum + payment.amount, 0),
      );

      if (collected > total) {
        throw new BadRequestException(
          `Lo cobrado ($${collected.toFixed(2)}) supera el total de la entrega ($${total.toFixed(2)})`,
        );
      }

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

      const paymentRepository = manager.getRepository(Payment);
      const savedPayments = await paymentRepository.save(
        payments.map((payment) =>
          paymentRepository.create({
            orderId: order.id,
            amount: payment.amount,
            method: payment.method,
            collectedById: user.sub,
            notes: 'Cobrado en la entrega',
          }),
        ),
      );

      order.total = total;
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
      };
    });
  }

  // El cliente no recibió el pedido: la nota vuelve a la oficina (sin
  // repartidor) con el motivo, para reprogramarla o anularla.
  async markNotDelivered(id: string, reason: string, user: AuthUser) {
    return this.dataSource.transaction(async (manager) => {
      const order = await this.lockPendingOrder(manager, id);
      this.assertCanDeliver(order, user);

      order.assignedToId = null;
      order.deliveryComment = reason;

      return manager.getRepository(Order).save(order);
    });
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

  // ---------- Auxiliares ----------

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

  // Ítems de una nota: precio vigente del producto, kilos pedidos.
  private async buildNoteItems(
    manager: EntityManager,
    items: { productId: string; quantity: number }[],
  ) {
    const productsById = await findActiveProductsById(
      manager,
      items.map((item) => item.productId),
    );

    return items.map((item) => {
      const unitPrice = Number(productsById.get(item.productId)!.salePrice);

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
  // van al precio vigente. Lo que estaba en la nota y no se entregó queda
  // registrado con 0.
  private async buildDeliveredItems(
    manager: EntityManager,
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

    const addedProducts = addedIds.length
      ? await findActiveProductsById(manager, addedIds)
      : new Map();

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
          Number(addedProducts.get(productId)!.salePrice);

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
