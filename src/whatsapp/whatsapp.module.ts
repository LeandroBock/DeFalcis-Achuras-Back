import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Customer } from '../customers/entities/customer.entity.js';
import { Product } from '../products/entities/product.entity.js';
import { OrdersModule } from '../orders/orders.module.js';
import { WhatsAppController } from './whatsapp.controller.js';
import { WhatsAppService } from './whatsapp.service.js';
import { WhatsAppMessage } from './entities/whatsapp-message.entity.js';
import { WhatsAppOrder } from './entities/whatsapp-order.entity.js';
import { Order } from '../orders/entities/order.entity.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { BaileysWhatsAppClient } from './connection/baileys-whatsapp.client.js';
import {
  DisabledWhatsAppClient,
  WHATSAPP_CLIENT,
} from './connection/whatsapp-client.js';
import { WhatsAppAuth } from './entities/whatsapp-auth.entity.js';
import { WhatsAppEventsService } from './whatsapp-events.service.js';
import { WhatsAppInboxService } from './whatsapp-inbox.service.js';
import { DeliveryNotifierService } from './delivery-notifier.service.js';
import { ReceiptSenderService } from './receipt-sender.service.js';

@Module({
  imports: [
    ConfigModule,

    OrdersModule,
    PaymentsModule,

    TypeOrmModule.forFeature([
      WhatsAppMessage,
      Customer,
      Product,
      WhatsAppOrder,
      Order,
      WhatsAppAuth,
    ]),
  ],
  controllers: [WhatsAppController],
  providers: [
    WhatsAppService,
    WhatsAppInboxService,
    WhatsAppEventsService,
    DeliveryNotifierService,
    ReceiptSenderService,
    {
      // La conexión real solo se activa con WHATSAPP_ENABLED=true (en Render).
      // En local quedaría usando la misma sesión que producción.
      provide: WHATSAPP_CLIENT,
      inject: [
        ConfigService,
        getRepositoryToken(WhatsAppAuth),
        WhatsAppEventsService,
      ],
      useFactory: (
        config: ConfigService,
        authRepository: Repository<WhatsAppAuth>,
        events: WhatsAppEventsService,
      ) =>
        config.get('WHATSAPP_ENABLED') === 'true'
          ? new BaileysWhatsAppClient(authRepository, events)
          : new DisabledWhatsAppClient(),
    },
  ],
  exports: [WhatsAppService],
})
export class WhatsAppModule {}
