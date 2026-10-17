import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
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

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

// WhatsApp desconectado (o reconectándose): conviene reintentar más tarde.
const isNotConnected = (error: unknown) =>
  error instanceof ServiceUnavailableException;

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

  // Reintentos automáticos si WhatsApp estaba desconectado o reconectándose
  // al confirmar la entrega.
  retryDelaysMs = [30_000, 2 * 60_000, 10 * 60_000];
  private readonly timers = new Set<NodeJS.Timeout>();

  onModuleInit() {
    this.subscription = this.realtime
      .orders()
      .pipe(filter((event) => event.type === 'order.delivered'))
      .subscribe((event) => void this.sendWithRetries(event.data.orderId));
  }

  onModuleDestroy() {
    this.subscription?.unsubscribe();
    this.timers.forEach((timer) => clearTimeout(timer));
    this.timers.clear();
  }

  private async sendWithRetries(orderId: string, attempt = 0) {
    try {
      const result = await this.send(orderId);
      const delay = this.retryDelaysMs[attempt];

      if (!result.sent && result.retryable && delay !== undefined) {
        this.logger.log(
          `Se reintenta el recibo de ${orderId} en ${delay / 1000} s`,
        );
        const timer = setTimeout(() => {
          this.timers.delete(timer);
          void this.sendWithRetries(orderId, attempt + 1);
        }, delay);
        this.timers.add(timer);
      }
    } catch (error) {
      this.logger.error(
        `No se pudo armar el recibo de ${orderId}: ${String(error)}`,
      );
    }
  }

  // Falla solo si la nota no existe o no está entregada; un envío fallido
  // queda anotado en la nota y se devuelve como { sent: false, error }.
  async send(orderId: string) {
    const { data, buffer, filename } = await this.receipts.pdf(orderId);

    if (!data.customer.phone) {
      return this.saveResult(orderId, {
        error: 'El cliente no tiene teléfono cargado',
      });
    }

    const caption = receiptCaption(data);

    try {
      const sent = await this.client.sendDocument(data.customer.phone, {
        buffer,
        fileName: filename,
        mimetype: 'application/pdf',
        caption,
      });
      await this.record(sent, data.customer.id, `📄 ${filename}\n${caption}`);

      return this.saveResult(orderId, { to: sent.phone });
    } catch (error) {
      const message = errorMessage(error);
      this.logger.warn(`No se pudo enviar el recibo de ${orderId}: ${message}`);

      // Sin conexión o número sin WhatsApp: el texto tampoco saldría.
      if (isNotConnected(error)) {
        return this.saveResult(orderId, { error: message, retryable: true });
      }
      if (error instanceof BadRequestException) {
        return this.saveResult(orderId, { error: message });
      }

      // Falló el PDF (por ejemplo, al subir el archivo): al menos el detalle
      // en texto le llega al cliente.
      try {
        const text = `${caption}\n\n(El recibo en PDF se lo pedís a la oficina.)`;
        const sent = await this.client.sendText(data.customer.phone, text);
        await this.record(sent, data.customer.id, text);

        return this.saveResult(orderId, {
          to: sent.phone,
          error: `Se mandó el resumen en texto; el PDF falló: ${message}`,
          sentAsText: true,
        });
      } catch (textError) {
        return this.saveResult(orderId, {
          error: `${message} (tampoco salió en texto: ${errorMessage(textError)})`,
          retryable: isNotConnected(textError),
        });
      }
    }
  }

  private async record(
    sent: { phone: string; externalMessageId: string },
    customerId: string,
    message: string,
  ) {
    await this.whatsapp
      .createOutgoingMessage({
        phone: sent.phone,
        customerId,
        externalMessageId: sent.externalMessageId,
        message,
        type: message.startsWith('📄')
          ? WhatsAppMessageType.DOCUMENT
          : WhatsAppMessageType.TEXT,
      })
      .catch((error: unknown) =>
        this.logger.warn(
          `No se pudo guardar el mensaje del recibo: ${String(error)}`,
        ),
      );
  }

  private async saveResult(
    orderId: string,
    result: {
      to?: string;
      error?: string;
      retryable?: boolean;
      sentAsText?: boolean;
    },
  ) {
    const sent = !!result.to;

    await this.ordersRepository
      .update(
        orderId,
        sent
          ? { receiptSentAt: new Date(), receiptError: result.error ?? null }
          : { receiptError: result.error },
      )
      .catch((error: unknown) =>
        this.logger.error(
          `No se pudo guardar el envío del recibo de ${orderId}: ${String(error)}`,
        ),
      );

    return sent
      ? {
          sent: true as const,
          to: result.to,
          ...(result.sentAsText ? { warning: result.error } : {}),
        }
      : {
          sent: false as const,
          error: result.error,
          retryable: !!result.retryable,
        };
  }
}
