import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

import {
  InboundWhatsAppMessage,
  WhatsAppConnectionState,
} from './connection/whatsapp-client.js';
import { WhatsAppMessage } from './entities/whatsapp-message.entity.js';

export type WhatsAppEvent =
  | { type: 'message'; data: WhatsAppMessage }
  | { type: 'connection'; data: WhatsAppConnectionState };

// Eventos en tiempo real para la bandeja de WhatsApp de la app (ver GET
// /whatsapp/events): mensajes nuevos y cambios de estado de la conexión.
@Injectable()
export class WhatsAppEventsService {
  private readonly events = new Subject<WhatsAppEvent>();
  private readonly inboundMessages = new Subject<InboundWhatsAppMessage>();

  emit(event: WhatsAppEvent) {
    this.events.next(event);
  }

  stream(): Observable<WhatsAppEvent> {
    return this.events.asObservable();
  }

  // Mensajes que llegan de la conexión con WhatsApp, antes de guardarse (los
  // guarda WhatsAppInboxService).
  inbound(message: InboundWhatsAppMessage) {
    this.inboundMessages.next(message);
  }

  inboundStream(): Observable<InboundWhatsAppMessage> {
    return this.inboundMessages.asObservable();
  }
}
