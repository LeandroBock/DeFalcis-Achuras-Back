import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum SupplierPaymentMethod {
  CASH = 'cash',
  TRANSFER = 'transfer',
  MERCADO_PAGO = 'mercado_pago',
}

@Entity('SUPPLIER_PAYMENTS')
export class SupplierPayment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  purchaseId: string;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
  })
  amount: number;

  @Column({
    type: 'enum',
    enum: SupplierPaymentMethod,
  })
  method: SupplierPaymentMethod;

  @Column({ type: 'text', nullable: true })
  notes?: string;

  @CreateDateColumn()
  createdAt: Date;
}
