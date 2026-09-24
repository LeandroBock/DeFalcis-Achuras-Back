import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum ExpenseCategory {
  RENT = 'rent',
  UTILITIES = 'utilities',
  FUEL = 'fuel',
  SALARIES = 'salaries',
  TAXES = 'taxes',
  MAINTENANCE = 'maintenance',
  ADMINISTRATIVE = 'administrative',
  OTHER = 'other',
}

export enum ExpensePaymentMethod {
  CASH = 'cash',
  TRANSFER = 'transfer',
  MERCADO_PAGO = 'mercado_pago',
}

@Entity('EXPENSES')
export class Expense {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'enum',
    enum: ExpenseCategory,
  })
  category: ExpenseCategory;

  @Column({ length: 150 })
  description: string;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
  })
  amount: number;

  @Column({
    type: 'enum',
    enum: ExpensePaymentMethod,
  })
  paymentMethod: ExpensePaymentMethod;

  @Column({ type: 'text', nullable: true })
  notes?: string;

  @CreateDateColumn()
  createdAt: Date;
}
