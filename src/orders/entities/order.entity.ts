import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

// Circuito: la venta nace como nota de pedido (PENDING) con kilos estimados;
// al entregar se pesa, se cobra y pasa a DELIVERED con los kilos reales.
// CONFIRMED ya no se usa (los pedidos anteriores pasaron a DELIVERED).
export enum OrderStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  DELIVERED = 'delivered',
  CANCELLED = 'cancelled',
}

export enum OrderPaymentStatus {
  PENDING = 'pending',
  PARTIAL = 'partial',
  PAID = 'paid',
}

@Index('IDX_ORDERS_createdAt', ['createdAt'])
@Index('IDX_ORDERS_assignedToId', ['assignedToId'])
@Index('UQ_ORDERS_receiptNumber', ['receiptNumber'], {
  unique: true,
  where: '"receiptNumber" IS NOT NULL',
})
@Entity('ORDERS')
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  customerId: string;

  @Column({
    type: 'enum',
    enum: OrderStatus,
    default: OrderStatus.PENDING,
  })
  status: OrderStatus;

  @Column({
    type: 'enum',
    enum: OrderPaymentStatus,
    default: OrderPaymentStatus.PENDING,
  })
  paymentStatus: OrderPaymentStatus;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    default: 0,
  })
  total: number;

  @Column({ type: 'text', nullable: true })
  notes?: string;

  // Repartidor (usuario con rol reparto) que la tiene que entregar.
  @Column({ type: 'uuid', nullable: true })
  assignedToId?: string | null;

  @Column({ type: 'date', nullable: true })
  deliveryDate?: string | null;

  // Posición en la ruta del repartidor (1 = primera parada).
  @Column({ type: 'int', nullable: true })
  routeOrder?: number | null;

  @Column({ type: 'timestamp', nullable: true })
  deliveredAt?: Date | null;

  @Column({ type: 'uuid', nullable: true })
  deliveredById?: string | null;

  // Comentario de la entrega, o motivo si no se pudo entregar.
  @Column({ type: 'text', nullable: true })
  deliveryComment?: string | null;

  // Recibo X de la entrega (se numera al confirmarla).
  @Column({ type: 'int', nullable: true })
  receiptNumber?: number | null;

  // Lo cobrado en la entrega que pagó deuda anterior (va en el recibo).
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  debtCollected: number;

  // Envío del recibo por WhatsApp al cliente.
  @Column({ type: 'timestamp', nullable: true })
  receiptSentAt?: Date | null;

  @Column({ type: 'text', nullable: true })
  receiptError?: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
