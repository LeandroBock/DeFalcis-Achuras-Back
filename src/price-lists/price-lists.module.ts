import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PriceList } from './entities/price-list.entity.js';
import { PriceListItem } from './entities/price-list-item.entity.js';
import { Customer } from '../customers/entities/customer.entity.js';
import { Product } from '../products/entities/product.entity.js';
import { PriceListsController } from './price-lists.controller.js';
import { PriceListsService } from './price-lists.service.js';

import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([PriceList, PriceListItem, Customer, Product]),
    AuthModule,
  ],
  controllers: [PriceListsController],
  providers: [PriceListsService],
})
export class PriceListsModule {}
