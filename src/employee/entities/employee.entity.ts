import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
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

@Index('UQ_EMPLOYEES_userId', ['userId'], {
  unique: true,
  where: '"userId" IS NOT NULL',
})
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

  // Usuario con el que el empleado entra a la app (por ejemplo, un
  // repartidor). null si no tiene acceso.
  @Column({ type: 'uuid', nullable: true })
  userId?: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
