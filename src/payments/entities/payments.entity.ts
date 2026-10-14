import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum PaymentMethod {
  CASH = 'cash',
  TRANSFER = 'transfer',
  MERCADO_PAGO = 'mercado_pago',
}

@Index('IDX_PAYMENTS_orderId', ['orderId'])
@Index('IDX_PAYMENTS_collectedById', ['collectedById'])
@Entity('PAYMENTS')
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  orderId: string;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
  })
  amount: number;

  @Column({
    type: 'enum',
    enum: PaymentMethod,
  })
  method: PaymentMethod;

  @Column({ type: 'text', nullable: true })
  notes?: string;

  // Quién cobró: el repartidor en la entrega (para la rendición) o quien lo
  // registró en la oficina.
  @Column({ type: 'uuid', nullable: true })
  collectedById?: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
