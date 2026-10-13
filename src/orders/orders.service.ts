import { Injectable, NotFoundException } from '@nestjs/common';

import { DataSource, EntityManager, Repository } from 'typeorm';

import { InjectRepository } from '@nestjs/typeorm';

import { Order, OrderStatus } from './entities/order.entity.js';

import { OrderItem } from '../order-items/entities/order-item.entity.js';

import { Customer } from '../customers/entities/customer.entity.js';

import { CreateOrderDto } from './dto/create-order.dto.js';

import { InventoryService } from '../inventory/inventory.service.js';

import { findActiveProductsById } from '../products/active-products.js';
import {
  PaginationQueryDto,
  findMaybePaginated,
} from '../common/pagination.js';

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

  // Si se pasa un manager, el pedido se crea dentro de esa transacción.
  async create(createOrderDto: CreateOrderDto, manager?: EntityManager) {
    if (manager) {
      return this.createInTransaction(createOrderDto, manager);
    }

    return this.dataSource.transaction((txManager) =>
      this.createInTransaction(createOrderDto, txManager),
    );
  }

  private async createInTransaction(
    createOrderDto: CreateOrderDto,
    manager: EntityManager,
  ) {
    const { customerId, notes, items } = createOrderDto;

    const customerRepository = manager.getRepository(Customer);

    const orderRepository = manager.getRepository(Order);

    const orderItemRepository = manager.getRepository(OrderItem);

    // 1. Verificar cliente
    const customer = await customerRepository.findOne({
      where: {
        id: customerId,
        isActive: true,
      },
    });

    if (!customer) {
      throw new NotFoundException('Cliente no encontrado o inactivo');
    }

    let total = 0;

    const orderItems: OrderItem[] = [];

    // 2. Verificar productos. Se permite vender aunque el stock quede
    // negativo: las achuras pierden peso (agua) y el stock nunca es exacto.
    const productsById = await findActiveProductsById(
      manager,
      items.map((item) => item.productId),
    );

    for (const item of items) {
      const product = productsById.get(item.productId)!;

      const unitPrice = Number(product.salePrice);

      const subtotal = Number((item.quantity * unitPrice).toFixed(2));

      total += subtotal;

      const orderItem = orderItemRepository.create({
        productId: item.productId,
        quantity: item.quantity,
        unitPrice,
        subtotal,
      });

      orderItems.push(orderItem);
    }

    // 3. Crear pedido
    const order = orderRepository.create({
      customerId,
      status: OrderStatus.CONFIRMED,
      total: Number(total.toFixed(2)),
      notes,
    });

    const savedOrder = await orderRepository.save(order);

    // 4. Asociar items
    for (const item of orderItems) {
      item.orderId = savedOrder.id;
    }

    await orderItemRepository.save(orderItems);

    // 5. Descontar stock. Se recorre en orden fijo de producto para que
    // dos pedidos simultáneos bloqueen las filas en el mismo orden y no
    // se produzca un deadlock.
    const itemsByProduct = [...orderItems].sort((a, b) =>
      a.productId.localeCompare(b.productId),
    );

    for (const item of itemsByProduct) {
      await this.inventoryService.registerSaleExit(
        item.productId,
        Number(item.quantity),
        savedOrder.id,
        manager,
      );
    }

    return {
      order: savedOrder,
      items: orderItems,
    };
  }

  async findAll(query: PaginationQueryDto) {
    return findMaybePaginated(
      this.ordersRepository,
      { order: { createdAt: 'DESC', id: 'DESC' } },
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
}
