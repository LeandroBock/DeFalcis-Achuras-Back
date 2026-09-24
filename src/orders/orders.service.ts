import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { DataSource, Repository } from 'typeorm';

import { InjectRepository } from '@nestjs/typeorm';

import { Order, OrderStatus } from './entities/order.entity.js';

import { OrderItem } from '../order-items/entities/order-item.entity.js';

import { Customer } from '../customers/entities/customer.entity.js';

import { Product } from '../products/entities/product.entity.js';

import { CreateOrderDto } from './dto/create-order.dto.js';

import { InventoryService } from '../inventory/inventory.service.js';

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order)
    private readonly ordersRepository: Repository<Order>,

    @InjectRepository(OrderItem)
    private readonly orderItemsRepository: Repository<OrderItem>,

    @InjectRepository(Customer)
    private readonly customersRepository: Repository<Customer>,

    @InjectRepository(Product)
    private readonly productsRepository: Repository<Product>,

    private readonly inventoryService: InventoryService,

    private readonly dataSource: DataSource,
  ) {}

  async create(createOrderDto: CreateOrderDto) {
    const { customerId, notes, items } = createOrderDto;

    return this.dataSource.transaction(async (manager) => {
      const customerRepository = manager.getRepository(Customer);

      const productRepository = manager.getRepository(Product);

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

      // 2. Verificar productos
      for (const item of items) {
        const product = await productRepository.findOne({
          where: {
            id: item.productId,
            isActive: true,
          },
        });

        if (!product) {
          throw new NotFoundException(
            `El producto ${item.productId} no existe o está inactivo`,
          );
        }

        const currentStock = Number(product.stock);

        if (item.quantity > currentStock) {
          throw new BadRequestException(
            `Stock insuficiente para ${product.name}. Stock disponible: ${currentStock}`,
          );
        }

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

      // 5. Descontar stock
      for (const item of orderItems) {
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
    });
  }

  async findAll() {
    return this.ordersRepository.find({
      order: {
        createdAt: 'DESC',
      },
    });
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
