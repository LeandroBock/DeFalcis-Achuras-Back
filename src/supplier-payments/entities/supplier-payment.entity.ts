import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum SupplierPaymentMethod {
  CASH = 'cash',
  TRANSFER = 'transfer',
  MERCADO_PAGO = 'mercado_pago',
  // Movimiento de saldo a favor del proveedor: negativo cuando una compra
  // queda sobrepagada (se genera saldo), positivo cuando se usa para pagar.
  SUPPLIER_CREDIT = 'supplier_credit',
}

@Index('IDX_SUPPLIER_PAYMENTS_purchaseId', ['purchaseId'])
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
