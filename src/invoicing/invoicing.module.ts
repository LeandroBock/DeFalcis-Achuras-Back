import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';

import { Invoice } from './entities/invoice.entity.js';
import { InvoicingController } from './invoicing.controller.js';
import { InvoicingService } from './invoicing.service.js';
import { InvoicePdfService } from './invoice-pdf.service.js';
import { Order } from '../orders/entities/order.entity.js';
import { OrderItem } from '../order-items/entities/order-item.entity.js';
import { Product } from '../products/entities/product.entity.js';
import { Customer } from '../customers/entities/customer.entity.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Invoice, Order, OrderItem, Product, Customer]),

    ConfigModule,
  ],

  controllers: [InvoicingController],

  providers: [InvoicingService, InvoicePdfService],
})
export class InvoicingModule {}
