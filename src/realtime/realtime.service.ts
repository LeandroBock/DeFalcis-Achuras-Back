import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

import { PaymentMethod } from '../payments/entities/payments.entity.js';

// Resumen de una nota para avisar a la oficina en el momento.
export type OrderEventData = {
  orderId: string;
  customerName: string;
  driverName: string | null;
  total: number;
  collected?: number;
  pending?: number;
  // Lo cobrado de más en la entrega para pagar deuda anterior.
  debtCollected?: number;
  collectedByMethod?: Partial<Record<PaymentMethod, number>>;
  reason?: string;
};

export type OrderEvent =
  | { type: 'order.created'; data: OrderEventData }
  | { type: 'order.updated'; data: OrderEventData }
  | { type: 'order.assigned'; data: OrderEventData }
  | { type: 'order.cancelled'; data: OrderEventData }
  // El repartidor confirmó la entrega: la venta quedó registrada.
  | { type: 'order.delivered'; data: OrderEventData }
  | { type: 'order.not_delivered'; data: OrderEventData };

// Eventos en tiempo real de las notas de pedido (GET /events): la oficina se
// entera en el momento de cada entrega, y el aviso por WhatsApp se engancha
// acá sin acoplar los pedidos con WhatsApp.
@Injectable()
export class RealtimeService {
  private readonly orderEvents = new Subject<OrderEvent>();

  emit(event: OrderEvent) {
    this.orderEvents.next(event);
  }

  orders(): Observable<OrderEvent> {
    return this.orderEvents.asObservable();
  }
}
