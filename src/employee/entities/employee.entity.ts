import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum EmployeePosition {
  ADMINISTRATION = 'administration',
  SALES = 'sales',
  WAREHOUSE = 'warehouse',
  DELIVERY = 'delivery',
  PRODUCTION = 'production',
  OTHER = 'other',
}

@Entity('EMPLOYEES')
export class Employee {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 100 })
  name: string;

  @Column({ length: 30, nullable: true })
  phone?: string;

  @Column({ length: 150, nullable: true })
  email?: string;

  @Column({
    type: 'enum',
    enum: EmployeePosition,
  })
  position: EmployeePosition;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    default: 0,
  })
  salary: number;

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'text', nullable: true })
  notes?: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
