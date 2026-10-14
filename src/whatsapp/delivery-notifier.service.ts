import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Subscription, filter } from 'rxjs';

import {
  OrderEvent,
  OrderEventData,
  RealtimeService,
} from '../realtime/realtime.service.js';

import { WHATSAPP_CLIENT } from './connection/whatsapp-client.js';
import type { WhatsAppClient } from './connection/whatsapp-client.js';

const METHOD_LABEL: Record<string, string> = {
  cash: 'Efectivo',
  transfer: 'Transferencia',
  mercado_pago: 'Mercado Pago',
};

const money = (value: number) =>
  '$' +
  new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);

export function deliveryMessage(event: OrderEvent): string | null {
  const data: OrderEventData = event.data;
  const driver = data.driverName ? ` (${data.driverName})` : '';

  if (event.type === 'order.delivered') {
    const methods = Object.entries(data.collectedByMethod ?? {})
      .filter(([, amount]) => amount)
      .map(
        ([method, amount]) =>
          `${METHOD_LABEL[method] ?? method} ${money(amount!)}`,
      );

    const lines = [
      `✅ Entregado: ${data.customerName}${driver}`,
      `Total ${money(data.total)} · Cobrado ${money(data.collected ?? 0)}` +
        (methods.length ? ` (${methods.join(', ')})` : ''),
    ];

    if (data.pending) {
      lines.push(`Queda debiendo ${money(data.pending)}`);
    }

    return lines.join('\n');
  }

  if (event.type === 'order.not_delivered') {
    return `❌ No entregado: ${data.customerName}${driver}\nMotivo: ${data.reason ?? '-'}`;
  }

  return null;
}

// Avisa por WhatsApp a los números de DELIVERY_NOTIFY_PHONES cada vez que un
// repartidor entrega (o no puede entregar) una nota. Si WhatsApp no está
// conectado, solo queda en el log: la entrega ya está registrada.
@Injectable()
export class DeliveryNotifierService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('AvisoEntregas');
  private subscription?: Subscription;

  constructor(
    private readonly realtime: RealtimeService,
    private readonly config: ConfigService,
    @Inject(WHATSAPP_CLIENT) private readonly client: WhatsAppClient,
  ) {}

  onModuleInit() {
    this.subscription = this.realtime
      .orders()
      .pipe(
        filter(
          (event) =>
            event.type === 'order.delivered' ||
            event.type === 'order.not_delivered',
        ),
      )
      .subscribe((event) => void this.notify(event));
  }

  onModuleDestroy() {
    this.subscription?.unsubscribe();
  }

  private phones() {
    return (this.config.get<string>('DELIVERY_NOTIFY_PHONES') ?? '')
      .split(',')
      .map((phone) => phone.trim())
      .filter(Boolean);
  }

  async notify(event: OrderEvent) {
    const text = deliveryMessage(event);
    const phones = this.phones();

    if (!text || !phones.length) return;

    for (const phone of phones) {
      try {
        await this.client.sendText(phone, text);
      } catch (error) {
        this.logger.warn(
          `No se pudo avisar por WhatsApp a ${phone}: ${(error as Error).message}`,
        );
      }
    }
  }
}
