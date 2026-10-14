import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Customer } from './entities/customer.entity.js';
import { CustomerPrice } from './entities/customer-price.entity.js';
import { Product } from '../products/entities/product.entity.js';
import { CustomersController } from './customers.controller.js';
import { CustomersService } from './customers.service.js';

import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Customer, CustomerPrice, Product]),
    AuthModule,
  ],
  controllers: [CustomersController],
  providers: [CustomersService],
  exports: [CustomersService],
})
export class CustomersModule {}
