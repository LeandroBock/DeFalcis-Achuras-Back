import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Subscription, filter } from 'rxjs';
import { Repository } from 'typeorm';

import { Order } from '../orders/entities/order.entity.js';
import {
  ReceiptService,
  formatReceiptNumber,
} from '../orders/receipt.service.js';
import type { ReceiptData } from '../orders/receipt.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';

import { WHATSAPP_CLIENT } from './connection/whatsapp-client.js';
import type { WhatsAppClient } from './connection/whatsapp-client.js';
import { WhatsAppMessageType } from './entities/whatsapp-message.entity.js';
import { WhatsAppService } from './whatsapp.service.js';

const money = (value: number) =>
  '$' +
  new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);

export function receiptCaption(data: ReceiptData) {
  const lines = [
    `Hola ${data.customer.name}! Te dejamos el recibo X N° ${formatReceiptNumber(data.number)} de tu pedido.`,
    `Total ${money(data.total)} · Pagado ${money(data.collected + data.debtCollected)}`,
  ];

  if (data.pending > 0) {
    lines.push(`Queda en cuenta corriente ${money(data.pending)}`);
  }

  if (data.balance !== null && data.balance > 0) {
    lines.push(`Saldo total en cuenta corriente ${money(data.balance)}`);
  }

  lines.push('¡Gracias por tu compra!');

  return lines.join('\n');
}

// Al confirmar una entrega, manda el recibo X en PDF al WhatsApp del
// cliente. Si no se puede (sin teléfono, WhatsApp desconectado), queda
// anotado en la nota para reenviarlo desde la oficina: la venta ya está
// registrada.
@Injectable()
export class ReceiptSenderService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('ReciboWhatsApp');
  private subscription?: Subscription;

  constructor(
    private readonly realtime: RealtimeService,
    private readonly receipts: ReceiptService,
    private readonly whatsapp: WhatsAppService,
    @InjectRepository(Order)
    private readonly ordersRepository: Repository<Order>,
    @Inject(WHATSAPP_CLIENT) private readonly client: WhatsAppClient,
  ) {}

  onModuleInit() {
    this.subscription = this.realtime
      .orders()
      .pipe(filter((event) => event.type === 'order.delivered'))
      .subscribe(
        (event) =>
          void this.send(event.data.orderId).catch((error: unknown) =>
            this.logger.error(
              `No se pudo armar el recibo de ${event.data.orderId}: ${String(error)}`,
            ),
          ),
      );
  }

  onModuleDestroy() {
    this.subscription?.unsubscribe();
  }

  // Falla solo si la nota no existe o no está entregada; un envío fallido
  // queda anotado en la nota y se devuelve como { sent: false, error }.
  async send(orderId: string) {
    const { data, buffer, filename } = await this.receipts.pdf(orderId);

    try {
      if (!data.customer.phone) {
        return this.saveResult(orderId, {
          error: 'El cliente no tiene teléfono cargado',
        });
      }

      const caption = receiptCaption(data);
      const sent = await this.client.sendDocument(data.customer.phone, {
        buffer,
        fileName: filename,
        mimetype: 'application/pdf',
        caption,
      });

      await this.whatsapp
        .createOutgoingMessage({
          phone: sent.phone,
          customerId: data.customer.id,
          externalMessageId: sent.externalMessageId,
          message: `📄 ${filename}\n${caption}`,
          type: WhatsAppMessageType.DOCUMENT,
        })
        .catch((error: unknown) =>
          this.logger.warn(
            `No se pudo guardar el mensaje del recibo: ${String(error)}`,
          ),
        );

      return this.saveResult(orderId, { to: sent.phone });
    } catch (error) {
      const message = (error as Error).message ?? String(error);
      this.logger.warn(`No se pudo enviar el recibo de ${orderId}: ${message}`);
      return this.saveResult(orderId, { error: message });
    }
  }

  private async saveResult(
    orderId: string,
    result: { to?: string; error?: string },
  ) {
    await this.ordersRepository
      .update(
        orderId,
        result.error
          ? { receiptError: result.error }
          : { receiptSentAt: new Date(), receiptError: null },
      )
      .catch((error: unknown) =>
        this.logger.error(
          `No se pudo guardar el envío del recibo de ${orderId}: ${String(error)}`,
        ),
      );

    return result.error
      ? { sent: false, error: result.error }
      : { sent: true, to: result.to };
  }
}
