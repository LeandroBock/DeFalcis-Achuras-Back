import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Customer } from '../customers/entities/customer.entity.js';

import {
  InboundWhatsAppMessage,
  WHATSAPP_CLIENT,
} from './connection/whatsapp-client.js';
import type { WhatsAppClient } from './connection/whatsapp-client.js';
import {
  WhatsAppMessage,
  WhatsAppMessageDirection,
  WhatsAppMessageStatus,
  WhatsAppMessageType,
} from './entities/whatsapp-message.entity.js';
import { WhatsAppEventsService } from './whatsapp-events.service.js';
import {
  phoneMatchKey,
  phoneSuffix,
  phoneSuffixSql,
} from './whatsapp-phone.js';

// Mensajes reales de WhatsApp: guarda los que llegan (y los escritos desde el
// celular del negocio) y envía los que se escriben desde la app. Nunca
// responde solo: las respuestas las escribe una persona.
@Injectable()
export class WhatsAppInboxService implements OnModuleInit {
  private readonly logger = new Logger(WhatsAppInboxService.name);

  constructor(
    @InjectRepository(WhatsAppMessage)
    private readonly messagesRepository: Repository<WhatsAppMessage>,

    @InjectRepository(Customer)
    private readonly customersRepository: Repository<Customer>,

    @Inject(WHATSAPP_CLIENT)
    private readonly client: WhatsAppClient,

    private readonly events: WhatsAppEventsService,
  ) {}

  onModuleInit() {
    this.events.inboundStream().subscribe((inbound) => {
      this.receive(inbound).catch((error) =>
        this.logger.error(`No se pudo guardar un mensaje: ${error}`),
      );
    });
  }

  // Devuelve el mensaje guardado, o null si ya se había guardado antes.
  async receive(inbound: InboundWhatsAppMessage) {
    return this.store({
      phone: inbound.phone,
      message: inbound.text,
      type: inbound.type,
      contactName: inbound.contactName,
      externalMessageId: inbound.externalMessageId,
      direction: inbound.fromMe
        ? WhatsAppMessageDirection.OUTGOING
        : WhatsAppMessageDirection.INCOMING,
      status: inbound.fromMe
        ? WhatsAppMessageStatus.SENT
        : WhatsAppMessageStatus.RECEIVED,
      createdAt: inbound.sentAt,
    });
  }

  async send(phone: string, text: string) {
    const sent = await this.client.sendText(phone, text);

    const saved = await this.store({
      phone: sent.phone,
      message: text,
      type: WhatsAppMessageType.TEXT,
      externalMessageId: sent.externalMessageId,
      direction: WhatsAppMessageDirection.OUTGOING,
      status: WhatsAppMessageStatus.SENT,
    });

    // Si el eco de WhatsApp llegó antes y ya lo guardó, se devuelve ese.
    return (
      saved ??
      this.messagesRepository.findOneByOrFail({
        externalMessageId: sent.externalMessageId,
      })
    );
  }

  // El cliente cuyo teléfono coincide, aunque esté escrito en otro formato
  // (3415556789, 0341 15 5556789, 5493415556789...). Si hay varios, el activo
  // más antiguo.
  async findCustomerByPhone(phone: string) {
    return (await this.findCustomersByPhones([phone])).get(phone);
  }

  // Igual que findCustomerByPhone para varios teléfonos, en una sola consulta.
  async findCustomersByPhones(phones: string[]) {
    const result = new Map<string, Customer>();
    const suffixes = [...new Set(phones.map(phoneSuffix))].filter(Boolean);

    if (!suffixes.length) {
      return result;
    }

    const candidates = await this.customersRepository
      .createQueryBuilder('c')
      .where(`${phoneSuffixSql('c.phone')} IN (:...suffixes)`, { suffixes })
      .orderBy('c.isActive', 'DESC')
      .addOrderBy('c.createdAt', 'ASC')
      .getMany();

    for (const phone of phones) {
      const key = phoneMatchKey(phone);
      const customer = candidates.find(
        (candidate) =>
          candidate.phone && phoneMatchKey(candidate.phone) === key,
      );
      if (customer) result.set(phone, customer);
    }

    return result;
  }

  private async store(values: Partial<WhatsAppMessage>) {
    const customer = await this.findCustomerByPhone(values.phone!);

    const result = await this.messagesRepository
      .createQueryBuilder()
      .insert()
      .into(WhatsAppMessage)
      .values({ ...values, customerId: customer?.id })
      .orIgnore()
      .returning('*')
      .execute();

    const row = (result.raw as WhatsAppMessage[])[0];

    if (!row) {
      return null;
    }

    const saved = this.messagesRepository.create(row);
    this.events.emit({ type: 'message', data: saved });

    return saved;
  }
}
