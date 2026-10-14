import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Order } from './entities/order.entity.js';
import { OrderItem } from '../order-items/entities/order-item.entity.js';

import { Customer } from '../customers/entities/customer.entity.js';
import { Product } from '../products/entities/product.entity.js';

import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';
import { DeliveriesController } from './deliveries.controller.js';
import { DeliveriesService } from './deliveries.service.js';
import { Payment } from '../payments/entities/payments.entity.js';
import { User } from '../users/entities/user.entity.js';

import { AuthModule } from '../auth/auth.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Order,
      OrderItem,
      Customer,
      Product,
      Payment,
      User,
    ]),
    AuthModule,
    InventoryModule,
  ],
  controllers: [OrdersController, DeliveriesController],
  providers: [OrdersService, DeliveriesService],
  exports: [OrdersService],
})
export class OrdersModule {}
