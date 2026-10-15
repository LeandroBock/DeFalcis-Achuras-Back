import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum InvoiceStatus {
  PENDING = 'pending',
  AUTHORIZED = 'authorized',
  REJECTED = 'rejected',
}

@Entity('INVOICES')
export class Invoice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', unique: true })
  orderId: string;

  @Column({ type: 'int' })
  ptoVta: number;

  @Column({ type: 'int' })
  cbteTipo: number;

  @Column({ type: 'int', nullable: true })
  cbteNro: number | null;

  @Column({
    type: 'enum',
    enum: InvoiceStatus,
    default: InvoiceStatus.PENDING,
  })
  status: InvoiceStatus;

  @Column({ type: 'varchar', length: 20, nullable: true })
  cae: string | null;

  @Column({ type: 'date', nullable: true })
  caeVto: string | null;

  @Column({ type: 'date', nullable: true })
  cbteFch: string | null;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  total: number;

  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  // Datos del cliente tal como se facturaron (no cambian si después se
  // edita el cliente). Null en las facturas anteriores a este registro.
  @Column({ type: 'varchar', length: 150, nullable: true })
  customerName: string | null;

  // CUIT (11 dígitos) o DNI, sin guiones ni puntos
  @Column({ type: 'varchar', length: 20, nullable: true })
  taxId?: string | null;

  // Condición frente al IVA (ARCA): 1 = Resp. Inscripto, 4 = Exento,
  // 5 = Consumidor Final, 6 = Monotributo
  @Column({ type: 'int', default: 5 })
  taxCondition: number;

  @Column({ type: 'text', nullable: true })
  customerAddress: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  customerEmail: string | null;

  // Último envío por mail (o el error si no se pudo mandar).
  @Column({ type: 'varchar', length: 150, nullable: true })
  emailedTo: string | null;

  @Column({ type: 'timestamp', nullable: true })
  emailedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  emailError: string | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  netAmount: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  vatAmount: number;
}
