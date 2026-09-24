import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Customer } from '../customers/entities/customer.entity.js';
import { Product } from '../products/entities/product.entity.js';
import { OrdersModule } from '../orders/orders.module.js';
import { WhatsAppController } from './whatsapp.controller.js';
import { WhatsAppService } from './whatsapp.service.js';
import { WhatsAppMessage } from './entities/whatsapp-message.entity.js';
import { WhatsAppOrder } from './entities/whatsapp-order.entity.js';
import { Order } from '../orders/entities/order.entity.js';
import { PaymentsModule } from '../payments/payments.module.js';

@Module({
  imports: [
    ConfigModule,

    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: () => ({
        secret: process.env.JWT_SECRET,
      }),
    }),

    OrdersModule,
    PaymentsModule,

    TypeOrmModule.forFeature([
      WhatsAppMessage,
      Customer,
      Product,
      WhatsAppOrder,
      Order,
    ]),
  ],
  controllers: [WhatsAppController],
  providers: [WhatsAppService],
  exports: [WhatsAppService],
})
export class WhatsAppModule {}
