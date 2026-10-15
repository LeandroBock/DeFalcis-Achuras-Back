import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Customer } from './entities/customer.entity.js';
import { CustomerPrice } from './entities/customer-price.entity.js';
import { Product } from '../products/entities/product.entity.js';
import { Order } from '../orders/entities/order.entity.js';
import { CustomersController } from './customers.controller.js';
import { CustomersService } from './customers.service.js';
import { CurrentAccountsController } from './current-accounts.controller.js';
import { CurrentAccountsService } from './current-accounts.service.js';

import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Customer, CustomerPrice, Product, Order]),
    AuthModule,
  ],
  controllers: [CustomersController, CurrentAccountsController],
  providers: [CustomersService, CurrentAccountsService],
  exports: [CustomersService],
})
export class CustomersModule {}
