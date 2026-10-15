import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';

import { Invoice } from './entities/invoice.entity.js';
import { InvoicingController } from './invoicing.controller.js';
import { InvoicingService } from './invoicing.service.js';
import { InvoicePdfService } from './invoice-pdf.service.js';
import { ARCA_CLIENT, AfipSdkArcaClient } from './arca-client.js';
import { Order } from '../orders/entities/order.entity.js';
import { OrderItem } from '../order-items/entities/order-item.entity.js';
import { Product } from '../products/entities/product.entity.js';
import { Customer } from '../customers/entities/customer.entity.js';
import { arcaConfig } from '../config/arca.config.js';
import type { ArcaConfig } from '../config/arca.config.js';
import { MailModule } from '../mail/mail.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Invoice, Order, OrderItem, Product, Customer]),

    ConfigModule,

    MailModule,
  ],

  controllers: [InvoicingController],

  providers: [
    InvoicingService,
    InvoicePdfService,
    {
      provide: ARCA_CLIENT,
      inject: [arcaConfig.KEY],
      useFactory: (arca: ArcaConfig) => new AfipSdkArcaClient(arca),
    },
  ],
})
export class InvoicingModule {}
